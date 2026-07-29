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
/// last-7-day sum used as the primary sort in "weekly" mode.
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
