using System.Globalization;
using Govori.Contracts;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace Govori.Engagement;

/// <summary>
/// Application service for the Engagement vertical slice (docs/07 §3.6, Faza 3.6) — XP, streaks
/// (with freezes), the leaderboard, the spaced-repetition (SRS) review queue and in-app
/// notifications. Its responsibilities:
/// <list type="bullet">
///   <item>the XP / streak / SRS-scheduling award logic (<see cref="XpForBand"/>,
///     <see cref="AwardSubmissionAsync"/>, <see cref="AwardPracticeAsync"/>, <c>UpdateStreak</c>,
///     <see cref="ScheduleReviewAsync"/>) — driven by the grading worker, not by an HTTP route;</item>
///   <item>the leaderboard and the review queue's read/create paths
///     (<see cref="LeaderboardAsync"/>, <see cref="MyReviewsAsync"/>,
///     <see cref="CreateReviewsAsync"/>);</item>
///   <item>the F5 xato-replay DRILL (<see cref="DrillAsync"/>, <see cref="AnswerReviewAsync"/>) —
///     the surface that finally lets a student redo the mistake, behind the
///     <see cref="ReviewDrillFlagKey"/> feature flag;</item>
///   <item>in-app notifications — listing, unread count, mark-read, delete/clear, plus the internal
///     <c>Notify</c> helper the write paths use to raise one.</item>
/// </list>
///
/// <para><b>C8 (FROZEN).</b> <see cref="XpForBand"/> is the anti-farming XP curve
/// (<c>&lt;27 → 0</c>, else banker's-rounded <c>pct/4</c>; <c>null → 0</c>). It is pinned by the C8
/// fixture <c>tests/characterization/fixtures/xp_cases.json</c> and driven through this REAL
/// production method by <c>Govori.Characterization.EngagementXpPortTests</c>. Do not "improve" it.</para>
///
/// <para><b>Roster filter (same rule as Classroom's S1 fix).</b> <see cref="CreateReviewsAsync"/>
/// enforces that a teacher may only queue reviews for students on their OWN roster (admins: anyone),
/// via <see cref="RosterStudentIds"/>. Do not widen it — it is what stops one teacher pushing review
/// work onto another teacher's students.</para>
///
/// <para><b>Streak days are PRODUCT days (the S6 fix).</b> <c>UpdateStreak</c> keys off
/// <see cref="StreakRules.Today()"/>, which is <see cref="ProductDay"/>: the day turns over at local
/// midnight in Tashkent (UTC+05:00), not at UTC midnight (05:00 local), which is where docs/07 §7.8
/// bug S6 left it — two answers at 23:30 and 00:30 local counted as ONE day, and a student practising
/// after midnight was credited to the day before. It is one fixed offset rather than the student's own
/// timezone because the product is Uzbekistan-only (UTC+5, no DST), the schema stores no timezone,
/// and this writer runs in the grading worker with no request to take a browser hint from; revisit
/// if the product ever serves another timezone. The award methods keep their optional <c>today</c>
/// seam so deterministic tests can supply the day explicitly; production passes <c>null</c>. Every
/// READ of the streak (both leaderboards here, plus Profile and Daily in other modules) reports
/// <see cref="StreakRules.Effective"/> on the SAME product day, through the same
/// <see cref="StreakRules.Today()"/>, rather than the stored column, which only changes on the next
/// award and so would otherwise show a long-broken streak as live.</para>
///
/// <para>Role/auth: the leaderboard, the review list and every notification route accept any active
/// user (null ⇒ 401). <see cref="CreateReviewsAsync"/> requires teacher OR admin (403 otherwise).
/// role/is_active are read from the DB, never trusted from the token — the endpoint supplies only
/// the <c>sub</c>.</para>
/// </summary>
public sealed class EngagementService
{
    private readonly GovoriDbContext _db;
    private readonly ILogger<EngagementService>? _logger;
    private readonly IConfiguration? _config;

    // The logger and the configuration are OPTIONAL (nullable, default null) so the worker-side award
    // paths and the tests that construct this service directly (new EngagementService(ctx)) keep
    // compiling; DI supplies both in both hosts. The logger only records the best-effort rank_delta
    // choice on the progress leaderboard (never to fabricate a number); the configuration supplies the
    // env-var half of the review-drill feature flag (see ReviewDrillEnabledAsync).
    public EngagementService(
        GovoriDbContext db, ILogger<EngagementService>? logger = null, IConfiguration? config = null)
    {
        _db = db;
        _logger = logger;
        _config = config;
    }

    // ─── Frozen constants ─────────────────────────────────────────────────────

    /// <summary>Flag a skill for SRS review below this 0–100 score.</summary>
    public const double ReviewThreshold = 67.0;

    /// <summary>Graduated spaced-repetition intervals in days, indexed by review round.</summary>
    public static readonly int[] ReviewIntervalsDays = { 1, 3, 7, 16, 35 };

    /// <summary>Earn one streak freeze on every Nth consecutive day.</summary>
    public const int FreezeEarnEvery = 5;

    /// <summary>Fixed XP for a non-graded practice attempt.</summary>
    public const int PracticeXp = 5;

    // ─── C8: XP curve — FROZEN ────────────────────────────────────────────────

    /// <summary>
    /// XP scales linearly with the 0–100 score (<c>score/4</c> → 25 XP at 100%), but answers below
    /// 27% earn nothing (anti-farming floor). <c>null → 0</c>. Uses banker's rounding
    /// (<see cref="MidpointRounding.ToEven"/>), so an exact .5 settles on the even integer. FROZEN by
    /// the C8 fixture — do not change the math.
    /// </summary>
    public static int XpForBand(double? score)
    {
        var pct = score ?? 0;                                        // an ungraded answer counts as 0
        if (pct < 27) return 0;
        return (int)Math.Round(pct / 4.0, MidpointRounding.ToEven);
    }

    // ─── XP / streak award ────────────────────────────────────────────────────

