namespace Govori.Contracts;

/// <summary>
/// The demo phrase handed to a first-time visitor — the body of <c>GET /guest/demo</c>.
/// JSON: <c>{ "phrase": ... }</c>.
/// </summary>
public sealed record GuestDemoResponse(string Phrase);

/// <summary>
/// Per-criterion demo scores (0–100, rounded ints; <c>null</c> when a criterion couldn't be
/// derived). Rendered under the Uzbek labels talaffuz / urg'u / intonatsiya / ravonlik /
/// grammatika. Serialized snake_case: <c>pronunciation</c>,
/// <c>stress</c>, <c>intonation</c>, <c>fluency</c>, <c>grammar</c>.
/// </summary>
public sealed record GuestCriteria(
    int? Pronunciation,
    int? Stress,
    int? Intonation,
    int? Fluency,
    int? Grammar);

/// <summary>
/// One weak spoken word surfaced as a concrete error (lowest per-word accuracy).
/// Serialized snake_case: <c>word</c>, <c>accuracy</c>, <c>error_type</c>.
/// </summary>
public sealed record GuestWordError(string Word, int Accuracy, string? ErrorType);

/// <summary>
/// The auth-less demo assessment result — the body of <c>POST /guest/assess</c>.
/// Serialized snake_case: <c>transcript</c>,
/// <c>phrase</c>, <c>overall</c>, <c>criteria</c>, <c>errors</c>, <c>level</c>, <c>on_topic</c>,
/// <c>completeness</c>, <c>scored</c>. <c>Scored</c> is <c>false</c> on the Whisper fallback (no
/// pronunciation data).
/// </summary>
public sealed record GuestAssessResponse(
    string? Transcript,
    string Phrase,
    int? Overall,
    GuestCriteria Criteria,
    IReadOnlyList<GuestWordError> Errors,
    string Level,
    bool OnTopic,
    int? Completeness,
    bool Scored);
