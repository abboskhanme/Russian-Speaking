namespace Govori.Contracts;

// ─── Engagement domain DTOs (docs/07 §3.6, Faza 3.6) ────────────────────────
// The leaderboard, the spaced-repetition review queue and in-app notifications. Every field
// serializes snake_case via the host's global JsonNamingPolicy.SnakeCaseLower (Program.cs), so
// `WeeklyXp` → "weekly_xp", `IsMe` → "is_me", `QuestionTitle` → "question_title". The
// snake_case wire shape is LOAD-BEARING — existing clients read exactly these names.

// ── Leaderboard ──

/// <summary>
/// One ranked row of the leaderboard. <c>Rank</c> is the
/// 1-based position within the chosen scope (or, for the current user when they fall outside the
/// top 50, the count of students strictly ahead + 1). <c>Xp</c> is all-time; <c>WeeklyXp</c> is the
/// last-7-day sum used as the primary sort in "weekly" mode. <c>CurrentStreak</c> is the EFFECTIVE
/// streak as of today (<see cref="StreakRules.Effective"/>), not the stored column — that one only
/// resets on the student's next practice, so it would show a broken streak as live.
/// </summary>
public sealed record LeaderboardEntryResponse(
    int Rank,
    Guid Id,
    string FullName,
    int Xp,
    int WeeklyXp,
    int CurrentStreak,
    bool IsMe);

// ── Review (spaced repetition) ──

/// <summary>A due review surfaced to the student.</summary>
public sealed record ReviewItemResponse(
    Guid Id,
    Guid QuestionId,
    string? QuestionTitle,
    string? QuestionTopic,
    string? QuestionLevel,
    string WeaknessDim,
    DateTime DueAt);

/// <summary>
/// Body of POST /api/review. A teacher adds question(s) to
/// a student's (or a whole group's) review queue. Targets are the union of explicit
/// <c>student_ids</c> and the <c>group_id</c>'s members, then filtered through the teacher's roster.
/// </summary>
public sealed record CreateReviewsRequest(
    List<Guid> QuestionIds,
    List<Guid>? StudentIds,
    Guid? GroupId);

// ── Xato-replay drill (docs/08 Faza 6.1 · F5) ──
// The queue's read model above answers "what is due"; these three answer "let me redo it". They
// carry the question's FULL text (prompt / instruction / model answer), which the list shape
// deliberately omits — a queue row needs a title, a drill card needs the words the student has to
// say again.

/// <summary>
/// One card of a drill session: the question to replay plus where it stands on the SRS ladder.
///
/// <para><c>Round</c> is 1-based for the student ("2 / 5"), while the stored
/// <c>review_items.interval_index</c> it derives from is 0-based — the wire shape speaks the
/// learner's language, not the table's. <c>WeaknessDim</c> is the dimension that put the question
/// here (fluency · lexical · grammar · relevance, or "teacher" when a teacher queued it), which is
/// what the card headlines: a replay without a reason is just a repeat.</para>
/// </summary>
public sealed record ReviewDrillItemResponse(
    Guid Id,
    Guid QuestionId,
    string QuestionTitle,
    string PromptText,
    string? InstructionText,
    string? ModelAnswerText,
    string? QuestionTopic,
    string? QuestionLevel,
    string WeaknessDim,
    int Round,
    int TotalRounds,
    DateTime DueAt);

/// <summary>
/// A drill session. <c>DueCount</c> is everything due right now and <c>Items</c> is the slice this
/// session serves, so a student sitting on forty overdue items is handed a finishable set rather
/// than an infinite scroll — and the two numbers together let the screen say so honestly.
/// </summary>
public sealed record ReviewDrillResponse(
    int DueCount,
    int TotalRounds,
    IReadOnlyList<ReviewDrillItemResponse> Items);

/// <summary>
/// Body of POST /api/review/{id}/answer. <c>Outcome</c> is the student's verdict on their own
/// replay: <c>"good"</c> (said it cleanly — climb the ladder) or <c>"again"</c> (still stumbling —
/// back to the first interval). Anything else is a 400 rather than a silently assumed default,
/// because guessing here would quietly corrupt a schedule the student cannot see.
/// </summary>
public sealed record ReviewAnswerRequest(string Outcome);

/// <summary>
/// What the ladder looks like after an answer. <c>NextDueAt</c> is <c>null</c> exactly when
/// <c>Graduated</c> is true — the item has finished every round and will never come back — which is
/// the difference the end-of-card copy turns on. <c>RemainingDue</c> is the recount AFTER this
/// answer, so the screen advances on a server fact instead of decrementing its own optimism.
/// </summary>
public sealed record ReviewAnswerResponse(
    Guid Id,
    int Round,
    int TotalRounds,
    bool Graduated,
    DateTime? NextDueAt,
    int RemainingDue);

// ── Notifications ──

/// <summary>One in-app notification.</summary>
public sealed record NotificationResponse(
    Guid Id,
    string Type,
    string Title,
    string? Body,
    string? Link,
    bool IsRead,
    DateTime CreatedAt);

/// <summary>Unread-notification tally.</summary>
public sealed record UnreadCountResponse(int Count);
