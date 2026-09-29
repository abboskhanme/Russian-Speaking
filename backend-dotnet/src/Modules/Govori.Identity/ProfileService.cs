using System.Runtime.CompilerServices;
using Govori.Contracts;
using Govori.Infrastructure;
using Microsoft.EntityFrameworkCore;

// The pure achievement-catalogue builder (ProfileService.BuildAchievements) is exercised directly by
// the unit-test project: it takes the already-aggregated numbers, so the 16-badge catalogue + ordering
// can be asserted without a Postgres round trip. Kept internal (not public) — the module's surface is
// unchanged; this attribute only widens visibility to the sibling test assembly.
[assembly: InternalsVisibleTo("Govori.UnitTests")]

namespace Govori.Identity;

/// <summary>
/// Application service for the Profile vertical slice — the read-only numbers behind the redesigned
/// profile screen (<c>GET /api/profile/{stats,results,achievements}</c>).
///
/// <para><b>Why it lives in Govori.Identity rather than a ninth module.</b> docs/07 §7.2 freezes the
/// module list at EIGHT domains, and <c>Govori.ArchTests.ArchitectureMap.DomainModules</c> encodes
/// exactly that set. Identity already owns the user-profile surface (<c>GET</c>/<c>PATCH
/// /api/auth/me</c>, <c>UpdateProfileRequest</c>, the "Manzil" step), and <c>MeResponse.Level</c> is
/// derived from the very same average this service computes — keeping both in one module means the
/// derivation is shared rather than duplicated. Reading Submission/Evaluation/Question here needs no
/// new project reference (Identity already references Govori.Infrastructure) and adds NO
/// domain→domain edge, which a separate Govori.Profile module would have needed for the user row.</para>
///
/// <para><b>NO SCHEMA CHANGE</b> (docs/07 §7.4 rule 3). The schema is owned by the EF Core
/// migrations in <c>Govori.Infrastructure</c>; this slice needs none of its own, because every
/// number is computed from existing columns. There is no stored level either: it is derived from
/// the average <c>Evaluation.OverallBand</c> via the shared <see cref="CefrScale"/>.</para>
///
/// <para><b>Efficiency.</b> <c>attempts</c> and <c>total_practice_sec</c> are a single grouped
/// COUNT/SUM, the average band is a single AVG, and the results feed is one projected, LIMITed
/// query — nothing loads a table into memory to count it, and there is no N+1.</para>
///
/// <para><b>Isolation.</b> Every query is filtered by the CALLING user's id
/// (<c>Submission.StudentId == userId</c>). There is no parameter that could widen the scope, so a
/// student can never observe another student's stats, results or achievements. A missing or
/// inactive user yields <c>null</c> ⇒ 401 at the endpoint, matching the sibling services.</para>
/// </summary>
public sealed class ProfileService
{
    /// <summary>Default page size of <c>GET /api/profile/results</c> when <c>?limit</c> is absent.</summary>
    private const int DefaultResultsLimit = 10;

    /// <summary>Hard ceiling on <c>?limit</c> — a caller can never ask for an unbounded page.</summary>
    private const int MaxResultsLimit = 50;

    private readonly GovoriDbContext _db;

    public ProfileService(GovoriDbContext db) => _db = db;

