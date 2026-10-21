using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Govori.Platform.Grader;

namespace Govori.Platform.Ai.Backends;

/// <summary>
/// Gemini as a grader, over the REST API. Second in the default chain: the cheapest backend that is
/// good enough at this rubric, and the one that carries the load when Claude is unconfigured — which
/// it is today.
///
/// <para>Hand-rolled HTTP rather than an SDK because Google ships no official .NET client for the
/// Generative Language API. The surface used here is small on purpose — one POST, structured output,
/// no streaming — so there is little for a wire change to break.</para>
/// </summary>
public sealed class GeminiGraderBackend : IGraderBackend
{
    /// <summary>Named <see cref="IHttpClientFactory"/> client, so the DI step can attach a proxy or
    /// a resilience handler to this vendor alone without touching this file.</summary>
    public const string HttpClientName = "govori-gemini";

    private const string ModelsEndpoint = "https://generativelanguage.googleapis.com/v1beta/models/";

    private readonly IHttpClientFactory _httpClientFactory;

    public GeminiGraderBackend(IHttpClientFactory httpClientFactory)
        => _httpClientFactory = httpClientFactory;

    public string Name => AiProviders.Gemini;

    public bool IsConfigured(AiRuntimeConfig config) => !string.IsNullOrWhiteSpace(config.GeminiApiKey);

    public async Task<GraderResult> AnalyzeAsync(
        GraderRequest request, AiRuntimeConfig config, CancellationToken ct)
    {
        // The timeout is configured once, where the client is registered (AiRegistration) — the
        // two STT backends used to be the ones that forgot it here.
        var http = _httpClientFactory.CreateClient(HttpClientName);

        var url = ModelsEndpoint + Uri.EscapeDataString(config.GeminiModel) + ":generateContent";
        using var message = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new StringContent(BuildBody(request), Encoding.UTF8, "application/json"),
        };

        // The key travels in a header, not in the `?key=` query string Google's samples use: a URL
        // ends up in exception text, proxy logs and traces, and a grader secret must not follow it
        // there. Both forms are supported by the API.
        message.Headers.TryAddWithoutValidation("x-goog-api-key", config.GeminiApiKey);

        using var response = await http.SendAsync(message, ct);
        var payload = await response.Content.ReadAsStringAsync(ct);

        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException(
                $"Gemini returned HTTP {(int)response.StatusCode}: {GraderContract.Excerpt(payload)}");

        return ReadResult(payload, config.GeminiModel);
    }

    /// <summary>
    /// Builds the request body. <c>responseSchema</c> plus a JSON response MIME type is Gemini's
    /// structured-output mode; without the MIME type the schema is ignored and the model answers in
    /// prose. Temperature is deliberately absent — see <see cref="GraderContract"/>.
    /// </summary>
    private static string BuildBody(GraderRequest request)
    {
        var parts = new JsonArray();

        // Picture-description tasks: the image rides as inline base64, which is the documented form
        // for anything small enough not to need the Files API. Only a format resolved by the shared
        // contract is sent; an unrecognised one is dropped there rather than guessed at here.
        var mime = GraderContract.ResolveImageMime(request);
        if (mime is not null)
            parts.Add(new JsonObject
            {
                ["inlineData"] = new JsonObject
                {
                    ["mimeType"] = mime,
                    ["data"] = Convert.ToBase64String(request.ImageBytes!),
                },
            });

        parts.Add(new JsonObject { ["text"] = GraderContract.BuildUserPrompt(request) });

        var body = new JsonObject
        {
            ["systemInstruction"] = new JsonObject
            {
                ["parts"] = new JsonArray { new JsonObject { ["text"] = GraderContract.Rubric(request.FeedbackLanguage) } },
            },
            ["contents"] = new JsonArray
            {
                new JsonObject { ["role"] = "user", ["parts"] = parts },
            },
            ["generationConfig"] = new JsonObject
            {
                ["responseMimeType"] = "application/json",
                ["responseSchema"] = GraderContract.GeminiResponseSchema(request.FeedbackLanguage),
            },
        };

        return body.ToJsonString();
    }

    /// <summary>
    /// Pulls the graded JSON out of the first candidate.
    ///
    /// <para>Two failure modes here are HTTP 200 and must be turned into throws so the chain falls
    /// through: a prompt blocked by a safety filter (no candidates at all), and a candidate stopped
    /// for anything other than a completed answer. Silently returning the empty case would score a
    /// student's attempt as if the model had judged it.</para>
    /// </summary>
    private static GraderResult ReadResult(string payload, string configuredModel)
    {
        using var document = JsonDocument.Parse(payload);
        var root = document.RootElement;

        var servedModel = root.TryGetProperty("modelVersion", out var version)
                          && version.ValueKind == JsonValueKind.String
            ? version.GetString()!
            : configuredModel;

        if (!root.TryGetProperty("candidates", out var candidates)
            || candidates.ValueKind != JsonValueKind.Array
            || candidates.GetArrayLength() == 0)
        {
            var blockReason = root.TryGetProperty("promptFeedback", out var feedback)
                              && feedback.TryGetProperty("blockReason", out var reason)
                ? reason.GetString()
                : null;
            throw new InvalidOperationException(
                $"Gemini returned no candidates (blockReason: {blockReason ?? "absent"}).");
        }

        var candidate = candidates[0];
        var finishReason = candidate.TryGetProperty("finishReason", out var finish)
                           && finish.ValueKind == JsonValueKind.String
            ? finish.GetString()
            : null;

        if (finishReason is not null
            && !string.Equals(finishReason, "STOP", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException(
                $"Gemini stopped early (finishReason: {finishReason}); the grading result is incomplete.");

        var builder = new StringBuilder();
        if (candidate.TryGetProperty("content", out var content)
            && content.TryGetProperty("parts", out var parts)
            && parts.ValueKind == JsonValueKind.Array)
        {
            foreach (var part in parts.EnumerateArray())
            {
                // Reasoning models return their deliberation as parts flagged `thought`. Those are
                // prose, not the answer — concatenating them corrupts the JSON before it is parsed.
                if (part.TryGetProperty("thought", out var thought)
                    && thought.ValueKind == JsonValueKind.True)
                    continue;

                if (part.TryGetProperty("text", out var text) && text.ValueKind == JsonValueKind.String)
                    builder.Append(text.GetString());
            }
        }

        if (builder.Length == 0)
            throw new InvalidOperationException(
                $"Gemini returned a candidate with no text: {GraderContract.Excerpt(payload)}");

        return GraderContract.Parse(builder.ToString(), servedModel) with
        {
            InputTokens = UsageField(root, "promptTokenCount"),
            // Thinking tokens are billed at the output rate but reported separately.
            OutputTokens = UsageField(root, "candidatesTokenCount") is { } output
                ? output + (UsageField(root, "thoughtsTokenCount") ?? 0)
                : null,
        };
    }

    // usageMetadata.{field} as a number, or null when absent — read only by the spend ledger.
    private static long? UsageField(JsonElement root, string field)
        => root.TryGetProperty("usageMetadata", out var usage)
           && usage.ValueKind == JsonValueKind.Object
           && usage.TryGetProperty(field, out var value)
           && value.TryGetInt64(out var n)
            ? n
            : null;
}
