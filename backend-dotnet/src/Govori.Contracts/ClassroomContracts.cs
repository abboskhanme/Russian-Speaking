namespace Govori.Contracts;

// ─── Classroom domain DTOs (docs/07 §3.5, Faza 3.5) ─────────────────────────
// Groups + assignments + the gradebook. Every field serializes snake_case via the host's
// global JsonNamingPolicy.SnakeCaseLower (Program.cs), so `JoinCode` → "join_code",
// `StudentIds` → "student_ids", etc. The snake_case wire shape is LOAD-BEARING: existing
// clients depend on it, so property renames must preserve the serialized name.

// ── Requests ──

/// <summary>Body of POST /api/groups — creates a group. JSON: <c>{ "name": ... }</c>.</summary>
public sealed record CreateGroupRequest(string? Name);

/// <summary>Body of POST /api/groups/join — join by invite code. JSON: <c>{ "code": ... }</c>.</summary>
public sealed record JoinGroupRequest(string? Code);

/// <summary>
/// Body of POST /api/assignments — assign one question. Targets are the
/// union of explicit <c>student_ids</c> and the whole <c>group_id</c>'s members; both are then
/// filtered through the teacher's roster (S1 fix — see ClassroomService). A target who already has
/// an OPEN assignment for this question (not yet answered, deadline not passed) is skipped, and the
/// 201 body lists only the rows actually created — so an empty array means "everyone already had
/// it", which is what the UI's "takror berilmaydi" promises. A soft-deleted question is a 404 like
/// a missing one; an unpublished one is a 400 <c>question_not_published</c>.
/// </summary>
public sealed record CreateAssignmentRequest(
    Guid QuestionId,
    List<Guid>? StudentIds,
    Guid? GroupId,
    DateTime? DueAt,
    /// <summary>How many answers the student may submit. OMIT or <c>null</c> for unlimited — the
    /// behaviour every assignment had before this field existed. 1–10 when given.</summary>
    int? MaxAttempts = null);

/// <summary>
/// Body of POST /api/assignments/module — assign every published task of a module to a
/// group / students in one call.
/// </summary>
public sealed record CreateModuleAssignmentRequest(
    Guid BlockId,
    List<Guid>? StudentIds,
    Guid? GroupId,
    DateTime? DueAt,
    /// <summary>Applied to EVERY task the module produces — a per-task budget, not a shared one.
    /// Omit or <c>null</c> for unlimited. 1–10 when given.</summary>
    int? MaxAttempts = null);

// ── Responses ──

/// <summary>A student row inside a group's roster.</summary>
public sealed record GroupMemberResponse(
    Guid Id,
    string FullName,
    string Email,
    bool IsPremium,
    int SubmissionCount,
    /// <summary>When they became a member — the "qo'shilgan mart" line on the student profile.
    /// ADDITIVE (appended); the value was already on <c>GroupMember.CreatedAt</c> and merely
    /// never projected.</summary>
    DateTime JoinedAt);

/// <summary>A group, as the teacher/owner sees it in lists.</summary>
public sealed record GroupResponse(
    Guid Id,
    string Name,
    string JoinCode,
    int MemberCount,
    Guid? TeacherId,
    string? TeacherName,
    DateTime CreatedAt);

/// <summary>
/// Result of POST /api/groups/join. An ADDITIVE superset of <see cref="GroupResponse"/> — every
/// field of the old response is still present at the same wire name, so a client that only knows
/// the old shape keeps working; <c>pending</c> is the one new field.
///
/// <para><c>pending = true</c> means a join REQUEST was filed and the owning teacher must approve it
/// before the caller is a member. <c>pending = false</c> means the caller already was a member
/// (re-joining is a no-op). A caller that ignores the flag and assumes membership would be wrong,
/// which is exactly why the flag is on the response rather than only on a separate lookup.</para>
/// </summary>
public sealed record JoinGroupResponse(
    Guid Id,
    string Name,
    string JoinCode,
    int MemberCount,
    Guid? TeacherId,
    string? TeacherName,
    DateTime CreatedAt,
    bool Pending);

/// <summary>
/// One pending join request, as the owning teacher sees it in the "So'rovlar" tab. Carries the group
/// name + code so the row reads standalone ("Kod: KECHKI-3 · 2 soat oldin") without a second fetch.
/// </summary>
public sealed record GroupJoinRequestResponse(
    Guid Id,
    Guid GroupId,
    string GroupName,
    string JoinCode,
    Guid StudentId,
    string StudentName,
    string StudentEmail,
    DateTime CreatedAt);