    /// <summary>
    /// <c>GET /api/profile/stats</c> — the four "Natijalar" tiles plus the derived level badge for
    /// the calling user. <c>null</c> ⇒ the user is missing or inactive (401).
    /// </summary>
    public async Task<ProfileStatsResponse?> StatsAsync(Guid userId, CancellationToken ct = default)
    {
        // Streaks and lifetime XP come off the user row; the projection keeps this to the columns we
        // need and doubles as the missing/inactive check. Xp is the denormalised running total the
        // grading pipeline maintains — here it is only read. The current streak is reported as it
        // stands TODAY (StreakRules.Effective, hence the two extra columns), never the raw column,
        // which keeps a broken streak until the student's next practice resets it.
        var streaks = await _db.Users
            .Where(u => u.Id == userId && u.IsActive)
            .Select(u => new { u.CurrentStreak, u.LastPracticeDate, u.StreakFreezes, u.LongestStreak, u.Xp })
            .FirstOrDefaultAsync(ct);
        if (streaks is null) return null;

        // COUNT + SUM in ONE server-side aggregate (never .ToList().Count). GroupBy on the constant
        // student id collapses the user's submissions to a single row; no rows at all ⇒ null ⇒ zeros.
        var totals = await _db.Submissions
            .Where(s => s.StudentId == userId)
            .GroupBy(s => s.StudentId)
            .Select(g => new { Attempts = g.Count(), Seconds = g.Sum(s => s.AudioDurationSec) })
            .FirstOrDefaultAsync(ct);

        // AVG over the user's own evaluations. The (double?) cast makes an empty set SQL NULL rather
        // than an exception — that null IS the "nothing graded yet" signal.
        var avgBand = await _db.Evaluations
            .Where(e => e.Submission.StudentId == userId)
            .AverageAsync(e => (double?)e.OverallBand, ct);

        // Practice seconds TODAY and THIS WEEK — the Home screen's "Bugungi N daqiqa" progress and the
        // "Bu hafta" tile. Windowed by UTC (same basis as streaks/XP); one SUM each, no list load.
        var now = DateTime.UtcNow;
        var dayStart = now.Date;                 // 00:00 UTC today
        var weekStart = now.AddDays(-7);
        var todaySec = await _db.Submissions
            .Where(s => s.StudentId == userId && s.CreatedAt >= dayStart)
            .SumAsync(s => (double?)s.AudioDurationSec, ct) ?? 0d;
        var weekSec = await _db.Submissions
            .Where(s => s.StudentId == userId && s.CreatedAt >= weekStart)
            .SumAsync(s => (double?)s.AudioDurationSec, ct) ?? 0d;

        // Report the band to 1dp and derive the level from that SAME rounded value, so the badge can
        // never disagree with the number printed next to it at a bucket boundary.
        var rounded = avgBand is { } band ? Math.Round(band, 1, MidpointRounding.AwayFromZero) : (double?)null;
        var (level, levelLabel) = CefrScale.FromAverageBand(rounded);

        return new ProfileStatsResponse(
            Attempts: totals?.Attempts ?? 0,
            AvgBand: rounded,
            CurrentStreak: StreakRules.Effective(
                streaks.CurrentStreak, streaks.LastPracticeDate, streaks.StreakFreezes, StreakRules.Today()),
            LongestStreak: streaks.LongestStreak,
            TotalPracticeSec: (int)Math.Round(totals?.Seconds ?? 0d, MidpointRounding.AwayFromZero),
            Level: level,
            LevelLabel: levelLabel,
            Xp: streaks.Xp,
            TodayPracticeSec: (int)Math.Round(todaySec, MidpointRounding.AwayFromZero),
            WeekPracticeSec: (int)Math.Round(weekSec, MidpointRounding.AwayFromZero));
    }

    /// <summary>
    /// <c>GET /api/profile/results?limit=1..50</c> (default 10) — the caller's most recent GRADED
    /// attempts, newest first. "Graded" means the submission has an <c>Evaluation</c> row, which is
    /// why the query starts from <c>Evaluations</c> (an inner join) rather than filtering
    /// submissions. <c>null</c> ⇒ the user is missing or inactive (401).
    ///
    /// <para><c>trend</c> is computed over the ORDERED SET, not pairwise inside the page: the query
    /// takes <c>limit + 1</c> rows so the oldest item actually returned still has its true
    /// next-older neighbour to compare against instead of falling back to a spurious "flat".</para>
    /// </summary>
    public async Task<IReadOnlyList<ProfileResultItemResponse>?> ResultsAsync(
        Guid userId, int? limit, CancellationToken ct = default)
    {
        if (!await _db.Users.AnyAsync(u => u.Id == userId && u.IsActive, ct)) return null;

        var take = Math.Clamp(limit ?? DefaultResultsLimit, 1, MaxResultsLimit);

        var rows = await _db.Evaluations
            .Where(e => e.Submission.StudentId == userId)
            .OrderByDescending(e => e.Submission.CreatedAt)
            .ThenByDescending(e => e.SubmissionId)   // stable tie-break for same-timestamp attempts
            .Select(e => new
            {
                e.SubmissionId,
                Title = e.Submission.Question != null ? e.Submission.Question.Title : null,
                e.OverallBand,
                CreatedAt = e.Submission.CreatedAt,
            })
            .Take(take + 1)                          // +1 = the look-behind row for the last item's trend
            .ToListAsync(ct);

        var page = Math.Min(rows.Count, take);
        var items = new List<ProfileResultItemResponse>(page);
        for (var i = 0; i < page; i++)
        {
            var band = Band(rows[i].OverallBand);
            // rows are NEWEST-first, so the chronologically previous attempt is the NEXT index.
            var previous = i + 1 < rows.Count ? Band(rows[i + 1].OverallBand) : (int?)null;

            items.Add(new ProfileResultItemResponse(
                Id: rows[i].SubmissionId,
                Title: string.IsNullOrWhiteSpace(rows[i].Title) ? "Mashq" : rows[i].Title!,
                Band: band,
                CreatedAt: rows[i].CreatedAt,
                Trend: Trend(band, previous)));
        }

        return items;
    }

