namespace Govori.Contracts;

// ─── Profile domain DTOs (profile redesign — shared contract) ────────────────
// Backs the three read-only endpoints of the redesigned profile screen:
// GET /api/profile/stats, /api/profile/results, /api/profile/achievements.
//
// NO SCHEMA CHANGE (docs/07 §7.4 rule 3): this feature must not add, alter or drop any column —
// schema changes go through an explicit EF Core migration, never as a side effect of a DTO.
// Every field below is COMPUTED from columns that already exist:
// User.{CurrentStreak,LongestStreak,Xp}, Submission.{StudentId,AudioDurationSec,CreatedAt},
// Evaluation.{SubmissionId,OverallBand} and Question.Title. In particular there is no stored
// `level` column — `Level`/`LevelLabel` are derived from the student's average
// Evaluation.OverallBand through the shared <see cref="CefrScale"/>.
//
// Every field serializes snake_case via the host's global JsonNamingPolicy.SnakeCaseLower
// (Program.cs), so `AvgBand` → "avg_band", `TotalPracticeSec` → "total_practice_sec",
// `LevelLabel` → "level_label". Guid renders as a JSON string and DateTime as ISO-8601, matching
// the frontend's `id: string` / `created_at: string` mirrors.

// ── Stats ──

/// <summary>
/// The four headline tiles of the "Natijalar" tab plus the derived level badge —
/// <c>GET /api/profile/stats</c>, always scoped to the CALLING user.
///
/// <para><c>Attempts</c> counts the user's submissions (graded or not) and
/// <c>TotalPracticeSec</c> sums <c>Submission.AudioDurationSec</c>; both are DB aggregates.
/// <c>AvgBand</c> is the mean <c>Evaluation.OverallBand</c> rounded to 1 decimal place, or
/// <c>null</c> when nothing has been graded yet. <c>LongestStreak</c> is read straight off the user
/// row; <c>CurrentStreak</c> is the EFFECTIVE streak as of today (<see cref="StreakRules.Effective"/>)
/// — the stored column only resets on the next practice, so read raw it would show a broken streak
/// as live. <c>Level</c>/<c>LevelLabel</c> are derived from <c>AvgBand</c> and are
/// <c>null</c> together with it (the UI hides the badge).</para>
///
/// <para>The UI renders <c>total_practice_sec</c> as hours to 1dp ("6.4 soat"); the API stays in
/// seconds so no precision is lost at the boundary.</para>
///
/// <para><c>Xp</c> is the user's denormalised lifetime XP total (<c>User.Xp</c>), read straight off
/// the user row alongside the streaks. It is the headline gamification number the profile surfaces
/// as its XP banner; the running total is maintained by the grading pipeline — this endpoint only
/// reports it.</para>
/// </summary>
public sealed record ProfileStatsResponse(
    int Attempts,
    double? AvgBand,
    int CurrentStreak,
    int LongestStreak,
    int TotalPracticeSec,
    string? Level,
    string? LevelLabel,
    int Xp,
    // APPEND-ONLY. Practice seconds today / in the last 7 days — the Home screen's "Bugungi N daqiqa"
    // progress and the "Bu hafta" tile. "Today" is the product day (ProductDay, Tashkent local
    // midnight), the same day the streak is kept on; the week is a rolling 7×24 h window.
    int TodayPracticeSec = 0,
    int WeekPracticeSec = 0);

// ── Recent results ──

/// <summary>
/// One row of the "SO'NGGI NATIJALAR" list — <c>GET /api/profile/results?limit=1..50</c> (default
/// 10), the caller's most recent GRADED attempts, newest first.
///
/// <para><c>Id</c> is the SUBMISSION id (not the evaluation's). <c>Title</c> is
/// <c>Question.Title</c>, falling back to "Mashq" when the submission has no question. <c>Band</c>
/// is <c>Evaluation.OverallBand</c> rounded to a whole number and clamped to 0..100.</para>
///
/// <para><c>Trend</c> is <c>"up"</c> / <c>"down"</c> / <c>"flat"</c> versus the chronologically
/// NEXT-OLDER graded attempt: strictly greater ⇒ "up", strictly less ⇒ "down", equal OR no older
/// attempt ⇒ "flat". It is computed over the ordered set — the service reads one extra row beyond
/// the page so the oldest item on the page still gets a real comparison rather than a spurious
/// "flat".</para>
/// </summary>
public sealed record ProfileResultItemResponse(
    Guid Id,
    string Title,
    int Band,
    DateTime CreatedAt,
    string Trend);

// ── Achievements ──

/// <summary>
/// One badge of the "YUTUQLAR" section — <c>GET /api/profile/achievements</c>. A fixed 21-badge
/// catalogue across eight dimensions (first attempt, attempt volume, longest streak, CEFR level,
/// best single band, total practice time, group membership, XP milestones), each evaluated against
/// the caller's real numbers. Streak badges key off <c>User.LongestStreak</c>, score badges off the
/// best single band and XP badges off <c>User.Xp</c>, so a badge, once earned, is never un-earned.
/// Returned sorted for display — unlocked first, then the locked ones closest to unlocking.
///
/// <para><c>Key</c> is a STABLE id (<c>first_step</c>, <c>attempts_50</c>, <c>streak_7</c>,
/// <c>level_b1</c>, <c>score_90</c>, <c>practice_5h</c>, <c>group_member</c>, <c>xp_1000</c>, …) —
/// the human titles,
/// descriptions and emoji live in the frontend locale files, deliberately NOT in the backend.
/// <c>Unlocked</c> is simply <c>Progress &gt;= Target</c>; <c>Progress</c> is the raw natural-unit
/// value (attempts / days / minutes / 0..1) and is NOT capped at <c>Target</c>.</para>
/// </summary>
public sealed record AchievementResponse(
    string Key,
    int Progress,
    int Target,
    bool Unlocked);