/// <summary>A group plus its roster — <see cref="GroupResponse"/> extended with its members.</summary>
public sealed record GroupDetailResponse(
    Guid Id,
    string Name,
    string JoinCode,
    int MemberCount,
    Guid? TeacherId,
    string? TeacherName,
    DateTime CreatedAt,
    IReadOnlyList<GroupMemberResponse> Members);

/// <summary>
/// One assignment with its live completion state.
/// <c>OverallBand</c> is the level-relative <c>effective_band</c> of the matching submission
/// (field name kept for API compatibility), not the absolute C2 band.
/// </summary>
public sealed record AssignmentResponse(
    Guid Id,
    Guid StudentId,
    string? StudentName,
    Guid QuestionId,
    string? QuestionTitle,
    string? QuestionTopic,
    string? QuestionLevel,
    DateTime? DueAt,
    DateTime CreatedAt,
    bool Completed,
    Guid? SubmissionId,
    double? OverallBand,
    /// <summary>The attempt budget, or <c>null</c> for unlimited.</summary>
    int? MaxAttempts = null,
    /// <summary>Attempts already spent on THIS assignment. Counts answers carrying its id and
    /// excludes the ones whose grading FAILED — a broken pipeline must not cost a student a try.
    /// Always present, so the UI can show "2/3" whether or not a limit is set.</summary>
    int AttemptsUsed = 0);

/// <summary>
/// One student's line in the gradebook.
///
/// <para>The four per-skill averages are ADDITIVE (appended at the end of the positional list, the
/// same append-only technique <see cref="MeResponse"/> documents), so a client that only knows the old shape
/// keeps working. They are averaged over the SAME recent window <c>ClassroomScoring.RollingAvg</c>
/// uses, so a row's <c>avg_band</c> and its skills always describe the same set of answers. Each is
/// <c>null</c> — never <c>0</c> — when that skill has no values, because "unscored" and "scored
/// zero" must not render alike.</para>
/// </summary>
public sealed record GradebookRowResponse(
    Guid StudentId,
    string FullName,
    string Email,
    int Attempts,
    double? AvgBand,
    double? BestBand,
    DateTime? LastActivity,
    double? Fluency = null,
    double? Grammar = null,
    double? Pronunciation = null,
    double? Lexical = null,
    /// <summary>Which way this student is moving: the newer half of their recent graded answers minus
    /// the older half, 2dp. Positive = improving. This is what the A4 roster's ↑/↓ arrow and the A1
    /// Obzor's "N o'quvchi ball tushirdi" card read.
    ///
    /// <para><c>null</c> under four graded answers — a single answer is not a direction — and it is
    /// NOT the difference between two <c>avg_band</c> values, so do not present it as one.</para></summary>
    double? TrendDelta = null);

// ─── Analitika · D1 Insaytlar (GET /api/reports/insights) ────────────────────
// One composed read behind the teacher's Analitika screen. Every number here is derived from rows
// that already exist (submissions · evaluations · assignments · group_members) — no new table and no
// migration. Anything the mockup shows that has NO such row is deliberately absent rather than
// invented; the plan file records those omissions.

