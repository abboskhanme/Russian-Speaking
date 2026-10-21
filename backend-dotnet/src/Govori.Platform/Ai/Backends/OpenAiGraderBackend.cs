using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Govori.Platform.Grader;

namespace Govori.Platform.Ai.Backends;

/// <summary>
/// OpenAI as a grader — ONE backend covering both api.openai.com and Azure OpenAI, because they
/// speak the same chat-completions wire format and differ only in where the request goes and which
/// header carries the key. Splitting them into two classes would duplicate the entire prompt-to-JSON
/// path to express a route and a header name.
///
/// <para>Last in the default chain: the vendor most likely to still be answering when the other two
/// are having a bad day. That also makes it the link with nothing behind it, which is why nothing
/// here is pinned tighter than it has to be — see the note about temperature in
/// <see cref="GraderContract"/>.</para>
/// </summary>
public sealed class OpenAiGraderBackend : IGraderBackend
{
    /// <summary>Named <see cref="IHttpClientFactory"/> client, shared by both routes: they are the
    /// same protocol against different hosts, and the factory keys its pool on the URI anyway.</summary>
    public const string HttpClientName = "govori-openai";

    private const string PublicEndpoint = "https://api.openai.com/v1/chat/completions";

    private readonly IHttpClientFactory _httpClientFactory;

    public OpenAiGraderBackend(IHttpClientFactory httpClientFactory)
        => _httpClientFactory = httpClientFactory;

    public string Name => AiProviders.OpenAi;

    /// <summary>Either route is enough. Azure wins when it is fully configured (endpoint + key +
    /// deployment); a half-filled Azure section falls back to the public API rather than failing,
    /// so a half-finished edit in the admin panel cannot take grading down.</summary>
    public bool IsConfigured(AiRuntimeConfig config)
        => config.AzureOpenAiReady || !string.IsNullOrWhiteSpace(config.OpenAiApiKey);

    public async Task<GraderResult> AnalyzeAsync(
        GraderRequest request, AiRuntimeConfig config, CancellationToken ct)
    {
        var useAzure = config.AzureOpenAiReady;
        // The timeout is configured once, where the client is registered (AiRegistration) — the
        // two STT backends used to be the ones that forgot it here.
        var http = _httpClientFactory.CreateClient(HttpClientName);

        using var message = new HttpRequestMessage(HttpMethod.Post, BuildUrl(config, useAzure))
        {
            Content = new StringContent(BuildBody(request, config, useAzure), Encoding.UTF8, "application/json"),
        };

        if (useAzure)
            message.Headers.TryAddWithoutValidation("api-key", config.AzureOpenAiApiKey);
        else
            message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", config.OpenAiApiKey);

        using var response = await http.SendAsync(message, ct);
        var payload = await response.Content.ReadAsStringAsync(ct);

        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException(
                $"{(useAzure ? "Azure OpenAI" : "OpenAI")} returned HTTP {(int)response.StatusCode}: "
                + GraderContract.Excerpt(payload));

        // Azure addresses a DEPLOYMENT, and the deployment name is an admin's label, not a model —
        // so it is only the last-resort answer to "what graded this attempt".
        var configuredModel = useAzure ? config.AzureOpenAiDeployment! : config.OpenAiGraderModel;
        return ReadResult(payload, configuredModel, useAzure);
    }

    /// <summary>
    /// Azure routes by deployment and pins the contract with an api-version; the public API routes
    /// by model, named in the body. Same protocol, different addressing — the only real fork in
    /// this backend.
    /// </summary>
    private static string BuildUrl(AiRuntimeConfig config, bool useAzure)
    {
        if (!useAzure)
            return PublicEndpoint;

        return config.AzureOpenAiEndpoint!.TrimEnd('/')
               + "/openai/deployments/" + Uri.EscapeDataString(config.AzureOpenAiDeployment!)
               + "/chat/completions?api-version=" + Uri.EscapeDataString(config.AzureOpenAiApiVersion);
    }

