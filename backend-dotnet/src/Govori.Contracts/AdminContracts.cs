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
/// derived <c>*_ready</c> / <c>*_active_*</c> / <c>ready_*_backends</c> fields are
/// read-only status for the UI.
///
/// <para>The <c>ready_*_backends</c> lists are what let the panel show "selected ≠ active":
/// a backend can sit in the configured chain and never run because nobody entered its key.
/// They are a <b>display</b> of the runtime rule, not the rule itself — the chain skips
/// backends by asking each one, so a discrepancy here is a reporting bug, never a routing
/// one.</para>
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
    // The OpenAI grader's own model. It was the one provider setting with no field at all —
    // stored, read by the backend, and unreachable from the panel.
    string OpenaiGraderModel,
    SecretState AzureSpeechKey,
    SecretState OpenaiApiKey,
    bool AzureSpeechReady,
    string SttActiveProvider,
    // ─── Ordered-chain routing (docs/07 §7.7). The fields above describe the older
    // "one provider each" model and stay exactly as they were: the panel's chain editor
    // and its single-provider pickers ship in that order, so both have to keep working
    // against the same payload.
    string GraderChain,                             // effective order, e.g. "anthropic,gemini,openai"
    string SttChain,                                // effective order, e.g. "azure,whisper"
    IReadOnlyList<string> GraderBackends,           // every implemented grader, in default order
    IReadOnlyList<string> SttBackends,              // every implemented STT backend, in default order
    IReadOnlyList<string> ReadyGraderBackends,      // the subset that actually holds a usable key
    IReadOnlyList<string> ReadySttBackends,
    SecretState AnthropicApiKey,
    string AnthropicModel,
    IReadOnlyList<KnownModel> KnownAnthropicModels,
    // `Openai`, NOT `OpenAi`: JsonNamingPolicy.SnakeCaseLower splits on every case transition,
    // so `KnownOpenAiModels` would reach the wire as `known_open_ai_models` and the panel would
    // silently render an empty suggestion list. The whole file spells it this way for exactly
    // this reason — see OpenaiApiKey and AzureOpenaiEndpoint above.
    IReadOnlyList<KnownModel> KnownOpenaiModels,
    IReadOnlyList<KnownModel> KnownWhisperModels);

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
    string? OpenaiGraderModel = null,
    string? AzureSpeechKey = null,
    string? OpenaiApiKey = null,
    string? GraderChain = null,
    string? SttChain = null,
    string? AnthropicApiKey = null,
    string? AnthropicModel = null);

/// <summary>The raw value of one secret setting — admin-only, on explicit request.</summary>
public sealed record RevealResponse(string Key, string Value);

/// <summary>Outbound links shown in the sidebar contact menu.</summary>
public sealed record LinksResponse(string TgSupportUrl, string TgChannelUrl);

/// <summary>
/// Partial update of the outbound links (tri-state, same rules as <see cref="AiSettingsUpdate"/>).
///
/// <para>A non-empty value must be a link: <c>https://…</c> or <c>http://…</c> is stored as sent,
/// and the two shapes people actually paste for Telegram — a bare <c>t.me/x</c> or an
/// <c>@x</c> handle — are normalised to <c>https://t.me/x</c>. Anything else is a 400
/// <see cref="InvalidLinkResponse"/> naming the field. These values become <c>href</c>s in every
/// student's sidebar, so an unvalidated one is either a dead menu item or a <c>javascript:</c>
/// link.</para>
/// </summary>
public sealed record LinksUpdate(string? TgSupportUrl = null, string? TgChannelUrl = null);

/// <summary>400 body when a link in <see cref="LinksUpdate"/> is not a link. <c>Field</c> is the
/// wire name of the offending field (<c>tg_support_url</c> / <c>tg_channel_url</c>), so the UI can
/// mark the one input that is wrong. <c>Code</c> is <see cref="AdminErrorCodes.InvalidLink"/>.</summary>
public sealed record InvalidLinkResponse(string Detail, string Code, string Field);

// ─── "Does this key actually work?" ─────────────────────────────────────────

