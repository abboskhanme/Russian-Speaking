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
/// filtered through the teacher's roster (S1 fix — see ClassroomService).
/// </summary>
public sealed record CreateAssignmentRequest(
    Guid QuestionId,
    List<Guid>? StudentIds,
    Guid? GroupId,
    DateTime? DueAt);

/// <summary>
/// Body of POST /api/assignments/module — assign every published task of a module to a
/// group / students in one call.
/// </summary>
public sealed record CreateModuleAssignmentRequest(
    Guid BlockId,
    List<Guid>? StudentIds,
    Guid? GroupId,
    DateTime? DueAt);

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
    double? OverallBand);

/// <summary>One student's line in the gradebook.</summary>
public sealed record GradebookRowResponse(
    Guid StudentId,
    string FullName,
    string Email,
    int Attempts,
    double? AvgBand,
    double? BestBand,
    DateTime? LastActivity);