    private static string BuildBody(GraderRequest request, AiRuntimeConfig config, bool useAzure)
    {
        var body = new JsonObject
        {
            ["messages"] = new JsonArray
            {
                new JsonObject { ["role"] = "system", ["content"] = GraderContract.Rubric(request.FeedbackLanguage) },
                new JsonObject { ["role"] = "user", ["content"] = BuildUserContent(request) },
            },
            // `strict` is what makes the schema binding rather than advisory. It is also why the
            // shared schema names every property in `required` and sets additionalProperties:false —
            // OpenAI rejects a strict schema that does not.
            ["response_format"] = new JsonObject
            {
                ["type"] = "json_schema",
                ["json_schema"] = new JsonObject
                {
                    ["name"] = GraderContract.SchemaName,
                    ["strict"] = true,
                    ["schema"] = GraderContract.StrictJsonSchema(request.FeedbackLanguage),
                },
            },
        };

        // Azure takes the model from the deployment in the URL; sending one here is at best ignored
        // and at worst a 400 when it disagrees with the deployment.
        if (!useAzure)
            body["model"] = config.OpenAiGraderModel;

        return body.ToJsonString();
    }

    /// <summary>
    /// The user turn: a bare string for the ordinary case, or the multimodal array when the task
    /// carries a picture. The image goes as a <c>data:</c> URL, which is this API's inline form —
    /// the same bytes Gemini takes as <c>inlineData</c>, just spelled differently.
    /// </summary>
    private static JsonNode BuildUserContent(GraderRequest request)
    {
        var prompt = GraderContract.BuildUserPrompt(request);
        var mime = GraderContract.ResolveImageMime(request);
        if (mime is null)
            return JsonValue.Create(prompt)!;

        return new JsonArray
        {
            new JsonObject
            {
                ["type"] = "image_url",
                ["image_url"] = new JsonObject
                {
                    ["url"] = "data:" + mime + ";base64," + Convert.ToBase64String(request.ImageBytes!),
                },
            },
            new JsonObject { ["type"] = "text", ["text"] = prompt },
        };
    }

    /// <summary>
    /// Reads the first choice.
    ///
    /// <para>Structured output has its own refusal channel: the model answers HTTP 200 with
    /// <c>content: null</c> and a <c>refusal</c> string. That has to be checked before the content,
    /// or a declined grading reads as an empty one. A <c>length</c> or <c>content_filter</c> finish
    /// is treated the same way — a partial JSON object is not a partial score, it is no score.</para>
    /// </summary>
    private static GraderResult ReadResult(string payload, string configuredModel, bool useAzure)
    {
        var vendor = useAzure ? "Azure OpenAI" : "OpenAI";

        using var document = JsonDocument.Parse(payload);
        var root = document.RootElement;

        var servedModel = root.TryGetProperty("model", out var model) && model.ValueKind == JsonValueKind.String
            ? model.GetString()!
            : configuredModel;

        if (!root.TryGetProperty("choices", out var choices)
            || choices.ValueKind != JsonValueKind.Array
            || choices.GetArrayLength() == 0)
            throw new InvalidOperationException(
                $"{vendor} returned no choices: {GraderContract.Excerpt(payload)}");

        var choice = choices[0];
        if (!choice.TryGetProperty("message", out var choiceMessage)
            || choiceMessage.ValueKind != JsonValueKind.Object)
            throw new InvalidOperationException(
                $"{vendor} returned a choice with no message: {GraderContract.Excerpt(payload)}");

        if (choiceMessage.TryGetProperty("refusal", out var refusal)
            && refusal.ValueKind == JsonValueKind.String)
            throw new InvalidOperationException(
                $"{vendor} refused to grade this attempt: {GraderContract.Excerpt(refusal.GetString(), 200)}");

        var finishReason = choice.TryGetProperty("finish_reason", out var finish)
                           && finish.ValueKind == JsonValueKind.String
            ? finish.GetString()
            : null;

        if (finishReason is not null
            && !string.Equals(finishReason, "stop", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException(
                $"{vendor} stopped early (finish_reason: {finishReason}); the grading result is incomplete.");

        var content = choiceMessage.TryGetProperty("content", out var text)
                      && text.ValueKind == JsonValueKind.String
            ? text.GetString()
            : null;

        if (string.IsNullOrWhiteSpace(content))
            throw new InvalidOperationException(
                $"{vendor} returned a choice with no content: {GraderContract.Excerpt(payload)}");

        return GraderContract.Parse(content, servedModel);
    }
}
