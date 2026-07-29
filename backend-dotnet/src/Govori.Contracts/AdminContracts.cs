namespace Govori.Contracts;

// ─────────────────────────────────────────────────────────────────────────────
// Administration domain DTOs (docs/07 §3.7, Faza 3.7). Two surfaces live here:
// runtime app settings (the AI/STT admin panel) and admin user management.
//
// All records serialize/deserialize snake_case via the host's global
// JsonNamingPolicy.SnakeCaseLower (Program.cs), so PascalCase properties reach the
// wire as full_name / is_premium / llm_provider / tg_support_url. The snake_case
// wire shape is load-bearing — the admin UI depends on exactly these names.
//
// NULLABILITY IS LOAD-BEARING on the *Update records: a null (JSON-omitted) field
// means "leave unchanged" and an empty-string field means "clear / revert to the
// env default". This is the tri-state the AppSettings service depends on — see
// AppSettingsService.SetManyAsync.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Runtime app settings ───────────────────────────────────────────────────

/// <summary>
/// A secret value is never sent to the client — only whether it's set and its last
/// 4 characters as a hint. JSON: <c>{ "set": bool, "hint": "…" }</c>.
/// </summary>
public sealed record SecretState(bool Set, string Hint = "");

/// <summary>One entry in the curated Gemini-model dropdown shown to admins.</summary>
public sealed record KnownModel(string Id, string Label, string Note = "");

/// <summary>
/// The AI-grader + STT settings read model for the admin UI. Secrets appear only
/// masked (<see cref="SecretState"/>) — the raw values are never included here; the
/// derived <c>*_ready</c> / <c>*_active_*</c> fields are read-only status for the UI.
/// </summary>
public sealed record AiSettingsResponse(
    string LlmProvider,
    string GeminiModel,
    bool OrthoepyEnabled,
    IReadOnlyList<KnownModel> KnownGeminiModels,
    string AzureOpenaiEndpoint,
    string AzureOpenaiDeployment,
    string AzureOpenaiApiVersion,
    SecretState GeminiApiKey,
    SecretState AzureOpenaiApiKey,
    bool AzureReady,
    string ActiveProvider,
    string SttProvider,
    string AzureSpeechRegion,
    string WhisperModel,
    SecretState AzureSpeechKey,
    SecretState OpenaiApiKey,
    bool AzureSpeechReady,
    string SttActiveProvider);

/// <summary>
/// Partial update of the AI/STT settings. All fields optional. Per the tri-state
/// contract: omit a field to keep it unchanged, send "" to clear it (revert to the
/// env default), or a new value to store it. <c>orthoepy_enabled</c> is deliberately
/// a STRING ("true"/"false"), not a bool, and is normalised server-side.
/// </summary>
public sealed record AiSettingsUpdate(
    string? LlmProvider = null,
    string? GeminiModel = null,
    string? GeminiApiKey = null,
    string? OrthoepyEnabled = null,
    string? AzureOpenaiEndpoint = null,
    string? AzureOpenaiApiKey = null,
    string? AzureOpenaiDeployment = null,
    string? AzureOpenaiApiVersion = null,
    string? SttProvider = null,
    string? AzureSpeechRegion = null,
    string? WhisperModel = null,
    string? AzureSpeechKey = null,
    string? OpenaiApiKey = null);

/// <summary>The raw value of one secret setting — admin-only, on explicit request.</summary>
public sealed record RevealResponse(string Key, string Value);

/// <summary>Outbound links shown in the sidebar contact menu.</summary>
public sealed record LinksResponse(string TgSupportUrl, string TgChannelUrl);

/// <summary>Partial update of the outbound links (tri-state, same rules as
/// <see cref="AiSettingsUpdate"/>).</summary>
public sealed record LinksUpdate(string? TgSupportUrl = null, string? TgChannelUrl = null);

// ─── Admin user management ───────────────────────────────────────────────────

/// <summary>Dashboard counters for the admin landing page.</summary>
public sealed record AdminStatsResponse(
    int Teachers,
    int Students,
    int Questions,
    int PublishedQuestions,
    int Submissions,
    int EvaluatedSubmissions);

/// <summary>A teacher row with their authored-question count.</summary>
public sealed record TeacherResponse(
    Guid Id,
    string Email,
    string FullName,
    bool IsActive,
    DateTime CreatedAt,
    int QuestionCount);

/// <summary>Admin edit of a teacher. There is deliberately <b>no</b> password field
/// (see the deferral note in AdministrationService: setting a password requires the frozen auth
/// hasher, an Identity-module primitive this module intentionally does not
/// reference). Null = leave unchanged.</summary>
public sealed record TeacherUpdateRequest(string? FullName = null, bool? IsActive = null);

/// <summary>A student row for the admin management table.</summary>
public sealed record StudentResponse(
    Guid Id,
    string Email,
    string FullName,
    string? Phone,
    string? Region,
    string? District,
    int? Age,
    bool IsActive,
    bool IsPremium,
    DateTime CreatedAt,
    int SubmissionCount);

/// <summary>Admin edit of a student — the freemium <c>is_premium</c> grant/revoke
/// and account (de)activation both flow through here. No password field, for the
/// same deferral reason as <see cref="TeacherUpdateRequest"/>. Null = leave unchanged.</summary>
public sealed record StudentUpdateRequest(
    string? FullName = null,
    bool? IsActive = null,
    bool? IsPremium = null);