/// <summary>
/// The Analitika · Insaytlar payload. Scoped exactly like the gradebook (the answers of the caller's
/// OWN roster, to any question — <c>TeacherScope</c>; <c>group_id</c> narrows, never widens).
///
/// <para><b>Two different class averages live here on purpose.</b> <see cref="ClassAvg"/> is the mean
/// of the per-student rolling averages — i.e. the mean of the very <c>avg_band</c> values the D2
/// Jurnal table prints, so the headline can never disagree with the table under it. The
/// <see cref="Trend"/> points are per-SUBMISSION means, which is volume-weighted: a month is
/// summarised by the answers actually given in it. Averaging students would make a month in which
/// only one student practised look like the whole class.</para>
/// </summary>
public sealed record InsightsResponse(
    /// <summary>Mean of the per-student rolling averages, 2dp. Students with no graded attempt are
    /// EXCLUDED, never counted as zero. <c>null</c> when nobody is graded.</summary>
    double? ClassAvg,
    /// <summary><see cref="CefrScale"/> applied to <see cref="ClassAvg"/>; both null when it is.</summary>
    string? ClassLevel,
    string? ClassLevelLabel,
    /// <summary>Change between the two most recent months that BOTH have a graded average, 2dp.
    /// Empty months are skipped rather than nulling the chip: "this month minus last month" would be
    /// blank for the first days of every month, which is exactly when the screen gets opened.
    /// <c>null</c> when fewer than two months have anything graded — one point is not a trend, and an
    /// unknown change is not a change of zero.</summary>
    double? TrendDelta,
    /// <summary>Exactly 3 entries, oldest first, ending with the current calendar month. Always 3
    /// even when empty, so the chart has a fixed x-axis.</summary>
    IReadOnlyList<InsightsMonthPoint> Trend,
    /// <summary>Roster students with at least one answer in the last 7×24h.</summary>
    int ActiveStudents,
    /// <summary>Roster size after the group filter — the denominator of "41 / 48".</summary>
    int TotalStudents,
    /// <summary>Assignments counted done by the SAME rule <see cref="AssignmentResponse.Completed"/>
    /// uses (a matching answer not older than the assignment), never a second definition.</summary>
    int AssignmentsDone,
    int AssignmentsTotal,
    /// <summary>Σ of the last 7×24h of answer audio, in SECONDS. The UI shows minutes; the wire keeps
    /// the raw unit so rounding happens once, at the edge.</summary>
    int PracticeSecWeek,
    /// <summary>Answers whose <c>reviewed_at</c> falls in the last 7×24h.</summary>
    int ReviewedWeek,
    InsightsSkillsResponse Skills,
    /// <summary>Exactly 7 entries, oldest first, ending today (UTC) — an all-zero week still renders
    /// its axis.</summary>
    IReadOnlyList<InsightsDayPoint> Week,
    /// <summary>Top 5 correction types by frequency; empty when nothing has been corrected.</summary>
    IReadOnlyList<InsightsErrorResponse> Errors,
    /// <summary>Whether the F6 one-tap remediation ("Mashq ber") exists in this deployment — the
    /// <c>class_insights_enabled</c> flag. ADDITIVE (appended last) and <c>false</c> by default, so a
    /// client that predates the flag sees exactly the payload it always saw.
    ///
    /// <para>This is what separates "the feature is not switched on here" (draw no button at all)
    /// from "the feature is on but this error has no drill" (draw the button DISABLED with a reason).
    /// Collapsing the two would either advertise a feature that does not exist or hide the fact that
    /// the class has nothing to practise.</para></summary>
    bool RemediationEnabled = false,
    /// <summary>How many DISTINCT students must have made an error before a remediation is offered
    /// for it — the "12 o'quvchi qoqildi" bar, stated as a number rather than left implicit. <c>0</c>
    /// while <see cref="RemediationEnabled"/> is false. ADDITIVE (appended last).
    ///
    /// <para>It is on the wire so the threshold is defined ONCE, on the server that applies it: a
    /// client that hard-coded its own copy would eventually disagree about which rows are "rare" and
    /// disable a button the server was willing to serve. The client compares it against the row's own
    /// <see cref="InsightsErrorResponse.StudentCount"/> — the very number the row already displays —
    /// so the explanation ("2 o'quvchi, kamida 3 kerak") always matches what the teacher can see.</para></summary>
    int RemediationMinStudents = 0);

/// <summary>One month of the class trend. <c>Avg</c> is null for a month with nothing graded — the
/// chart must draw a GAP there, not a drop to zero.</summary>
public sealed record InsightsMonthPoint(int Year, int Month, double? Avg, int Attempts);

/// <summary>One day of the weekly activity chart. Serializes as <c>"2026-08-06"</c>.</summary>
public sealed record InsightsDayPoint(DateOnly Date, int Attempts);

/// <summary>
/// Class-wide skill means over the graded answers in scope, 2dp. Each is <c>null</c> when it has no
/// values; <c>pronunciation_score</c> in particular is nullable per evaluation, and a missing one
/// must not be folded in as a zero that drags the mean down.
/// </summary>
public sealed record InsightsSkillsResponse(
    double? Fluency,
    double? Grammar,
    double? Pronunciation,
    double? Lexical);