/// <summary>
/// One backend's answer to the probe.
///
/// <para><c>Configured=false</c> means SKIPPED, not failed — the same distinction the provider
/// chain draws. A backend with no key is a deliberate state (Claude ships that way), and painting
/// it red would train the admin to ignore the colour that matters.</para>
/// </summary>
/// <param name="Kind"><c>grader</c> or <c>stt</c>.</param>
/// <param name="Model">What the vendor said it served — the answer to "is my model id valid".</param>
/// <param name="Error">The vendor's own message, trimmed. This is the field the admin acts on.</param>
public sealed record ProviderProbe(
    string Name,
    string Kind,
    bool Configured,
    bool Ok,
    string? Model,
    string? Error,
    int ElapsedMs);

/// <summary>Probe results, in the chain's own order so the list reads as the routing does.</summary>
public sealed record AiProbeResponse(IReadOnlyList<ProviderProbe> Results);

// ─── Faza 6 feature flags ────────────────────────────────────────────────────

/// <summary>
/// The Faza 6 feature switches, read model for the admin UI.
///
/// <para>These live in their own contract rather than inside <see cref="AiSettingsResponse"/>
/// because they are not AI configuration: they decide whether a SURFACE exists at all. Folding a
/// feature switch into a screen named "AI sozlamalari" is how a setting ends up somewhere nobody
/// thinks to look for it.</para>
///
/// <para>Without this the flags were reachable only by hand-writing an <c>app_settings</c> row or
/// restarting with an env var — which means a feature that shipped behind a flag did not, in
/// practice, ship at all for the person who owns the product.</para>
/// </summary>
public sealed record FeatureFlagsResponse(
    bool ReviewDrillEnabled,
    bool RoleplayEnabled,
    int RoleplayMaxTurns,
    int RoleplayDailyTurns,
    /// <summary>F6 · the teacher's one-tap remediation on Analitika · Insaytlar. ADDITIVE
    /// (appended last), default off.</summary>
    bool ClassInsightsEnabled = false,
    /// <summary>F3 · «Kunlik 5 daqiqa», the daily session on Home. ADDITIVE (appended last),
    /// default off.</summary>
    bool DailyFiveEnabled = false,
    /// <summary>F2 · the phoneme drill on minimal pairs. ADDITIVE (appended last), default off —
    /// the attempt route spends Azure calls.</summary>
    bool PhonemeDrillEnabled = false,
    /// <summary>F2 · attempts per student per product day (<see cref="ProductDay"/>, Tashkent local
    /// midnight). Mirrors <c>DrillService</c>'s default of 40.</summary>
    int PhonemeDrillDailyAttempts = 40,
    /// <summary>Faza 6.6 · the payment surface. ADDITIVE (appended last), default OFF — and OFF is
    /// not the only gate: with no configured provider a checkout is refused even when this is on,
    /// so switching it up cannot open a flow that takes money nothing can collect.</summary>
    bool PaymentsEnabled = false);

/// <summary>
/// Partial update of the feature flags. Same tri-state contract as every other settings write:
/// omit a field to leave it alone, send <c>""</c> to clear the override back to the environment
/// default, or a value to store it.
///
/// <para>Every field is a STRING, including the two booleans — the same choice
/// <c>orthoepy_enabled</c> already makes. A <c>bool?</c> can only express two of the three states
/// the tri-state needs, so "turn this off" and "leave it as it is" would collapse into the same
/// request and an admin toggling one flag would silently clear the other.</para>
/// </summary>
public sealed record FeatureFlagsUpdate(
    string? ReviewDrillEnabled = null,
    string? RoleplayEnabled = null,
    string? RoleplayMaxTurns = null,
    string? RoleplayDailyTurns = null,
    string? ClassInsightsEnabled = null,
    string? DailyFiveEnabled = null,
    string? PhonemeDrillEnabled = null,
    string? PhonemeDrillDailyAttempts = null,
    string? PaymentsEnabled = null);

// ─── Admin user management ───────────────────────────────────────────────────

