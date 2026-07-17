namespace Govori.Contracts;

/// <summary>
/// One task inside a student's module view, carrying BOTH lock layers. Mirrors Python's
/// <c>StudentTask</c> (backend/app/schemas/block.py:59-67). Serialized snake_case:
/// <c>sort_order</c>, <c>premium_locked</c>.
///
/// <para><b>Two-layer lock</b> (blocks.py:148-167):</para>
/// <list type="bullet">
///   <item><c>Locked</c> — SEQUENTIAL: the previous task in the module is not done yet.</item>
///   <item><c>PremiumLocked</c> — FREEMIUM: this task is beyond the free preview of an
///   official PUBLIC module and the student is non-premium.</item>
/// </list>
/// <c>Type</c> is the lowercase PG enum label ("text"/"image"/"video"), matching Python's
/// <c>q.type.value</c>.
/// </summary>
public sealed record StudentTaskResponse(
    Guid Id,
    string Title,
    string Type,
    string? Level,
    int SortOrder,
    bool Done,
    bool Locked,
    bool PremiumLocked);

/// <summary>
/// A module a student can work through, with its ordered tasks. Mirrors Python's
/// <c>StudentModule</c> (backend/app/schemas/block.py:70-82). Serialized snake_case:
/// <c>ru_style</c>, <c>cover_url</c>, <c>done_count</c>, <c>next_task_id</c>.
///
/// <para><c>Visibility</c> is "public" (official platform module) or "group" (the student's
/// teacher's module). <c>NextTaskId</c> is the current actionable task — the first task that is
/// not done, not sequentially locked, and not premium-locked (null when none is actionable).</para>
///
/// <para><c>CoverUrl</c> is always null for now: presigned object-storage URLs are produced by
/// the (not-yet-ported) Govori.Platform.Storage layer (docs/07 §7.2). Python fills it via
/// <c>storage.presigned_get(cover_key)</c>; the field is kept in the shape so the client
/// contract is stable when Storage lands.</para>
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
    IReadOnlyList<StudentTaskResponse> Tasks);
