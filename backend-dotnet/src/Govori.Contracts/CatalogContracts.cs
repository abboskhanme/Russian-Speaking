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

/* ── Teacher authoring (Kontent board C1 · C2 · C4 · C5) ────────────────────── */
// A new HTTP surface over the EXISTING question_blocks / questions tables — no
// schema change. Serialized snake_case like everything else.

/// <summary>
/// One module as its OWNING teacher sees it in the Kontent list.
///
/// <para><c>TaskCount</c> counts only tasks that are not soft-deleted, so the number matches what
/// the editor shows. <c>StudentCount</c> is the reach across the teacher's groups — how many
/// students could actually receive this module's work — and is 0 for a module nobody can see yet.</para>
/// </summary>
public sealed record TeacherBlockResponse(
    Guid Id,
    string Name,
    string? Topic,
    string? Level,
    string? RuStyle,
    string Visibility,
    bool IsPublished,
    int SortOrder,
    int TaskCount,
    int StudentCount,
    DateTime CreatedAt,
    DateTime UpdatedAt);

/// <summary>A module plus its ordered tasks — the C4 editor's payload.</summary>
public sealed record TeacherBlockDetailResponse(
    Guid Id,
    string Name,
    string? Topic,
    string? Level,
    string? RuStyle,
    string Visibility,
    bool IsPublished,
    int SortOrder,
    int TaskCount,
    int StudentCount,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    IReadOnlyList<TeacherQuestionResponse> Tasks);

/// <summary>One task as its owning teacher sees it (the Vazifalar tab and C5's picker).</summary>
public sealed record TeacherQuestionResponse(
    Guid Id,
    string Title,
    string PromptText,
    string Type,
    string? Level,
    string? Topic,
    string? RuStyle,
    string? InstructionText,
    string? ModelAnswerText,
    int PrepTimeSec,
    int AnswerTimeLimitSec,
    bool IsPublished,
    bool IsPublic,
    Guid? BlockId,
    /// <summary>Name of the module it belongs to, so a library row reads standalone. Null when
    /// the task is unattached.</summary>
    string? BlockName,
    int SortOrder,
    /// <summary>How many attempts exist. A task with attempts must not be silently reshaped —
    /// the editor warns before an edit that would change what students already answered.</summary>
    int SubmissionCount,
    DateTime CreatedAt,
    DateTime UpdatedAt);

/// <summary>Body of POST /api/blocks. Only <c>name</c> is required; a module starts as a DRAFT
/// (<c>is_published = false</c>) so nothing reaches students until the teacher says so.</summary>
public sealed record CreateBlockRequest(
    string? Name,
    string? Topic,
    string? Level,
    string? RuStyle,
    string? Visibility);

/// <summary>
/// Body of PATCH /api/blocks/{id}. Every field is nullable and ABSENT means "leave alone", so a
/// caller sends only what it edits — publishing a module is `{ "is_published": true }` and nothing
/// else, with no risk of blanking the description in the same request.
/// </summary>
public sealed record UpdateBlockRequest(
    string? Name,
    string? Topic,
    string? Level,
    string? RuStyle,
    string? Visibility,
    bool? IsPublished,
    int? SortOrder);

/// <summary>Body of POST /api/questions. <c>title</c> + <c>prompt_text</c> are required — a task
/// with no prompt is not answerable. Starts as a DRAFT.</summary>
public sealed record CreateQuestionRequest(
    string? Title,
    string? PromptText,
    string? Level,
    string? Topic,
    string? RuStyle,
    string? InstructionText,
    string? ModelAnswerText,
    int? PrepTimeSec,
    int? AnswerTimeLimitSec,
    /// <summary>Attach straight to a module on creation (the C4 "+ Yangi vazifa" path).</summary>
    Guid? BlockId);

/// <summary>
/// Body of PATCH /api/questions/{id}. Absent means "leave alone", as with
/// <see cref="UpdateBlockRequest"/>.
///
/// <para><c>BlockId</c> is TRI-STATE and needs care: absent leaves the module attachment alone,
/// while an explicit <c>null</c> DETACHES the task from its module. That distinction is what lets
/// C5's picker both attach and remove without a second endpoint.</para>
/// </summary>
public sealed record UpdateQuestionRequest(
    string? Title,
    string? PromptText,
    string? Level,
    string? Topic,
    string? RuStyle,
    string? InstructionText,
    string? ModelAnswerText,
    int? PrepTimeSec,
    int? AnswerTimeLimitSec,
    bool? IsPublished,
    int? SortOrder,
    Guid? BlockId,
    /// <summary>Set true to apply <c>BlockId = null</c> (detach). Without this flag an absent
    /// <c>block_id</c> and an explicit null are indistinguishable over JSON.</summary>
    bool? DetachBlock);
