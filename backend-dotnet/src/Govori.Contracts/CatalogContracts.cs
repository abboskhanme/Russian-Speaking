namespace Govori.Contracts;

/// <summary>
/// One task inside a student's module view, carrying BOTH lock layers. Serialized snake_case:
/// <c>sort_order</c>, <c>premium_locked</c>.
///
/// <para><b>Two-layer lock</b> — the two flags are independent and a task may carry either or
/// both; the UI must respect both before letting a student start:</para>
/// <list type="bullet">
///   <item><c>Locked</c> — SEQUENTIAL: the previous task in the module is not done yet.</item>
///   <item><c>PremiumLocked</c> — FREEMIUM: this task is beyond the free preview of an
///   official PUBLIC module and the student is non-premium.</item>
/// </list>
/// <c>Type</c> is the lowercase PG enum label ("text"/"image"/"video"), stringified so it never
/// serializes as an int.
///
/// <para><c>Band</c> (serialized <c>band</c>) is the caller's BEST overall band for this task —
/// the max <c>Evaluation.OverallBand</c> across their submissions for the question, rounded to a
/// whole number and clamped 0..100 — or <c>null</c> when the task was never graded. It feeds the
/// score chip on done rows in the module detail screen.</para>
/// </summary>
public sealed record StudentTaskResponse(
    Guid Id,
    string Title,
    string Type,
    string? Level,
    int SortOrder,
    bool Done,
    bool Locked,
    bool PremiumLocked,
    int? Band);

/// <summary>
/// A module a student can work through, with its ordered tasks. Serialized snake_case:
/// <c>ru_style</c>, <c>cover_url</c>, <c>done_count</c>, <c>next_task_id</c>.
///
/// <para><c>Visibility</c> is "public" (official platform module) or "group" (the student's
/// teacher's module). <c>NextTaskId</c> is the current actionable task — the first task that is
/// not done, not sequentially locked, and not premium-locked (null when none is actionable).</para>
///
/// <para><c>CoverUrl</c> is always null for now: it is meant to hold a presigned GET URL for the
/// module's <c>cover_key</c>, minted by the not-yet-wired Govori.Platform.Storage layer
/// (docs/07 §7.2). The field is kept in the shape so the client contract is stable when Storage
/// lands.</para>
///
/// <para><c>SpentSec</c> (serialized <c>spent_sec</c>) is the caller's total time on this module —
/// the SUM of <c>Submission.AudioDurationSec</c> across the module's tasks, rounded to whole
/// seconds; <c>0</c> when they have no submissions here. It feeds the "vaqt" stat on the module
/// complete screen.</para>
/// </summary>
public sealed record StudentModuleResponse(
    Guid Id,
    string Name,
    string? Topic,
    string? Level,
    string? RuStyle,
    string Visibility,
    string? CoverUrl,
    int Total,
    int DoneCount,
    Guid? NextTaskId,
    IReadOnlyList<StudentTaskResponse> Tasks,
    int SpentSec);