/// <summary>
/// Dashboard counters for the admin landing page.
///
/// <para><c>Questions</c> / <c>PublishedQuestions</c> count only tasks that are not soft-deleted:
/// <c>DELETE /api/questions/{id}</c> keeps the row (student history points at it), and a counter
/// that still included it would tell the admin a deleted task exists.</para>
/// </summary>
public sealed record AdminStatsResponse(
    int Teachers,
    int Students,
    int Questions,
    int PublishedQuestions,
    int Submissions,
    int EvaluatedSubmissions,
    /// <summary>ADDITIVE · submissions still waiting for a grade (status <c>pending</c> or
    /// <c>processing</c>). A number that only grows means the grading worker is not draining the
    /// queue.</summary>
    int PendingSubmissions = 0,
    /// <summary>ADDITIVE · submissions whose grading failed (status <c>failed</c>) — the student
    /// saw an error instead of a score.</summary>
    int FailedSubmissions = 0);

/// <summary>A teacher row with their authored-question count (soft-deleted tasks excluded).</summary>
public sealed record TeacherResponse(
    Guid Id,
    string Email,
    string FullName,
    bool IsActive,
    DateTime CreatedAt,
    int QuestionCount,
    /// <summary>ADDITIVE · the canonical <c>+998XXXXXXXXX</c> the teacher signs in with, or null
    /// for an account that has none (a legacy email/Google account). Phone is the login now, so it is
    /// the identifier an admin actually recognises.</summary>
    string? Phone = null);

/// <summary>
/// Body of <c>POST /api/admin/teachers</c> — the only way to create a teacher (self-service sign-up
/// always makes a student). <c>phone</c> is normalised exactly as sign-up does
/// (<see cref="PhoneNumbers.NormalizeUz"/>); the teacher then signs in with that number through the
/// normal Telegram OTP flow. There is no password: accounts are passwordless.
/// </summary>
public sealed record CreateTeacherRequest(string? Phone, string? FullName);

/// <summary>409 body when <c>POST /api/admin/teachers</c> names a phone that already belongs to a
/// STUDENT. Carries the student's id and name so the UI can offer to promote that account
/// (<c>PATCH /api/admin/users/{id}/role</c>) instead of creating a duplicate person. <c>Code</c> is
/// <see cref="AdminErrorCodes.PhoneTakenByStudent"/>.</summary>
public sealed record PhoneTakenByStudentResponse(string Detail, string Code, Guid UserId, string FullName);

/// <summary>Admin edit of a teacher. Null = leave unchanged. There is no password field because
/// accounts are passwordless (phone + Telegram OTP), and no role field: a role change has its own
/// guarded route, <c>PATCH /api/admin/users/{id}/role</c>.</summary>
public sealed record TeacherUpdateRequest(string? FullName = null, bool? IsActive = null);

/// <summary>Body of <c>PATCH /api/admin/users/{id}/role</c>: <c>"student"</c>, <c>"teacher"</c> or
/// <c>"admin"</c>.</summary>
public sealed record UserRoleUpdateRequest(string? Role);

/// <summary>Result of a role change: the user and the role they now hold.</summary>
public sealed record UserRoleResponse(Guid Id, string Role);

/// <summary>409 body when demoting a user to student who still owns groups: their students would be
/// left in classes nobody can teach. <c>GroupCount</c> is how many to hand over or delete first.
/// <c>Code</c> is <see cref="AdminErrorCodes.TeacherOwnsGroups"/>.</summary>
public sealed record TeacherOwnsGroupsResponse(string Detail, string Code, int GroupCount);

/// <summary>
/// One row of <c>GET /api/admin/admins</c> — the same core fields as <see cref="TeacherResponse"/>
/// (admins author official modules too, so the question count is meaningful), plus
/// <c>IsSelf</c>: the caller's own row, whose role control the UI must disable because
/// <c>cannot_change_own_role</c> would refuse it anyway.
/// </summary>
public sealed record AdminUserResponse(
    Guid Id,
    string Email,
    string FullName,
    string? Phone,
    bool IsActive,
    DateTime CreatedAt,
    int QuestionCount,
    bool IsSelf);

/// <summary>
/// The <c>code</c> values the Administration endpoints put in an error body
/// (<see cref="CodedErrorResponse"/> and its richer siblings). Wire contract: the admin UI branches
/// on these, so renaming one is a breaking change.
/// </summary>
public static class AdminErrorCodes
{
    /// <summary>400 · the phone is not a valid Uzbek number.</summary>
    public const string InvalidPhone = "invalid_phone";

