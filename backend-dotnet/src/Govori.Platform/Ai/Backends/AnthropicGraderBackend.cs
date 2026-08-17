using System.Text;
using Anthropic;
using Anthropic.Core;
using Anthropic.Models.Messages;
using Govori.Platform.Grader;

namespace Govori.Platform.Ai.Backends;

/// <summary>
/// Claude as a grader, over the official Anthropic SDK. It sits first in the default chain because
/// it is the strongest at the judgement this app asks for — reading an Uzbek learner's Russian and
/// saying, in Uzbek, what to fix — and it ships with no key, so until an admin pastes one
/// <see cref="IsConfigured"/> is false and the chain passes over it for nothing.
///
/// <para>The SDK is used rather than hand-rolled HTTP because it owns the two things that are easy
/// to get subtly wrong and expensive to discover in production: the structured-output contract and
/// the refusal semantics.</para>
/// </summary>
public sealed class AnthropicGraderBackend : IGraderBackend
{
    /// <summary>Named <see cref="System.Net.Http.IHttpClientFactory"/> client, so the DI step can
    /// configure this vendor's transport (proxy, resilience handler) without touching this file.</summary>
    public const string HttpClientName = "govori-anthropic";

    /// <summary>
    /// Output cap for one grading run. The grader emits a bounded JSON object — six numbers and a
    /// short block of Uzbek — so this is generous; it exists to stop a runaway generation from
    /// billing indefinitely. Opus 5 reasons before answering and those tokens come out of the same
    /// budget, which is why a truncation is detected explicitly below instead of being left to fail
    /// as unparseable JSON further down.
    /// </summary>
    private const int MaxOutputTokens = 4096;

    private readonly IHttpClientFactory _httpClientFactory;

    /// <summary>
    /// Takes the HTTP client factory even though the SDK would happily make its own: a fresh
    /// <c>HttpClient</c> per grading run means a fresh connection pool per grading run, and under
    /// the worker's concurrency that exhausts sockets. The SDK client itself is cheap and IS built
    /// per run, because the API key can change between two submissions.
    /// </summary>
    public AnthropicGraderBackend(IHttpClientFactory httpClientFactory)
        => _httpClientFactory = httpClientFactory;

    public string Name => AiProviders.Anthropic;

    public bool IsConfigured(AiRuntimeConfig config) => !string.IsNullOrWhiteSpace(config.AnthropicApiKey);

    public async Task<GraderResult> AnalyzeAsync(
        GraderRequest request, AiRuntimeConfig config, CancellationToken ct)
    {
        var http = _httpClientFactory.CreateClient(HttpClientName);
        http.Timeout = GraderContract.VendorTimeout;

        var client = new AnthropicClient(new ClientOptions
        {
            ApiKey = config.AnthropicApiKey,
            HttpClient = http,
            Timeout = GraderContract.VendorTimeout,
        });

        var message = await client.Messages.Create(
            new MessageCreateParams
            {
                // Whatever the admin pinned, verbatim. Never "corrected" to an older id and never
                // date-suffixed here: the configured string is the contract with the settings row.
                Model = config.AnthropicModel,
                MaxTokens = MaxOutputTokens,
                System = new List<TextBlockParam> { new() { Text = GraderContract.RubricSystem } },
                Messages = new List<MessageParam>
                {
                    new() { Role = Role.User, Content = BuildContent(request) },
                },
                OutputConfig = new OutputConfig
                {
                    // Grading is a bounded scoring task against a fixed rubric, not an open
                    // investigation. Low effort keeps the latency budget intact; the rubric, not
                    // extra deliberation, is what makes the score consistent.
                    Effort = Effort.Low,
                    Format = new JsonOutputFormat { Schema = GraderContract.AnthropicSchema },
                },
                // Thinking is left at the model default. On Opus 5 it is already on, and pinning
                // a budget_tokens here would be a downgrade, not a tuning knob.
            },
            ct);

        // A refusal arrives as HTTP 200 with empty or partial content, so the stop reason has to be
        // read BEFORE the content — otherwise this looks like an empty answer rather than a decision.
        // Throwing is the right outcome: the chain falls through to Gemini, which is precisely the
        // fallback we want, and is why the server-side `fallbacks` parameter is deliberately unused.
        var stopReason = message.StopReason?.Raw();
        if (string.Equals(stopReason, "refusal", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException(
                "Claude refused to grade this attempt (category: "
                + (message.StopDetails?.Category?.Raw() ?? "unspecified") + ").");

        if (string.Equals(stopReason, "max_tokens", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException(
                $"Claude hit the {MaxOutputTokens}-token output cap before closing the JSON object; "
                + "the grading result is truncated and cannot be trusted.");

        var text = ReadText(message);
        if (text.Length == 0)
            throw new InvalidOperationException(
                $"Claude returned no text content (stop_reason: {stopReason ?? "absent"}).");

        // The served model, not the configured one: after an alias resolves or a fallback runs, the
        // configured name no longer describes what graded the answer (docs/07 §7.9).
        return GraderContract.Parse(text, message.Model?.Raw() ?? config.AnthropicModel);
    }

    /// <summary>
    /// The user turn: the picture first (vendors attend to an image better when it precedes the
    /// instructions about it), then the prompt. Plain text when the task has no usable picture, so
    /// the common case never pays for a content-block array.
    /// </summary>
    private static MessageParamContent BuildContent(GraderRequest request)
    {
        var prompt = GraderContract.BuildUserPrompt(request);
        var mime = GraderContract.ResolveImageMime(request);
        if (mime is null)
            return prompt;

        return new List<ContentBlockParam>
        {
            new ImageBlockParam
            {
                Source = new Base64ImageSource
                {
                    Data = Convert.ToBase64String(request.ImageBytes!),
                    MediaType = mime,
                },
            },
            new TextBlockParam { Text = prompt },
        };
    }

    /// <summary>
    /// Concatenates the text blocks of the reply. <c>ContentBlock</c> is a union — thinking blocks
    /// and tool results share the list — so the blocks are narrowed rather than indexed; taking
    /// <c>Content[0].Text</c> would read a thinking block on any model that emits one.
    /// </summary>
    private static string ReadText(Message message)
    {
        var builder = new StringBuilder();
        foreach (var block in message.Content ?? Array.Empty<ContentBlock>())
            if (block.TryPickText(out var textBlock) && textBlock?.Text is { Length: > 0 } text)
                builder.Append(text);

        return builder.ToString();
    }
}
