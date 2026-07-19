namespace Govori.Contracts;

// ─────────────────────────────────────────────────────────────────────────────
// Administration domain DTOs (docs/07 §3.7, Faza 3.7). Ported from the Python
// admin surface: backend/app/schemas/admin_settings.py (runtime app settings) and
// backend/app/schemas/admin.py (admin user management).
//
// All records serialize/deserialize snake_case via the host's global
// JsonNamingPolicy.SnakeCaseLower (Program.cs), so PascalCase properties reach the
// wire as full_name / is_premium / llm_provider / tg_support_url, matching FastAPI.
//
// NULLABILITY IS LOAD-BEARING on the *Update records: a null (JSON-omitted) field
// means "leave unchanged" and an empty-string field means "clear / revert to the
// env default". This is the tri-state the AppSettings service depends on — see
// AppSettingsService.SetManyAsync (ported from app_settings.set_many).
// ─────────────────────────────────────────────────────────────────────────────

// ─── Runtime app settings (admin_settings.py) ───────────────────────────────

/// <summary>
/// A secret value is never sent to the client — only whether it's set and its last
/// 4 characters as a hint. Mirrors Python's <c>SecretState</c>
/// (admin_settings.py:4-9). JSON: <c>{ "set": bool, "hint": "…" }</c>.
/// </summary>
public sealed record SecretState(bool Set, string Hint = "");

/// <summary>One entry in the curated Gemini-model dropdown shown to admins.
/// Mirrors Python's <c>KnownModel</c> (admin_settings.py:12-17).</summary>
public sealed record KnownModel(string Id, string Label, string Note = "");

/// <summary>
/// The AI-grader + STT settings read model for the admin UI. Faithful port of
/// Python's <c>AiSettingsOut</c> (admin_settings.py:20-42) built by
/// <c>_current()</c> (admin_settings.py:36-79). Secrets appear only masked
/// (<see cref="SecretState"/>); the derived <c>*_ready</c> / <c>*_active_*</c>
/// fields are read-only status for the UI.
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
/// env default), or a new value to store it. Faithful port of Python's
/// <c>AiSettingsUpdate</c> (admin_settings.py:64-81). <c>orthoepy_enabled</c> is a
/// string ("true"/"false") like Python, normalised server-side.
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

/// <summary>The raw value of one secret setting — admin-only, on explicit request.
/// Mirrors Python's <c>RevealOut</c> (admin_settings.py:45-49).</summary>
public sealed record RevealResponse(string Key, string Value);

/// <summary>Outbound links shown in the sidebar contact menu. Mirrors Python's
/// <c>LinksOut</c> (admin_settings.py:52-56).</summary>
public sealed record LinksResponse(string TgSupportUrl, string TgChannelUrl);

/// <summary>Partial update of the outbound links (tri-state, same rules as
/// <see cref="AiSettingsUpdate"/>). Mirrors Python's <c>LinksUpdate</c>
/// (admin_settings.py:59-61).</summary>
public sealed record LinksUpdate(string? TgSupportUrl = null, string? TgChannelUrl = null);

// ─── Admin user management (admin.py) ────────────────────────────────────────

/// <summary>Dashboard counters. Faithful port of Python's <c>AdminStats</c>
/// (admin.py:32-48 / schemas/admin.py:95-101).</summary>
public sealed record AdminStatsResponse(
    int Teachers,
    int Students,
    int Questions,
    int PublishedQuestions,
    int Submissions,
    int EvaluatedSubmissions);

/// <summary>A teacher row with their authored-question count. Mirrors Python's
/// <c>TeacherOut</c> (schemas/admin.py:19-27).</summary>
public sealed record TeacherResponse(
    Guid Id,
    string Email,
    string FullName,
    bool IsActive,
    DateTime CreatedAt,
    int QuestionCount);

/// <summary>Admin edit of a teacher. Mirrors Python's <c>TeacherUpdate</c>
/// (schemas/admin.py:13-16) — <b>minus</b> the password field (see the deferral
/// note in AdministrationService: setting a password requires the frozen auth
/// hasher, an Identity-module primitive this module intentionally does not
/// reference). Null = leave unchanged.</summary>
public sealed record TeacherUpdateRequest(string? FullName = null, bool? IsActive = null);

/// <summary>A student row for the admin management table. Mirrors Python's
/// <c>StudentOut</c> (schemas/admin.py:43-56).</summary>
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
/// and account (de)activation both flow through here. Mirrors Python's
/// <c>UserAdminUpdate</c> (schemas/admin.py:36-40) <b>minus</b> the password field
/// (same deferral as <see cref="TeacherUpdateRequest"/>). Null = leave unchanged.</summary>
public sealed record StudentUpdateRequest(
    string? FullName = null,
    bool? IsActive = null,
    bool? IsPremium = null);