/// <summary>
/// One "Ko'p uchragan xatolar" row. <see cref="Type"/> is the correction's raw <c>type</c> string
/// VERBATIM (an open-ended vocabulary the grader writes — today's data holds <c>word_order</c> and
/// <c>relevance</c>). It is deliberately not normalised, translated or bucketed here: the client maps
/// known types to labels and falls back to the raw string, so a type nobody has seen yet still shows
/// up instead of vanishing into an "other" pile.
/// </summary>
public sealed record InsightsErrorResponse(
    string Type,
    int Count,
    /// <summary>Distinct students who made this error — the "12 o'quvchi" half of the row.</summary>
    int StudentCount,
    /// <summary>This type's share of ALL corrections in scope, 0..1 rounded to 4dp.</summary>
    double Share,
    /// <summary>The one-tap remediation for this row, or <c>null</c> when there is nothing to assign.
    /// ADDITIVE (appended last). Always <c>null</c> while
    /// <see cref="InsightsResponse.RemediationEnabled"/> is false, and always <c>null</c> for a row
    /// below <see cref="InsightsResponse.RemediationMinStudents"/> — the row still SHOWS (the teacher
    /// should know), it just gets no button.</summary>
    InsightsRemediationResponse? Remediation = null);

/// <summary>
/// F6 · what "Mashq ber" would send: ONE task, and exactly the students to send it to.
///
/// <para><b>Where the task comes from — the design decision behind F6.</b> Nothing in the data maps
/// an error TYPE to a task. <c>questions</c> carries <c>topic</c> / <c>level</c> / <c>ru_style</c>,
/// none of which describes a grammatical phenomenon, and the correction vocabulary the grader
/// actually writes is a handful of phenomenon names (<c>word_order</c>, <c>grammar</c>,
/// <c>lexical</c>, <c>pronunciation_hint</c>, <c>style</c>, <c>relevance</c>). A hand-written
/// type→topic table would be invention: nothing says the "Еда и вкусы" prompt drills word order.</para>
///
/// <para>So the mapping is the one the graded answers already MEASURED: the task is the question the
/// caller may assign (their own; admin: any) on which this error type occurred most often inside the
/// caller's scope — the prompt this class demonstrably stumbles on. Re-assigning it is remediation with no invented data, and it composes
/// with the existing completion rule (<see cref="AssignmentResponse.Completed"/> counts an answer
/// given AFTER the assignment), so a question a student has already answered once is still a real,
/// open task the second time it is set.</para>
///
/// <para>A <c>question_error_tags</c> table was considered and rejected: filled by hand it stays
/// empty and the button stays dead forever; derived from the grader it is a CACHE of this very
/// query over one teacher's bounded roster — not worth a migration. Same reasoning keeps
/// <c>class_insights</c> unbuilt: every number on this screen is composed from
/// <c>submissions · evaluations · assignments · group_members</c> in the read that already runs.</para>
/// </summary>
public sealed record InsightsRemediationResponse(
    Guid QuestionId,
    string QuestionTitle,
    string? QuestionTopic,
    string? QuestionLevel,
    /// <summary>Exactly the roster students who made this error AND do not already have an
    /// outstanding assignment for this question — i.e. the rows a confirmed "Mashq ber" creates,
    /// listed by name so the teacher sees WHO before an irreversible fan-out. It can be EMPTY while
    /// the task itself exists: everyone affected already has it open, which is a reason to disable
    /// the button, not to hide the task.</summary>
    IReadOnlyList<InsightsRemediationStudent> Students);

/// <summary>One recipient of a remediation assignment. Roster-scoped, so it exposes nothing the
/// caller cannot already read from their own group detail.</summary>
public sealed record InsightsRemediationStudent(Guid Id, string FullName);

// ─── Group + assignment management (after-launch audit, P1) ──────────────────
// A teacher could create a group and hand out work, and then could change neither: no rename, no
// fresh join code, no way to remove one student or the whole group, no way to take an assignment
// back or move its deadline. These are the bodies and results of those routes. Every 400 they
// produce carries a machine `code` beside the human `detail` ({ "detail": ..., "code": ... }) so a
// client can branch on the reason without parsing prose.

/// <summary>
/// Body of PATCH /api/groups/{id}. Both fields are optional; an absent or <c>null</c> one leaves the
/// group alone.
///
/// <para><c>name</c> is trimmed and must be non-blank and at most 128 characters (the column's
/// width) — a blank name is a 400 <c>name_required</c>, never a silent fallback to "Группа" the way
/// creation does it, because renaming a group to nothing is a mistake, not a default. Too long is a
/// 400 <c>name_too_long</c>.</para>
///
/// <para><c>level</c> is accepted in the shape but REFUSED with 400 <c>level_not_supported</c>
/// when given: <c>groups</c> has no level column (the CEFR badge on a group card is DERIVED from its
/// students' average band), and storing a teacher-set level needs a migration this change does not
/// make. Refusing loudly beats accepting a value that would then vanish.</para>
/// </summary>
public sealed record UpdateGroupRequest(string? Name = null, string? Level = null);