    /// <summary>
    /// Award XP for a graded submission and roll the daily streak. Only real students accrue
    /// XP/streak (teacher/admin runs earn nothing); a non-answered attempt earns nothing. The XP basis
    /// is the level-relative score when present, else the absolute band. Commits its own unit of work.
    /// </summary>
    public async Task AwardSubmissionAsync(
        Submission sub, Evaluation evaluation, bool answered = true, DateOnly? today = null, CancellationToken ct = default)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == sub.StudentId, ct);
        if (user is null || user.Role != UserRole.Student) return;  // only students accrue XP
        if (!answered) return;                                      // a skipped attempt earns nothing

        // Level-relative score (motivating) when available, else the absolute overall band.
        double? basis = evaluation.LevelScore ?? evaluation.OverallBand;
        var amount = XpForBand(basis);

        var now = DateTime.UtcNow;
        _db.XpEvents.Add(new XpEvent
        {
            Id = Guid.NewGuid(),
            StudentId = user.Id,
            SubmissionId = sub.Id,
            Amount = amount,
            Reason = "submission",
            CreatedAt = now,
            UpdatedAt = now,
        });
        user.Xp += amount;                                          // denormalised running total
        // The streak day is the PRODUCT day of the same instant the XP event is stamped with — the
        // same StreakRules.Today every reader uses, never a bare UTC date (S6).
        UpdateStreak(user, today ?? StreakRules.Today(now));
        await _db.SaveChangesAsync(ct);
    }

    /// <summary>
    /// Reward a non-graded practice attempt (shadowing) with a fixed <see cref="PracticeXp"/> and roll
    /// the streak. Teacher/admin runs earn nothing.
    /// </summary>
    public async Task AwardPracticeAsync(Submission sub, DateOnly? today = null, CancellationToken ct = default)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == sub.StudentId, ct);
        if (user is null || user.Role != UserRole.Student) return;  // only students accrue XP

        var now = DateTime.UtcNow;
        _db.XpEvents.Add(new XpEvent
        {
            Id = Guid.NewGuid(),
            StudentId = user.Id,
            SubmissionId = sub.Id,
            Amount = PracticeXp,
            Reason = "practice",
            CreatedAt = now,
            UpdatedAt = now,
        });
        user.Xp += PracticeXp;
        UpdateStreak(user, today ?? StreakRules.Today(now));        // product day, as above
        await _db.SaveChangesAsync(ct);
    }

    // Daily streak: bridge missed days with earned freezes, and earn a new freeze every Nth day.
    // Mutates `user` in place; the caller owns the commit.
    //
    // This is the ONLY writer, and it runs only when the student earns XP — so between practices the
    // stored streak goes stale rather than decaying. Every read path reports
    // StreakRules.Effective(...) instead of the column, and the "can the gap be bridged" test below
    // is StreakRules.SurvivesGap, the same one the readers use, so what a student is SHOWN is always
    // what this method would do if they practised right now.
    private static void UpdateStreak(User user, DateOnly today)
    {
        var last = user.LastPracticeDate;
        if (last == today) return;                                  // already counted today

        if (last is null)
        {
            user.CurrentStreak = 1;
        }
        else
        {
            var gap = today.DayNumber - last.Value.DayNumber;       // (today - last).days
            if (gap == 1)
            {
                user.CurrentStreak += 1;                            // consecutive day
            }
            else if (gap > 1)
            {
                var missed = gap - 1;
                if (StreakRules.SurvivesGap(gap, user.StreakFreezes))   // freezes >= missed
                {
                    user.StreakFreezes -= missed;                   // spend freezes to bridge
                    user.CurrentStreak += 1;
                }
                else
                {
                    user.CurrentStreak = 1;                         // streak broken
                }
            }
            // gap <= 0 (a last-practice date in the future): leave the streak untouched.
        }

        user.LastPracticeDate = today;
        user.LongestStreak = Math.Max(user.LongestStreak, user.CurrentStreak);
        if (user.CurrentStreak != 0 && user.CurrentStreak % FreezeEarnEvery == 0)
            user.StreakFreezes += 1;                                // earn a freeze on every Nth day
    }

    // ─── SRS scheduling ───────────────────────────────────────────────────────

    /// <summary>
    /// Mark prior open reviews for this (student, question) done, then schedule a new review for the
    /// single weakest skill dimension below <see cref="ReviewThreshold"/>.
    /// Dimensions are considered in the order fluency → lexical → grammar → relevance; the lowest wins
    /// and a tie resolves to the FIRST dimension in that order, so the order is part of the contract —
    /// do not reorder it. Only real students accrue reviews. A port of legacy
    /// <c>gamification.schedule_review</c> (same 0–100 threshold, same first interval); pronunciation is
    /// deliberately not one of the four, as it was not there.
    ///
    /// <para>Called once per answered, graded submission by <see cref="SubmissionRewarder"/>, which
    /// also holds its idempotency guard: this method is NOT safe to repeat for one submission (a second
    /// call would complete the item the first created and enqueue a copy).</para>
    /// </summary>
    public async Task ScheduleReviewAsync(Submission sub, Evaluation evaluation, CancellationToken ct = default)
    {
        var student = await _db.Users.FirstOrDefaultAsync(u => u.Id == sub.StudentId, ct);
        if (student is null || student.Role != UserRole.Student) return;  // only students get reviews

        var prior = await _db.ReviewItems
            .Where(r => r.StudentId == sub.StudentId && r.QuestionId == sub.QuestionId && !r.Completed)
            .ToListAsync(ct);
        foreach (var r in prior) r.Completed = true;                // this attempt supersedes them

        // Listing order is significant: the scan below keeps the FIRST minimum, so this order is
        // what breaks ties between equally weak dimensions.
        var dims = new (string Dim, double? Score)[]
        {
            ("fluency", evaluation.FluencyScore),
            ("lexical", evaluation.LexicalScore),
            ("grammar", evaluation.GrammarScore),
            ("relevance", evaluation.RelevanceScore),
        };
        string? weakest = null;
        var weakestScore = 0.0;
        foreach (var (dim, score) in dims)
        {
            if (score is null || score.Value >= ReviewThreshold) continue;
            if (weakest is null || score.Value < weakestScore)
            {
                weakest = dim;
                weakestScore = score.Value;
            }
        }

        if (weakest is not null && sub.QuestionId is not null)      // guard: SRS needs a question
        {
            var now = DateTime.UtcNow;
            _db.ReviewItems.Add(new ReviewItem
            {
                Id = Guid.NewGuid(),
                StudentId = sub.StudentId,
                QuestionId = sub.QuestionId.Value,
                WeaknessDim = weakest,
                IntervalIndex = 0,
                DueAt = now.AddDays(ReviewIntervalsDays[0]),
                Completed = false,
                CreatedAt = now,
                UpdatedAt = now,
            });
        }
        await _db.SaveChangesAsync(ct);
    }

    // ─── Leaderboard ──────────────────────────────────────────────────────────

    /// <summary>
    /// Ranked by the chosen period's XP with the other period as tiebreak.
    /// <paramref name="period"/> "weekly" (default) ranks by last-7-day XP then all-time; "all" ranks
    /// by all-time then this week's. With <paramref name="groupId"/> the board is scoped to that
    /// group's members, scored ONLY from XP earned on that group's assigned tasks (a student who is
    /// not a member of the requested group is 403). Global (no group) ranks every student by all their
    /// XP; a student outside the top 50 is appended with their true rank (count strictly ahead + 1).
    /// </summary>
    public async Task<EngagementResult<IReadOnlyList<LeaderboardEntryResponse>>> LeaderboardAsync(
        Guid userId, Guid? groupId, string? period, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return EngagementResult<IReadOnlyList<LeaderboardEntryResponse>>.Unauthorized();

        var allTime = period == "all";                              // anything else ⇒ weekly
        // "This week" is a ROLLING 7×24 h window, not a calendar week, so it has no day boundary for a
        // timezone to move — it reads the same in Tashkent as anywhere. Only the streak needs a day.
        var weekAgo = DateTime.UtcNow.AddDays(-7);
        var today = StreakRules.Today();                            // streaks are shown as of today (product day)

        // ── Group/class board: scored from this group's ASSIGNED tasks only ──
        if (groupId is not null)
        {
            if (user.Role == UserRole.Student)
            {
                var isMember = await _db.GroupMembers.AnyAsync(
                    gm => gm.GroupId == groupId.Value && gm.StudentId == user.Id, ct);
                if (!isMember)
                    return EngagementResult<IReadOnlyList<LeaderboardEntryResponse>>.Forbidden();  // non-members may not peek
            }

            var members = await _db.Users
                .Join(_db.GroupMembers, u => u.Id, gm => gm.StudentId, (u, gm) => new { u, gm })
                .Where(x => x.gm.GroupId == groupId.Value && x.u.Role == UserRole.Student)
                .Select(x => x.u)
                .ToListAsync(ct);

            // XP from submissions linked to an assignment of THIS group.
            var rows = await _db.XpEvents
                .Where(xe => xe.SubmissionId != null)
                .Join(_db.Submissions, xe => xe.SubmissionId!.Value, s => s.Id, (xe, s) => new { xe, s })
                .Where(x => x.s.AssignmentId != null)
                .Join(_db.Assignments, x => x.s.AssignmentId!.Value, a => a.Id, (x, a) => new { x.xe, a })
                .Where(x => x.a.GroupId == groupId.Value)
                .Select(x => new { x.xe.StudentId, x.xe.Amount, x.xe.CreatedAt })
                .ToListAsync(ct);

            var total = new Dictionary<Guid, long>();
            var weekly = new Dictionary<Guid, long>();
            foreach (var r in rows)
            {
                total[r.StudentId] = total.GetValueOrDefault(r.StudentId) + r.Amount;
                if (r.CreatedAt >= weekAgo)
                    weekly[r.StudentId] = weekly.GetValueOrDefault(r.StudentId) + r.Amount;
            }

            // OrderByDescending/ThenByDescending are STABLE, so students tied on BOTH figures keep
            // the order the member query returned them in.
            IEnumerable<User> ranked = allTime
                ? members.OrderByDescending(s => total.GetValueOrDefault(s.Id))
                         .ThenByDescending(s => weekly.GetValueOrDefault(s.Id))
                : members.OrderByDescending(s => weekly.GetValueOrDefault(s.Id))
                         .ThenByDescending(s => total.GetValueOrDefault(s.Id));

            var groupList = ranked.Take(50).Select((s, i) => new LeaderboardEntryResponse(
                Rank: i + 1,
                Id: s.Id,
                FullName: s.FullName,
                Xp: (int)total.GetValueOrDefault(s.Id),
                WeeklyXp: (int)weekly.GetValueOrDefault(s.Id),
                CurrentStreak: ShownStreak(s, today),
                IsMe: s.Id == user.Id)).ToList();
            return EngagementResult<IReadOnlyList<LeaderboardEntryResponse>>.Ok(groupList);
        }

        // ── Global board: all students, all XP; rank in SQL ──
        var weeklyByStudent = _db.XpEvents
            .Where(x => x.CreatedAt >= weekAgo)
            .GroupBy(x => x.StudentId)
            .Select(g => new { StudentId = g.Key, WeeklyXp = (long)g.Sum(x => x.Amount) });

        var projected = _db.Users
            .Where(u => u.Role == UserRole.Student)
            .Select(u => new
            {
                u.Id,
                u.FullName,
                Xp = (long)u.Xp,
                u.CurrentStreak,
                u.LastPracticeDate,
                u.StreakFreezes,
                WeeklyXp = weeklyByStudent
                    .Where(w => w.StudentId == u.Id)
                    .Select(w => (long?)w.WeeklyXp)
                    .FirstOrDefault() ?? 0L,
            });

        var orderedRows = allTime
            ? projected.OrderByDescending(r => r.Xp).ThenByDescending(r => r.WeeklyXp)
            : projected.OrderByDescending(r => r.WeeklyXp).ThenByDescending(r => r.Xp);

        var topRows = await orderedRows.Take(50).ToListAsync(ct);

        var top = topRows.Select((r, i) => new LeaderboardEntryResponse(
            Rank: i + 1,
            Id: r.Id,
            FullName: r.FullName,
            Xp: (int)r.Xp,
            WeeklyXp: (int)r.WeeklyXp,
            CurrentStreak: StreakRules.Effective(r.CurrentStreak, r.LastPracticeDate, r.StreakFreezes, today),
            IsMe: r.Id == user.Id)).ToList();

        // A student who fell outside the top 50 gets their true rank appended, so they always see
        // themselves on the board.
        if (user.Role == UserRole.Student && !top.Any(e => e.IsMe))
        {
            var myWeekly = await _db.XpEvents
                .Where(x => x.StudentId == user.Id && x.CreatedAt >= weekAgo)
                .SumAsync(x => (long?)x.Amount, ct) ?? 0L;
            var myXp = (long)user.Xp;

            // rank = students (within scope) strictly ahead of me + 1.
            var better = await _db.Users
                .Where(u => u.Role == UserRole.Student)
                .Select(u => new
                {
                    Xp = (long)u.Xp,
                    WeeklyXp = weeklyByStudent
                        .Where(w => w.StudentId == u.Id)
                        .Select(w => (long?)w.WeeklyXp)
                        .FirstOrDefault() ?? 0L,
                })
                .CountAsync(r => allTime
                    ? (r.Xp > myXp || (r.Xp == myXp && r.WeeklyXp > myWeekly))
                    : (r.WeeklyXp > myWeekly || (r.WeeklyXp == myWeekly && r.Xp > myXp)), ct);

            top.Add(new LeaderboardEntryResponse(
                Rank: better + 1,
                Id: user.Id,
                FullName: user.FullName,
                Xp: (int)myXp,
                WeeklyXp: (int)myWeekly,
                CurrentStreak: ShownStreak(user, today),
                IsMe: true));
        }

        return EngagementResult<IReadOnlyList<LeaderboardEntryResponse>>.Ok(top);
    }

    // ─── Progress: skills breakdown + band trend (Ko'nikmalar tab) ─────────────

    /// <summary>Cap on the number of weekly points the band trend carries (docs contract: "~8–12").</summary>
    private const int TrendWeekCap = 12;

    /// <summary>
    /// <c>GET /api/progress/skills</c> — the caller's four skill averages, derived CEFR level and the
    /// weekly band trend, all computed from existing columns (NO schema change). Every query is scoped
    /// to the caller's own submissions, so a student can never observe another's skills. <c>null</c> ⇒
    /// the user is missing/inactive (401 at the endpoint).
    ///
    /// <para><b>Skills.</b> The four are ALWAYS returned in the fixed order fluency → pronunciation →
    /// lexical → grammar, each the AVG of that column rounded to a whole 0..100. SQL <c>AVG</c> ignores
    /// NULLs, so <c>PronunciationScore</c> (nullable) averages only the graded ones; a skill with no
    /// scores at all yields <c>0</c> (empty bar), never a crash.</para>
    ///
    /// <para><b>Level + band.</b> <c>Band</c> is the mean <c>OverallBand</c> to 1dp; <c>Level</c> /
    /// <c>LevelLabel</c> derive from that SAME rounded value via the shared <see cref="CefrScale"/>
    /// (thresholds live there, never duplicated). All three are <c>null</c> together when nothing is
    /// graded.</para>
    ///
    /// <para><b>Trend + delta.</b> The caller's evaluations are bucketed by ISO week (keyed on the
    /// submission's Tashkent-local date, <see cref="ProductDay"/>), averaged per week and emitted
    /// oldest→newest, capped to the last <see cref="TrendWeekCap"/> points; <c>WeekIndex</c> is a
    /// 0-based x-axis sequence.
    /// <c>BandDelta</c> is <c>Band</c> minus the earliest trend point's band; with fewer than 2 weekly
    /// points it is <c>null</c> and <c>DeltaWeeks</c> is <c>0</c>, else <c>DeltaWeeks</c> is the number
    /// of weekly points spanned.</para>
    /// </summary>
    public async Task<ProgressSkillsResponse?> SkillsAsync(Guid userId, CancellationToken ct = default)
    {
        // Missing/inactive ⇒ null ⇒ 401 (matches the ProfileService read slice). Nothing else off the
        // user row is needed for the skills view.
        if (!await _db.Users.AnyAsync(u => u.Id == userId && u.IsActive, ct)) return null;

        // One grouped aggregate for the four skill means + the average band. Each mean is a (double?)
        // AVG so an empty set is SQL NULL (→ 0 / "nothing graded") rather than an exception, and the
        // nullable pronunciation column is averaged over its non-null rows only.
        var agg = await _db.Evaluations
            .Where(e => e.Submission.StudentId == userId)
            .GroupBy(e => e.Submission.StudentId)
            .Select(g => new
            {
                Fluency = g.Average(e => (double?)e.FluencyScore),
                Pronunciation = g.Average(e => (double?)e.PronunciationScore),
                Lexical = g.Average(e => (double?)e.LexicalScore),
                Grammar = g.Average(e => (double?)e.GrammarScore),
                Band = g.Average(e => (double?)e.OverallBand),
            })
            .FirstOrDefaultAsync(ct);

        // Fixed order, always all four; a null (no scores) mean reads 0 with Scored = false, so the
        // UI can say "no data yet" rather than print a zero the student never earned.
        var skills = new List<ProgressSkillResponse>
        {
            new("fluency", Score0To100(agg?.Fluency), agg?.Fluency is not null),
            new("pronunciation", Score0To100(agg?.Pronunciation), agg?.Pronunciation is not null),
            new("lexical", Score0To100(agg?.Lexical), agg?.Lexical is not null),
            new("grammar", Score0To100(agg?.Grammar), agg?.Grammar is not null),
        };

        // Band to 1dp; the level is derived from that SAME rounded value so the badge never disagrees
        // with the number printed next to it at a bucket boundary.
        var band = agg?.Band is { } b ? Math.Round(b, 1, MidpointRounding.AwayFromZero) : (double?)null;
        var (level, levelLabel) = CefrScale.FromAverageBand(band);

        // Weekly band trend: pull the caller's (date, band) pairs and bucket by ISO week in memory —
        // this is one student's own history (bounded), and ISOWeek has no SQL translation. The week
        // is taken on Tashkent wall-clock time (ProductDay), so it starts at Monday 00:00 local — on
        // the raw UTC timestamp a Monday-morning answer before 05:00 fell into the previous week.
        var points = await _db.Evaluations
            .Where(e => e.Submission.StudentId == userId)
            .Select(e => new { e.Submission.CreatedAt, e.OverallBand })
            .ToListAsync(ct);

        var weekly = points
            .Select(p => new { Local = ProductDay.LocalTime(p.CreatedAt), p.OverallBand })
            .GroupBy(p => (Year: ISOWeek.GetYear(p.Local), Week: ISOWeek.GetWeekOfYear(p.Local)))
            .Select(gr => new { gr.Key.Year, gr.Key.Week, Avg = gr.Average(x => x.OverallBand) })
            .OrderBy(x => x.Year).ThenBy(x => x.Week)   // ISO year+week ⇒ chronological
            .ToList();

        // Cap to the last N weeks (oldest→newest), then index 0-based for the x-axis.
        var capped = weekly.Count > TrendWeekCap ? weekly.Skip(weekly.Count - TrendWeekCap).ToList() : weekly;
        var trend = capped
            .Select((w, i) => new ProgressTrendPointResponse(i, Math.Round(w.Avg, 1, MidpointRounding.AwayFromZero)))
            .ToList();

        // band_delta needs ≥ 2 weekly points; it is the current band minus the earliest window point.
        double? bandDelta = null;
        var deltaWeeks = 0;
        if (trend.Count >= 2 && band is { } cur)
        {
            bandDelta = Math.Round(cur - trend[0].Band, 1, MidpointRounding.AwayFromZero);
            deltaWeeks = trend.Count;
        }

        return new ProgressSkillsResponse(level, levelLabel, band, bandDelta, deltaWeeks, trend, skills);
    }

    // A nullable skill mean → the whole 0..100 the UI bar reads; null (no scores) ⇒ 0.
    private static int Score0To100(double? mean)
        => mean is { } m ? Math.Clamp((int)Math.Round(m, MidpointRounding.AwayFromZero), 0, 100) : 0;

    // ─── Progress: leaderboard summary (Reyting tab) ───────────────────────────

    /// <summary>
    /// <c>GET /api/progress/leaderboard?period=weekly|monthly|all</c> — the caller's standing in the
    /// student ranking for the chosen period plus a small neighbour window. Missing/inactive ⇒
    /// Unauthorized (401); a non-student caller ⇒ Forbidden (403, the ranking population is students).
    ///
    /// <para><b>period XP</b>: weekly = XpEvents in the last 7 days, monthly = last 30 days, all =
    /// <c>User.Xp</c>. Students are ranked by period XP, tie-broken by all-time XP. <b>my_rank</b> =
    /// students strictly ahead + 1 (competition ranking), computed in SQL — the full population is
    /// never loaded. <b>percentile</b> = <c>ceil(my_rank / total * 100)</c> clamped 1..100.
    /// <b>league</b>: percentile ≤ 10 → gold, ≤ 35 → silver, else bronze. <b>neighbours</b> is a
    /// sliding window of ≤ 5 rows (2 above + caller + 2 below, shifted to stay in-bounds), ascending by
    /// rank, always including the caller — fetched as two small SQL slices, never a full scan.
    /// <b>rank_delta</b> is best-effort: previousRank − my_rank from each student's cumulative XpEvents
    /// as of the period-start boundary; <c>null</c> for "all" (no previous period).</para>
    /// </summary>
    public async Task<EngagementResult<ProgressLeaderboardResponse>> LeaderboardSummaryAsync(
        Guid userId, string? period, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return EngagementResult<ProgressLeaderboardResponse>.Unauthorized();
        if (user.Role != UserRole.Student)
            return EngagementResult<ProgressLeaderboardResponse>.Forbidden();   // only students are ranked

        var normalized = period switch { "monthly" => "monthly", "all" => "all", _ => "weekly" };
        var allTime = normalized == "all";
        var now = DateTime.UtcNow;
        var periodStart = normalized == "monthly" ? now.AddDays(-30) : now.AddDays(-7);  // unused when allTime

        var total = await _db.Users.CountAsync(u => u.Role == UserRole.Student, ct);

        long myAllTime = user.Xp;
        long myPeriodXp = allTime
            ? myAllTime
            : await _db.XpEvents
                .Where(x => x.StudentId == user.Id && x.CreatedAt >= periodStart)
                .SumAsync(x => (long?)x.Amount, ct) ?? 0L;

        // Per-student ranking projection: all-time XP + the period XP. For "all" the period XP is just
        // User.Xp (no XpEvent scan); otherwise it is a correlated SUM of the in-window events. An
        // ANONYMOUS type is used deliberately — EF binds member access on it (pushing it to a derived
        // table), whereas a named positional record makes it re-inline the constructor and fail to
        // translate. The set is never materialized: callers only COUNT it or Take() a ≤2-row slice.
        var students = _db.Users.Where(u => u.Role == UserRole.Student);
        var proj = allTime
            ? students.Select(u => new { u.Id, u.FullName, AllTime = (long)u.Xp, PeriodXp = (long)u.Xp })
            : students.Select(u => new
            {
                u.Id,
                u.FullName,
                AllTime = (long)u.Xp,
                PeriodXp = _db.XpEvents
                    .Where(x => x.StudentId == u.Id && x.CreatedAt >= periodStart)
                    .Sum(x => (long?)x.Amount) ?? 0L,
            });

        // Rank = students strictly ahead of me (period XP, then all-time) + 1 — one SQL COUNT.
        var ahead = await proj.CountAsync(
            r => r.PeriodXp > myPeriodXp || (r.PeriodXp == myPeriodXp && r.AllTime > myAllTime), ct);
        var myRank = ahead + 1;

        var percentile = total == 0
            ? 100
            : Math.Clamp((int)Math.Ceiling((double)myRank / total * 100), 1, 100);
        var league = percentile <= 10 ? "gold" : percentile <= 35 ? "silver" : "bronze";

        // Sliding neighbour window: aim 2 above + me + 2 below, shift toward the side with room so the
        // window stays size ≤ 5 even at the ends (rank 1 → 1..5; last → final 5). Start symmetric, then
        // fill the remaining slots into whichever side still has students — clamped so neither side can
        // go negative or exceed its availability.
        var aboveAvail = myRank - 1;
        var belowAvail = total - myRank;
        var target = Math.Min(5, total);            // total rows incl. me, never past the population
        var wantAbove = Math.Min(2, aboveAvail);
        var wantBelow = Math.Min(2, belowAvail);
        var slots = target - 1 - wantAbove - wantBelow;   // ≥ 0
        if (slots > 0)
        {
            var addBelow = Math.Min(slots, belowAvail - wantBelow);
            wantBelow += addBelow;
            slots -= addBelow;
            wantAbove += Math.Min(slots, aboveAvail - wantAbove);
        }

        // The 2 students immediately above me = the smallest advantage among those ahead. Ordering the
        // ahead-set ascending gives closest-first; reversed below to ascending-rank order. Take(0) at an
        // edge is a cheap LIMIT 0, so the query shape stays uniform.
        var aboveRows = await proj
            .Where(r => r.PeriodXp > myPeriodXp || (r.PeriodXp == myPeriodXp && r.AllTime > myAllTime))
            .OrderBy(r => r.PeriodXp).ThenBy(r => r.AllTime).ThenBy(r => r.Id)
            .Take(wantAbove)
            .Select(r => new { r.Id, r.FullName, r.PeriodXp })
            .ToListAsync(ct);

        // The 2 immediately below me = the highest XP among those NOT ahead and not me (closest-first).
        var belowRows = await proj
            .Where(r => r.Id != user.Id
                        && !(r.PeriodXp > myPeriodXp || (r.PeriodXp == myPeriodXp && r.AllTime > myAllTime)))
            .OrderByDescending(r => r.PeriodXp).ThenByDescending(r => r.AllTime).ThenBy(r => r.Id)
            .Take(wantBelow)
            .Select(r => new { r.Id, r.FullName, r.PeriodXp })
            .ToListAsync(ct);

        var neighbors = new List<ProgressLeaderboardRowResponse>(aboveRows.Count + 1 + belowRows.Count);
        // aboveRows is closest-first (rank my_rank-1, my_rank-2, …) → reverse to ascending rank.
        aboveRows.Reverse();
        for (var i = 0; i < aboveRows.Count; i++)
            neighbors.Add(new ProgressLeaderboardRowResponse(
                myRank - (aboveRows.Count - i), aboveRows[i].Id, aboveRows[i].FullName, (int)aboveRows[i].PeriodXp, false));
        neighbors.Add(new ProgressLeaderboardRowResponse(myRank, user.Id, user.FullName, (int)myPeriodXp, true));
        for (var i = 0; i < belowRows.Count; i++)
            neighbors.Add(new ProgressLeaderboardRowResponse(
                myRank + i + 1, belowRows[i].Id, belowRows[i].FullName, (int)belowRows[i].PeriodXp, false));

        var rankDelta = await RankDeltaAsync(user.Id, myRank, allTime, periodStart, ct);

        return EngagementResult<ProgressLeaderboardResponse>.Ok(new ProgressLeaderboardResponse(
            Period: normalized,
            League: league,
            MyRank: myRank,
            TotalStudents: total,
            Percentile: percentile,
            MyXp: (int)myPeriodXp,
            CurrentStreak: ShownStreak(user, StreakRules.Today()),
            RankDelta: rankDelta,
            Neighbors: neighbors));
    }

    // Best-effort previous-period rank delta: rank the caller by cumulative XpEvents BEFORE the
    // period-start boundary, then previousRank − my_rank (positive ⇒ climbed). Null for "all" (there
    // is no previous period). One grouped SUM over the pre-boundary events — comparable in cost to the
    // weekly board — so it is computed rather than skipped; the choice is logged, never fabricated.
    private async Task<int?> RankDeltaAsync(Guid meId, int myRank, bool allTime, DateTime periodStart, CancellationToken ct)
    {
        if (allTime)
        {
            _logger?.LogDebug("progress leaderboard rank_delta: period=all has no previous period → null (rank {MyRank})", myRank);
            return null;
        }

        var myPrev = await _db.XpEvents
            .Where(x => x.StudentId == meId && x.CreatedAt < periodStart)
            .SumAsync(x => (long?)x.Amount, ct) ?? 0L;

        // Students with more cumulative XP than me as of the boundary. A student with no pre-boundary
        // events has cumulative 0 and is only "ahead" when my own pre-boundary total is negative
        // (impossible), so absentees are correctly not counted.
        var prevAhead = await _db.XpEvents
            .Where(x => x.CreatedAt < periodStart)
            .GroupBy(x => x.StudentId)
            .Select(g => new { StudentId = g.Key, Cum = (long)g.Sum(x => x.Amount) })
            .CountAsync(r => r.Cum > myPrev, ct);

        var previousRank = prevAhead + 1;
        var delta = previousRank - myRank;
        _logger?.LogDebug(
            "progress leaderboard rank_delta: period={Period}Start prevRank={PrevRank} myRank={MyRank} → {Delta}",
            periodStart, previousRank, myRank, delta);
        return delta;
    }

    // ─── SRS review queue ─────────────────────────────────────────────────────

    /// <summary>
    /// GET /review — the student's DUE, still-open reviews, one per question (dedup keeps the earliest
    /// due), ordered by due date. Any active user; null ⇒ 401.
    /// </summary>
    public async Task<IReadOnlyList<ReviewItemResponse>?> MyReviewsAsync(Guid userId, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return null;

        var items = await DueReviewsAsync(user.Id, ct);

        var qmap = items.Count == 0
            ? new Dictionary<Guid, Question>()
            : await _db.Questions
                .Where(q => items.Select(i => i.QuestionId).Contains(q.Id))
                .ToDictionaryAsync(q => q.Id, ct);

        var outList = new List<ReviewItemResponse>(items.Count);
        foreach (var it in items)
        {
            qmap.TryGetValue(it.QuestionId, out var q);
            outList.Add(new ReviewItemResponse(
                Id: it.Id,
                QuestionId: it.QuestionId,
                QuestionTitle: q?.Title,
                QuestionTopic: q?.Topic,
                QuestionLevel: q?.Level,
                WeaknessDim: it.WeaknessDim,
                DueAt: it.DueAt));
        }
        return outList;
    }

    // The student's DUE, still-open reviews: earliest first, one row per question (the earliest due
    // wins). Two open rows for one question is a REAL state — a teacher can queue a question the
    // grader has already flagged — and the same prompt appearing twice in one queue (or twice in one
    // drill session) reads as a bug. Both the list and the drill resolve "what is due" here so the
    // two surfaces can never disagree about it.
    private async Task<List<ReviewItem>> DueReviewsAsync(Guid studentId, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var rows = await _db.ReviewItems
            .Where(r => r.StudentId == studentId && !r.Completed && r.DueAt <= now)
            .OrderBy(r => r.DueAt)
            .ToListAsync(ct);

        var seen = new HashSet<Guid>();
        var deduped = new List<ReviewItem>(rows.Count);
        foreach (var r in rows)
            if (seen.Add(r.QuestionId))
                deduped.Add(r);
        return deduped;
    }

    /// <summary>
    /// POST /review — a teacher adds question(s) to a student's / group's review queue, due now and
    /// tagged "teacher". A teacher may only target their OWN questions and their
    /// OWN roster (admins: anyone). Duplicates of an already-open (student, question) review are
    /// skipped; a student is only notified when something was actually added.
    /// </summary>
    public async Task<EngagementResult<IReadOnlyList<ReviewItemResponse>>> CreateReviewsAsync(
        Guid userId, CreateReviewsRequest payload, CancellationToken ct = default)
    {
        var teacher = await ActiveUserAsync(userId, ct);
        if (teacher is null) return EngagementResult<IReadOnlyList<ReviewItemResponse>>.Unauthorized();
        if (!IsTeacher(teacher)) return EngagementResult<IReadOnlyList<ReviewItemResponse>>.Forbidden();

        var questionIds = payload.QuestionIds ?? [];
        // Validate the questions belong to this teacher (admin: any).
        var qquery = _db.Questions.Where(q => questionIds.Contains(q.Id));
        if (teacher.Role != UserRole.Admin)
            qquery = qquery.Where(q => q.TeacherId == teacher.Id);
        var questions = await qquery.ToDictionaryAsync(q => q.Id, ct);
        if (questions.Count == 0)
            return EngagementResult<IReadOnlyList<ReviewItemResponse>>.NotFound();  // none matched / none theirs

        var targetIds = await ResolveTargetsAsync(payload.StudentIds, payload.GroupId, ct);
        var validIds = await RosterStudentIds(teacher, targetIds, ct);              // own-roster students only
        if (validIds.Count == 0)
            return EngagementResult<IReadOnlyList<ReviewItemResponse>>.BadRequest("No target students");

        // Students who have switched notifications OFF still GET the review items — the teacher's
        // assignment is not a preference — they just are not pinged about them. Resolved once for the
        // whole batch rather than per student, and read here because a stored preference nothing
        // honours is a decorative switch.
        var muted = (await _db.Users
                .Where(u => validIds.Contains(u.Id) && !u.NotificationsEnabled)
                .Select(u => u.Id)
                .ToListAsync(ct))
            .ToHashSet();

        var now = DateTime.UtcNow;
        var created = new List<ReviewItem>();
        foreach (var sid in validIds)
        {
            var made = 0;
            foreach (var qid in questions.Keys)
            {
                var exists = await _db.ReviewItems.AnyAsync(
                    r => r.StudentId == sid && r.QuestionId == qid && !r.Completed, ct);
                if (exists) continue;                               // skip duplicate open review
                var item = new ReviewItem
                {
                    Id = Guid.NewGuid(),
                    StudentId = sid,
                    QuestionId = qid,
                    WeaknessDim = "teacher",
                    IntervalIndex = 0,
                    DueAt = now,
                    Completed = false,
                    CreatedAt = now,
                    UpdatedAt = now,
                };
                _db.ReviewItems.Add(item);
                created.Add(item);
                made++;
            }
            if (made > 0 && !muted.Contains(sid))                   // only ping when something was added
                Notify(sid, "review_added",
                    "Takrorlash uchun yangi mashqlar",
                    "O'qituvchi sizga takrorlash uchun mashq(lar) qo'shdi.",
                    "/review");
        }
        await _db.SaveChangesAsync(ct);

        var outList = created.Select(it =>
        {
            questions.TryGetValue(it.QuestionId, out var q);
            return new ReviewItemResponse(
                Id: it.Id,
                QuestionId: it.QuestionId,
                QuestionTitle: q?.Title,
                QuestionTopic: q?.Topic,
                QuestionLevel: q?.Level,
                WeaknessDim: it.WeaknessDim,
                DueAt: it.DueAt);
        }).ToList();
        return EngagementResult<IReadOnlyList<ReviewItemResponse>>.Ok(outList);
    }

    // ─── F5 · Xato-replay drill (docs/08 Faza 6.1, behind a flag) ─────────────

    /// <summary>
    /// <c>app_settings</c> key that gates the drill. Faza 6 features ship behind a flag and cutover
    /// does not wait for them (docs/08 "Deploy ≠ release"), so this defaults to <b>off</b>: the drill
    /// routes 404 until someone stores a truthy value (or sets <c>REVIEW_DRILL_ENABLED</c>).
    /// </summary>
    public const string ReviewDrillFlagKey = "review_drill_enabled";

    // Env-var default for the flag — the uppercase form of the key, the convention every other
    // app_settings key follows.
    private const string ReviewDrillFlagEnvVar = "REVIEW_DRILL_ENABLED";

    /// <summary>How many cards one drill session serves. A student returning from a fortnight away can
    /// have forty items due; handing them all forty is how a queue becomes a chore nobody opens.</summary>
    public const int DrillSessionSize = 10;

    // The truthy spellings app_settings uses for boolean-ish keys. Kept identical to the admin
    // module's set on purpose: two toggles in one table that disagree about what "on" spells is a bug
    // waiting to be filed against whichever one the admin typed "yes" into.
    private static readonly HashSet<string> TrueWords = new(StringComparer.Ordinal) { "true", "1", "yes", "on" };

    /// <summary>
    /// Whether the xato-replay drill is switched on. Same resolution order as every other setting —
    /// <c>app_settings</c> override → env default → <c>false</c> — but resolved against the table
    /// DIRECTLY rather than through <c>AppSettingsService</c>: that service lives in
    /// <c>Govori.Administration</c>, and a module→module reference is exactly what the §7.2 boundary
    /// guardrail (and <c>BoundaryRuleTests</c>) forbids. The read is one indexed lookup on a route a
    /// student opens a handful of times a day, so it is not worth a second cache either.
    /// </summary>
    public async Task<bool> ReviewDrillEnabledAsync(CancellationToken ct = default)
    {
        var raw = await _db.AppSettings
            .AsNoTracking()
            .Where(s => s.Key == ReviewDrillFlagKey)
            .Select(s => s.Value)
            .FirstOrDefaultAsync(ct);

        // A stored NULL or "" is not an override — it falls through to the env default, matching
        // AppSettingsService.GetAsync, so clearing the row really does revert the flag.
        if (string.IsNullOrEmpty(raw)) raw = _config?[ReviewDrillFlagEnvVar];

        return raw is not null && TrueWords.Contains(raw.Trim().ToLowerInvariant());
    }

    /// <summary>
    /// <c>GET /api/review/drill</c> — one drill session: the student's due reviews, capped at
    /// <see cref="DrillSessionSize"/>, each carrying the question's full text so the card can ask them
    /// to say it again. Flag off ⇒ NotFound (the feature does not exist yet, and 404 is what "does not
    /// exist" means); missing/inactive user ⇒ Unauthorized.
    ///
    /// <para>An item whose question has been deleted is dropped rather than shown: the queue's list
    /// view can survive a missing title, but a drill card with nothing to say cannot. Those items stay
    /// in the table — this read hides them, it does not clean up after the content owner.</para>
    /// </summary>
    public async Task<EngagementResult<ReviewDrillResponse>> DrillAsync(Guid userId, CancellationToken ct = default)
    {
        if (!await ReviewDrillEnabledAsync(ct))
            return EngagementResult<ReviewDrillResponse>.NotFound();

        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return EngagementResult<ReviewDrillResponse>.Unauthorized();

        var (due, questions) = await DrillableAsync(user.Id, ct);

        var items = due
            .Take(DrillSessionSize)
            .Select(it =>
            {
                var q = questions[it.QuestionId];
                return new ReviewDrillItemResponse(
                    Id: it.Id,
                    QuestionId: it.QuestionId,
                    QuestionTitle: q.Title,
                    PromptText: q.PromptText,
                    InstructionText: q.InstructionText,
                    ModelAnswerText: q.ModelAnswerText,
                    QuestionTopic: q.Topic,
                    QuestionLevel: q.Level,
                    WeaknessDim: it.WeaknessDim,
                    Round: Round(it.IntervalIndex),
                    TotalRounds: ReviewIntervalsDays.Length,
                    DueAt: it.DueAt);
            })
            .ToList();

        return EngagementResult<ReviewDrillResponse>.Ok(
            new ReviewDrillResponse(due.Count, ReviewIntervalsDays.Length, items));
    }

    /// <summary>
    /// <c>POST /api/review/{id}/answer</c> — the student's verdict on one replay, which is what finally
    /// moves an item along <see cref="ReviewIntervalsDays"/>. Flag off ⇒ NotFound; a missing, foreign or
    /// already-completed item ⇒ NotFound (never distinguishing the three, so the route cannot be used to
    /// probe another student's queue); an unrecognised outcome ⇒ BadRequest.
    ///
    /// <para><b>The ladder.</b> <c>"good"</c> climbs one rung: <c>interval_index</c> goes up by one and
    /// <c>due_at</c> becomes <c>now + ReviewIntervalsDays[index]</c> (1 → 3 → 7 → 16 → 35 days). Past the
    /// last rung the item <c>completed</c>s — it has survived every interval and is done. <c>"again"</c>
    /// is a lapse: back to index 0, due tomorrow. Either way the item leaves TODAY's queue, which is what
    /// lets a session actually finish.</para>
    ///
    /// <para><b>Why the student's own verdict, and not a grade.</b> Routing the replay through the
    /// grading pipeline would hand the schedule straight back to <see cref="ScheduleReviewAsync"/>, which
    /// supersedes every open review for that (student, question) on each graded attempt — the ladder
    /// could then never climb past its first rung, and <see cref="ReviewIntervalsDays"/> would stay the
    /// dead constant it has been. So the two own different questions: the drill owns "how long until I
    /// see this again", the grader keeps owning "is this still a weakness" — every answered, graded
    /// attempt in Mashq runs <see cref="ScheduleReviewAsync"/> (through <see cref="SubmissionRewarder"/>),
    /// which retires the question's open reviews and re-enqueues at index 0 only if the student is
    /// still below <see cref="ReviewThreshold"/>.</para>
    /// </summary>
    public async Task<EngagementResult<ReviewAnswerResponse>> AnswerReviewAsync(
        Guid userId, Guid reviewId, ReviewAnswerRequest? payload, CancellationToken ct = default)
    {
        if (!await ReviewDrillEnabledAsync(ct))
            return EngagementResult<ReviewAnswerResponse>.NotFound();

        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return EngagementResult<ReviewAnswerResponse>.Unauthorized();

        var outcome = payload?.Outcome?.Trim().ToLowerInvariant();
        if (outcome is not ("good" or "again"))
            return EngagementResult<ReviewAnswerResponse>.BadRequest("outcome must be 'good' or 'again'");

        var item = await _db.ReviewItems.FirstOrDefaultAsync(r => r.Id == reviewId, ct);
        if (item is null || item.StudentId != user.Id || item.Completed)
            return EngagementResult<ReviewAnswerResponse>.NotFound();

        var now = DateTime.UtcNow;
        var lastRung = ReviewIntervalsDays.Length - 1;
        // Clamp before stepping: a stored index outside the ladder (older data, a hand-edited row)
        // must not index the array out of bounds on a route a student can call.
        var current = Math.Clamp(item.IntervalIndex, 0, lastRung);
        var graduated = false;
        DateTime? nextDueAt;

        if (outcome == "again")
        {
            item.IntervalIndex = 0;
            item.DueAt = now.AddDays(ReviewIntervalsDays[0]);
            nextDueAt = item.DueAt;
        }
        else if (current >= lastRung)
        {
            // Every rung survived. `completed` is the graduation marker; `due_at` is deliberately left
            // where it was, because writing a future date for a review that will never happen would be
            // a lie the table then keeps.
            item.IntervalIndex = lastRung;
            item.Completed = true;
            graduated = true;
            nextDueAt = null;
        }
        else
        {
            item.IntervalIndex = current + 1;
            item.DueAt = now.AddDays(ReviewIntervalsDays[item.IntervalIndex]);
            nextDueAt = item.DueAt;
        }

        item.UpdatedAt = now;
        await _db.SaveChangesAsync(ct);

        // Recounted AFTER the commit so the screen advances on a server fact rather than on its own
        // optimism — and so a second device drilling the same queue is reflected immediately.
        var (remaining, _) = await DrillableAsync(user.Id, ct);

        return EngagementResult<ReviewAnswerResponse>.Ok(new ReviewAnswerResponse(
            Id: item.Id,
            Round: Round(item.IntervalIndex),
            TotalRounds: ReviewIntervalsDays.Length,
            Graduated: graduated,
            NextDueAt: nextDueAt,
            RemainingDue: remaining.Count));
    }

    // The due queue narrowed to what is actually drillable — items whose question still exists — plus
    // the questions themselves, since every caller needs both and neither is worth two round trips.
    private async Task<(List<ReviewItem> Items, Dictionary<Guid, Question> Questions)> DrillableAsync(
        Guid studentId, CancellationToken ct)
    {
        var due = await DueReviewsAsync(studentId, ct);
        if (due.Count == 0) return ([], []);

        var ids = due.Select(d => d.QuestionId).ToList();
        var questions = await _db.Questions
            .Where(q => ids.Contains(q.Id) && !q.IsDeleted)
            .ToDictionaryAsync(q => q.Id, ct);

        return (due.Where(d => questions.ContainsKey(d.QuestionId)).ToList(), questions);
    }

    // 0-based interval_index → the 1-based round a student is shown ("2 / 5"). Nobody counts their
    // own revision from zero.
    private static int Round(int intervalIndex)
        => Math.Clamp(intervalIndex, 0, ReviewIntervalsDays.Length - 1) + 1;

    // ─── Notifications ────────────────────────────────────────────────────────

    /// <summary>GET /notifications — the current user's notifications, newest first, capped at
    /// <paramref name="limit"/>. <paramref name="unreadOnly"/> filters to
    /// unread. Any active user; null ⇒ 401.</summary>
    public async Task<IReadOnlyList<NotificationResponse>?> ListNotificationsAsync(
        Guid userId, bool unreadOnly, int limit, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return null;

        var capped = Math.Clamp(limit, 1, 100);                     // hard bound on page size
        var q = _db.Notifications.Where(n => n.UserId == user.Id);
        if (unreadOnly) q = q.Where(n => !n.IsRead);
        var items = await q
            .OrderByDescending(n => n.CreatedAt)
            .Take(capped)
            .ToListAsync(ct);
        return items.Select(ToResponse).ToList();
    }

    /// <summary>GET /notifications/unread-count. Any active user; null ⇒ 401.</summary>
    public async Task<int?> UnreadCountAsync(Guid userId, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return null;
        return await _db.Notifications.CountAsync(n => n.UserId == user.Id && !n.IsRead, ct);
    }

    /// <summary>POST /notifications/read-all — mark all the user's notifications read.
    /// Returns false ⇒ 401 (no active user).</summary>
    public async Task<bool> MarkAllReadAsync(Guid userId, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return false;
        await _db.Notifications
            .Where(n => n.UserId == user.Id && !n.IsRead)
            .ExecuteUpdateAsync(s => s.SetProperty(n => n.IsRead, true), ct);
        return true;
    }

    /// <summary>POST /notifications/{id}/read — mark one notification read.
    /// Missing OR not owned ⇒ NotFound.</summary>
    public async Task<EngagementOutcome> MarkReadAsync(Guid userId, Guid notificationId, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return EngagementOutcome.Unauthorized;
        var n = await _db.Notifications.FirstOrDefaultAsync(x => x.Id == notificationId, ct);
        if (n is null || n.UserId != user.Id) return EngagementOutcome.NotFound;  // never leaks ownership
        n.IsRead = true;
        await _db.SaveChangesAsync(ct);
        return EngagementOutcome.Ok;
    }

    /// <summary>DELETE /notifications/{id} — delete one notification.
    /// Missing OR not owned ⇒ NotFound.</summary>
    public async Task<EngagementOutcome> DeleteNotificationAsync(Guid userId, Guid notificationId, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return EngagementOutcome.Unauthorized;
        var n = await _db.Notifications.FirstOrDefaultAsync(x => x.Id == notificationId, ct);
        if (n is null || n.UserId != user.Id) return EngagementOutcome.NotFound;
        _db.Notifications.Remove(n);
        await _db.SaveChangesAsync(ct);
        return EngagementOutcome.Ok;
    }

    /// <summary>DELETE /notifications — clear all the user's notifications.
    /// Returns false ⇒ 401.</summary>
    public async Task<bool> ClearAllAsync(Guid userId, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return false;
        await _db.Notifications.Where(n => n.UserId == user.Id).ExecuteDeleteAsync(ct);
        return true;
    }

    /// <summary>Create an in-app notification. Adds it to the change tracker ONLY — the caller owns
    /// the commit, so the notification lands in the same transaction as the write that raised it.
    ///
    /// <para>The caller is responsible for checking <c>User.NotificationsEnabled</c> first. It is not
    /// checked here on purpose: this method is sync by design (no commit, no I/O), and a per-call
    /// lookup would put one query behind every notification in a loop. Callers resolve the opted-out
    /// set once per batch instead.</para></summary>
    private void Notify(Guid userId, string type, string title, string? body, string? link)
    {
        var now = DateTime.UtcNow;
        _db.Notifications.Add(new Notification
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Type = type,
            Title = title,
            Body = body,
            Link = link,
            IsRead = false,
            CreatedAt = now,
            UpdatedAt = now,
        });
    }

    // ─── Shared helpers ───────────────────────────────────────────────────────

    private async Task<User?> ActiveUserAsync(Guid userId, CancellationToken ct)
        => await _db.Users.FirstOrDefaultAsync(u => u.Id == userId && u.IsActive, ct);

    private static bool IsTeacher(User u) => u.Role is UserRole.Teacher or UserRole.Admin;

    // The streak a student is SHOWN — never the raw column, which only moves on the next award and
    // so keeps a long-broken streak alive on screen. Reads nothing extra and writes nothing: no
    // freeze is spent by looking. See StreakRules.
    private static int ShownStreak(User u, DateOnly today)
        => StreakRules.Effective(u.CurrentStreak, u.LastPracticeDate, u.StreakFreezes, today);

    // Targets = explicit ids ∪ a whole group's members.
    private async Task<List<Guid>> ResolveTargetsAsync(List<Guid>? studentIds, Guid? groupId, CancellationToken ct)
    {
        var target = new HashSet<Guid>(studentIds ?? []);
        if (groupId is not null)
        {
            var members = await _db.GroupMembers
                .Where(gm => gm.GroupId == groupId.Value)
                .Select(gm => gm.StudentId)
                .ToListAsync(ct);
            foreach (var m in members) target.Add(m);
        }
        return target.ToList();
    }

    // Keep only targets that are students AND (unless the actor is an admin) on the acting teacher's
    // roster — a member of some group this teacher owns. This restriction is what stops a teacher
    // queueing work for another teacher's students; do not widen it.
    private async Task<List<Guid>> RosterStudentIds(User teacher, List<Guid> targetIds, CancellationToken ct)
    {
        if (targetIds.Count == 0) return [];
        var isAdmin = teacher.Role == UserRole.Admin;
        return await _db.Users
            .Where(u => targetIds.Contains(u.Id)
                        && u.Role == UserRole.Student
                        && (isAdmin
                            || _db.GroupMembers.Any(gm => gm.StudentId == u.Id
                                                          && gm.Group.TeacherId == teacher.Id)))
            .Select(u => u.Id)
            .ToListAsync(ct);
    }

    private static NotificationResponse ToResponse(Notification n) => new(
        Id: n.Id,
        Type: n.Type,
        Title: n.Title,
        Body: n.Body,
        Link: n.Link,
        IsRead: n.IsRead,
        CreatedAt: n.CreatedAt);
}

// ─── Result plumbing (mirrors the Classroom/Practice module's outcome→HTTP mapping) ────

/// <summary>Domain outcome an endpoint maps to an HTTP status.</summary>
public enum EngagementOutcome { Ok, Unauthorized, Forbidden, NotFound, BadRequest }

/// <summary>A service result: an <see cref="EngagementOutcome"/> plus a payload on success and an
/// optional detail message for error bodies.</summary>
public sealed record EngagementResult<T>(EngagementOutcome Outcome, T? Value = null, string? Detail = null)
    where T : class
{
    public static EngagementResult<T> Ok(T value) => new(EngagementOutcome.Ok, value);
    public static EngagementResult<T> Unauthorized() => new(EngagementOutcome.Unauthorized);
    public static EngagementResult<T> Forbidden() => new(EngagementOutcome.Forbidden);
    public static EngagementResult<T> NotFound() => new(EngagementOutcome.NotFound);
    public static EngagementResult<T> BadRequest(string detail) => new(EngagementOutcome.BadRequest, null, detail);
}