    /// <summary>400 · <c>full_name</c> is blank or longer than the 255-character column.</summary>
    public const string InvalidFullName = "invalid_full_name";

    /// <summary>409 · the phone belongs to a teacher or an admin already (or its derived login email
    /// is held by an account that has since changed number).</summary>
    public const string PhoneTaken = "phone_taken";

    /// <summary>409 · the phone belongs to a student — see <see cref="PhoneTakenByStudentResponse"/>.</summary>
    public const string PhoneTakenByStudent = "phone_taken_by_student";

    /// <summary>400 · <c>role</c> is not student / teacher / admin.</summary>
    public const string InvalidRole = "invalid_role";

    /// <summary>400 · an admin tried to change their own role.</summary>
    public const string CannotChangeOwnRole = "cannot_change_own_role";

    /// <summary>409 · the change would leave no active admin.</summary>
    public const string LastAdmin = "last_admin";

    /// <summary>409 · demoting to student a user who still owns groups — see
    /// <see cref="TeacherOwnsGroupsResponse"/>.</summary>
    public const string TeacherOwnsGroups = "teacher_owns_groups";

    /// <summary>400 · a contact link is not a link — see <see cref="InvalidLinkResponse"/>.</summary>
    public const string InvalidLink = "invalid_link";

    /// <summary>400 · a group transfer named the teacher who already owns the group.</summary>
    public const string SameTeacher = "same_teacher";

    /// <summary>400 · a group transfer's <c>teacher_id</c> is missing, unknown, not a teacher, or a
    /// suspended teacher. One code for all four: the picker only offers active teachers, so any of
    /// them means the list the admin chose from is stale — the remedy (reload, pick again) is the
    /// same.</summary>
    public const string InvalidTargetTeacher = "invalid_target_teacher";
}

/// <summary>
/// Body of <c>POST /api/admin/groups/{id}/transfer</c>: the ACTIVE teacher who should own the group
/// from now on. Nullable so an absent field is a coded 400 (<see cref="AdminErrorCodes.InvalidTargetTeacher"/>)
/// rather than a framework binding error with no code.
/// </summary>
public sealed record GroupTransferRequest(Guid? TeacherId);

/// <summary>
/// Result of a group transfer — what the admin needs to confirm that the right thing moved:
/// the group, who had it and who has it now, how many students went with it, and how many of the
/// previous teacher's assignments set through this group were handed over
/// (<c>AssignmentsMoved</c>). The full rules are on <c>GroupTransferService.TransferAsync</c>.
/// </summary>
public sealed record GroupTransferResponse(
    Guid GroupId,
    string GroupName,
    Guid FromTeacherId,
    string FromTeacherName,
    Guid ToTeacherId,
    string ToTeacherName,
    int MemberCount,
    int AssignmentsMoved);

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
/// and account (de)activation both flow through here. No password or role field, for the
/// same reasons as <see cref="TeacherUpdateRequest"/>. Null = leave unchanged.</summary>
public sealed record StudentUpdateRequest(
    string? FullName = null,
    bool? IsActive = null,
    bool? IsPremium = null);

/// <summary>
/// One row of <c>GET /api/admin/audit</c>: a successful admin mutation. <c>ActorName</c> is null when
/// the acting account has since been deleted (the row survives it; <c>ActorId</c> still says who).
/// <c>Fields</c> are the request fields the admin SENT — for a settings save, which keys changed —
/// and <c>Values</c> holds values only for the per-endpoint allow-list; a credential's value is
/// never stored, so it can never be listed here.
/// </summary>
public sealed record AdminAuditEntryResponse(
    Guid Id,
    DateTime CreatedAt,
    Guid ActorId,
    string? ActorName,
    string Action,
    string TargetType,
    string? TargetId,
    string? TargetLabel,
    IReadOnlyList<string> Fields,
    IReadOnlyDictionary<string, string> Values,
    string? Ip);

/// <summary><c>GET /api/admin/audit</c> — one page, newest first. <c>Total</c> counts every row that
/// matches the filters, so the UI can say "page 2 of 7" without a second request.</summary>
public sealed record AdminAuditPageResponse(
    IReadOnlyList<AdminAuditEntryResponse> Items,
    int Total,
    int Page,
    int PageSize);