    /// <summary>
    /// <c>GET /api/profile/achievements</c> — the fixed 16-badge catalogue evaluated against the
    /// caller's real numbers. Titles/emoji live in the frontend locale files, so nothing
    /// human-readable is returned. <c>null</c> ⇒ missing/inactive (401).
    ///
    /// <para><b>Once earned, stays earned.</b> Streak badges are measured against
    /// <c>User.LongestStreak</c> (not the current run) and score badges against the caller's BEST
    /// single band, so a badge cannot silently re-lock when a streak breaks or a later attempt scores
    /// lower.</para>
    ///
    /// <para><b>Efficiency.</b> Five scoped, server-side reads and no more: the user row (which also
    /// serves as the missing/inactive check), one grouped COUNT+SUM over submissions, one grouped
    /// MAX+AVG over evaluations, and one <c>ANY</c> over group membership. No table is pulled into
    /// memory and there is no N+1.</para>
    /// </summary>
    public async Task<IReadOnlyList<AchievementResponse>?> AchievementsAsync(
        Guid userId, CancellationToken ct = default)
    {
        // The user-row projection doubles as the missing/inactive (null ⇒ 401) check and carries
        // LongestStreak — the "best run ever", so a streak badge, once earned, stays earned — plus
        // Xp, the lifetime total the XP milestone badges are measured against (read-only here).
        var user = await _db.Users
            .Where(u => u.Id == userId && u.IsActive)
            .Select(u => new { u.LongestStreak, u.Xp })
            .FirstOrDefaultAsync(ct);
        if (user is null) return null;

        // attempts + total practice seconds in ONE grouped aggregate (mirrors StatsAsync). No rows
        // ⇒ null ⇒ zeros.
        var totals = await _db.Submissions
            .Where(s => s.StudentId == userId)
            .GroupBy(s => s.StudentId)
            .Select(g => new { Attempts = g.Count(), Seconds = g.Sum(s => s.AudioDurationSec) })
            .FirstOrDefaultAsync(ct);

        // Best single band (for the score badges) and average band (for the derived level) in ONE
        // grouped aggregate over the user's own evaluations. Both are nullable: no graded attempt yet
        // ⇒ null ⇒ those badges stay locked.
        var bands = await _db.Evaluations
            .Where(e => e.Submission.StudentId == userId)
            .GroupBy(e => e.Submission.StudentId)
            .Select(g => new
            {
                Best = g.Max(e => (double?)e.OverallBand),
                Avg = g.Average(e => (double?)e.OverallBand),
            })
            .FirstOrDefaultAsync(ct);

        // Member of at least one group — a single scoped ANY, never a loaded list.
        var inAnyGroup = await _db.GroupMembers.AnyAsync(m => m.StudentId == userId, ct);

        var (level, _) = CefrScale.FromAverageBand(bands?.Avg);
        // Round the best band to the same whole-number scale the results feed prints, so a "score 80"
        // badge can never disagree with an "80" shown next to an attempt.
        var bestBand = bands?.Best is { } best ? Band(best) : (int?)null;
        var attempts = totals?.Attempts ?? 0;
        // Practice progress is whole MINUTES (the badge's natural unit); floor, so 59.9 min is not 60.
        var practiceMinutes = (int)Math.Floor((totals?.Seconds ?? 0d) / 60d);

        return BuildAchievements(attempts, user.LongestStreak, bestBand, level, practiceMinutes, inAnyGroup, user.Xp);
    }