/// <summary>Body of POST /api/assignments/cancel — take back one task from one group: every row
/// of the caller's for <c>question_id</c> that was assigned through <c>group_id</c>. Student answers
/// and their grades are untouched.</summary>
public sealed record CancelGroupAssignmentsRequest(Guid QuestionId, Guid GroupId);

/// <summary>Result of POST /api/assignments/cancel — how many assignment rows were removed (0 when
/// there were none; the call is idempotent).</summary>
public sealed record CancelGroupAssignmentsResponse(int Cancelled);

/// <summary>
/// Body of PATCH /api/assignments/group — move the deadline of one task across one group.
///
/// <para><c>due_at</c> is REQUIRED but may be <c>null</c>: an ISO-8601 instant sets the deadline,
/// an explicit <c>null</c> removes it ("muddatsiz"). A body without the key is a 400
/// <c>due_at_required</c> rather than being read as <c>null</c> — otherwise a client that forgot the
/// field would silently wipe the deadline of a whole group's work. A past instant is a 400
/// <c>due_in_past</c>. A value with no offset is read as UTC.</para>
///
/// <para>Presence is tracked through the init accessor (System.Text.Json only calls it for keys
/// that are in the body), which is why this is not a positional record.</para>
/// </summary>
public sealed record UpdateGroupAssignmentsRequest
{
    private readonly DateTime? _dueAt;

    public Guid QuestionId { get; init; }

    public Guid GroupId { get; init; }

    public DateTime? DueAt
    {
        get => _dueAt;
        init { _dueAt = value; HasDueAt = true; }
    }

    /// <summary>Whether <c>due_at</c> was in the body at all (explicit <c>null</c> included).
    /// Server-side only — never on the wire.</summary>
    [System.Text.Json.Serialization.JsonIgnore]
    public bool HasDueAt { get; private init; }
}

/// <summary>Result of PATCH /api/assignments/group — how many assignment rows now carry the new
/// deadline.</summary>
public sealed record UpdateGroupAssignmentsResponse(int Updated);

// ─── Teacher-granted premium + the A6 student card ───────────────────────────

/// <summary>
/// Body of PATCH /api/classroom/students/{id}/premium — the teacher's freemium grant/revoke
/// ("Premiumni o'qituvchingiz berishi mumkin"). <c>is_premium</c> is required; a body without it is
/// a 400 <c>is_premium_required</c> rather than a silent revoke.
/// </summary>
public sealed record SetStudentPremiumRequest(bool? IsPremium = null);

/// <summary>
/// Result of the premium PATCH.
///
/// <para><c>is_premium</c> is the GRANT this route writes (<c>users.is_premium</c>) — the toggle's
/// state. <c>has_premium</c> is what the student actually gets: the grant OR an active paid
/// subscription (PremiumAccess, the one definition the paywall uses). They differ exactly when a
/// student pays for themselves, and a toggle that shows "off" for someone who still has premium
/// would read as broken without it. ADDITIVE beyond the two-field shape the route was specified
/// with.</para>
/// </summary>
public sealed record StudentPremiumResponse(Guid Id, bool IsPremium, bool HasPremium);

/// <summary>
/// GET /api/classroom/students/{id} — the header of the teacher's A6 student profile: who the
/// student is, the premium grant (so the screen can draw the toggle) and which of the caller's
/// groups they sit in. It exists because A6 is also opened WITHOUT a <c>?group=</c> (from the
/// Klasslar "O'quvchilar" tab and the dashboard), and then no other response carries the student at
/// all. Same visibility as the premium PATCH: a teacher reads only their own roster (404 otherwise).
/// </summary>
public sealed record ClassroomStudentResponse(
    Guid Id,
    string FullName,
    string Email,
    /// <summary>The teacher/admin grant — the toggle's state. See <see cref="StudentPremiumResponse"/>.</summary>
    bool IsPremium,
    /// <summary>Effective premium: the grant OR an active subscription.</summary>
    bool HasPremium,
    /// <summary>The caller's groups this student is a member of (admin: all of them), oldest
    /// membership first.</summary>
    IReadOnlyList<ClassroomStudentGroupResponse> Groups);

/// <summary>One group a student sits in, as the A6 header shows it.</summary>
public sealed record ClassroomStudentGroupResponse(Guid Id, string Name, DateTime JoinedAt);