    /// <summary>
    /// The pure 21-badge catalogue: turns the caller's already-aggregated numbers into the ordered
    /// achievement list. DB-free and deterministic, so the unit test drives it directly.
    ///
    /// <para><paramref name="bestBand"/> is the caller's best single band rounded to a whole 0..100
    /// (null ⇒ nothing graded yet); <paramref name="totalPracticeMinutes"/> is whole minutes of
    /// practice. Progress is the RAW natural unit (attempts, days, minutes, or 0/1) and is NOT capped
    /// — a 128-attempt student reads 128/50 — while the sort's ratio IS capped at 1.</para>
    ///
    /// <para><b>Order:</b> unlocked first, then the locked ones CLOSEST to unlocking first —
    /// <c>(unlocked desc, cappedRatio desc, target asc)</c>, with catalogue index as the final,
    /// fully deterministic tie-break.</para>
    /// </summary>
    internal static IReadOnlyList<AchievementResponse> BuildAchievements(
        int attempts,
        int longestStreak,
        int? bestBand,
        string? level,
        int totalPracticeMinutes,
        bool inAnyGroup,
        int xp)
    {
        var catalogue = new[]
        {
            Achievement("first_step",   Math.Min(attempts, 1),                    1),
            Achievement("attempts_10",  attempts,                                 10),
            Achievement("attempts_50",  attempts,                                 50),
            Achievement("attempts_100", attempts,                                 100),
            Achievement("streak_3",     longestStreak,                            3),
            Achievement("streak_7",     longestStreak,                            7),
            Achievement("streak_30",    longestStreak,                            30),
            Achievement("streak_100",   longestStreak,                            100),
            Achievement("level_a2",     CefrScale.IsAtLeast(level, "A2") ? 1 : 0, 1),
            Achievement("level_b1",     CefrScale.IsAtLeast(level, "B1") ? 1 : 0, 1),
            Achievement("level_b2",     CefrScale.IsAtLeast(level, "B2") ? 1 : 0, 1),
            Achievement("score_80",     bestBand >= 80 ? 1 : 0,                   1),
            Achievement("score_90",     bestBand >= 90 ? 1 : 0,                   1),
            Achievement("practice_1h",  totalPracticeMinutes,                     60),
            Achievement("practice_5h",  totalPracticeMinutes,                     300),
            Achievement("group_member", inAnyGroup ? 1 : 0,                       1),
            // XP milestones — progress is the raw lifetime User.Xp (uncapped), the headline
            // gamification metric that grows with every graded exercise.
            Achievement("xp_100",       xp,                                       100),
            Achievement("xp_500",       xp,                                       500),
            Achievement("xp_1000",      xp,                                       1000),
            Achievement("xp_2500",      xp,                                       2500),
            Achievement("xp_5000",      xp,                                       5000),
        };

        // Unlocked first; then locked-but-closest (higher capped ratio) first; ties broken by the
        // smaller target, then original catalogue order — so the result is always deterministic.
        return catalogue
            .Select((a, index) => (a, index, ratio: Math.Min((double)a.Progress / a.Target, 1d)))
            .OrderByDescending(x => x.a.Unlocked)
            .ThenByDescending(x => x.ratio)
            .ThenBy(x => x.a.Target)
            .ThenBy(x => x.index)
            .Select(x => x.a)
            .ToArray();
    }

    // progress >= target ⇒ unlocked. Progress is NOT capped at target (a 128-attempt student still
    // reads 128 against a 50-attempt badge; the tile derives its bar as min(progress/target, 1)).
    private static AchievementResponse Achievement(string key, int progress, int target)
        => new(key, progress, target, progress >= target);

    // Evaluation.OverallBand → the whole number the UI shows, clamped to the documented 0..100.
    private static int Band(double overallBand)
        => Math.Clamp((int)Math.Round(overallBand, MidpointRounding.AwayFromZero), 0, 100);

    // Strictly greater ⇒ "up", strictly less ⇒ "down", equal OR no older attempt ⇒ "flat".
    private static string Trend(int band, int? previous) => previous switch
    {
        null => "flat",
        var p when band > p => "up",
        var p when band < p => "down",
        _ => "flat",
    };
}
