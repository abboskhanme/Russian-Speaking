using Govori.Contracts;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Microsoft.EntityFrameworkCore;

namespace Govori.Engagement;

/// <summary>
/// Application service for the Engagement vertical slice (docs/07 §3.6, Faza 3.6) — XP, streaks
/// (with freezes), the leaderboard, the spaced-repetition (SRS) review queue and in-app
/// notifications. Ported faithfully from Python:
/// <list type="bullet">
///   <item>XP / streak / SRS scheduling award logic: <c>backend/app/services/gamification.py</c>
///     (<c>xp_for_band</c>, <c>award_submission</c>, <c>award_practice</c>, <c>_update_streak</c>,
///     <c>schedule_review</c>) — called from the grading worker, not an HTTP route;</item>
///   <item>leaderboard + review read/create: <c>backend/app/api/v1/engagement.py</c>
///     (<c>leaderboard</c>, <c>my_reviews</c>, <c>create_reviews</c>);</item>
///   <item>notifications: <c>backend/app/api/v1/notifications.py</c> + the <c>notify</c> helper in
///     <c>backend/app/services/notifications.py</c>.</item>
/// </list>
///
/// <para><b>C8 (FROZEN).</b> <see cref="XpForBand"/> is the anti-farming XP curve
/// (<c>&lt;27 → 0</c>, else banker's-rounded <c>pct/4</c>; <c>null → 0</c>). It is pinned by the C8
/// fixture <c>tests/characterization/fixtures/xp_cases.json</c> and driven through this REAL
/// production method by <c>Govori.Characterization.EngagementXpPortTests</c>. Do not "improve" it.</para>
///
/// <para><b>Roster filter (mirrors Classroom's S1 fix).</b> <see cref="CreateReviewsAsync"/> already
/// had a roster filter in Python (engagement.py:250-258) — a teacher may only queue reviews for
/// students on their own roster (admins: anyone). This port keeps it via <see cref="RosterStudentIds"/>.</para>
///
/// <para><b>S6 (NOT fixed here — faithful port).</b> <c>_update_streak</c> keys off the SERVER date
/// (Python <c>date.today()</c>), not the user's timezone (docs/07 §7.8 bug S6). This port mirrors it
/// with <c>DateOnly.FromDateTime(DateTime.UtcNow)</c>. The award methods expose an optional
/// <c>today</c> seam so the worker (and deterministic tests) can supply the date explicitly; a
/// TZ-correct fix is deferred to when user-timezone plumbing lands.</para>
///
/// <para>Role/auth: leaderboard + review-list + all notification routes are <c>get_current_user</c>
/// (any active user; null ⇒ 401). <see cref="CreateReviewsAsync"/> is <c>require_teacher</c>
/// (teacher OR admin; 403 otherwise). role/is_active are read from the DB, never trusted from the
/// token — the endpoint supplies only the <c>sub</c>.</para>
/// </summary>
public sealed class EngagementService
{
    private readonly GovoriDbContext _db;

    public EngagementService(GovoriDbContext db) => _db = db;

    // ─── Frozen constants (gamification.py:15-19) ─────────────────────────────

    /// <summary>Flag a skill for SRS review below this 0–100 score (gamification.py:15).</summary>
    public const double ReviewThreshold = 67.0;

    /// <summary>Graduated spaced-repetition intervals in days, by review round (gamification.py:17).</summary>
    public static readonly int[] ReviewIntervalsDays = { 1, 3, 7, 16, 35 };

    /// <summary>Earn one streak freeze on every Nth consecutive day (gamification.py:19).</summary>
    public const int FreezeEarnEvery = 5;

    /// <summary>Fixed XP for a non-graded practice attempt (gamification.py:52).</summary>
    public const int PracticeXp = 5;

    // ─── C8: XP curve (gamification.py:24-31) — FROZEN ────────────────────────

    /// <summary>
    /// XP scales linearly with the 0–100 score (<c>score/4</c> → 25 XP at 100%), but answers below
    /// 27% earn nothing (anti-farming floor). <c>null → 0</c>. Uses banker's rounding
    /// (<see cref="MidpointRounding.ToEven"/>) to match Python's <c>int(round(pct/4))</c>. FROZEN by
    /// the C8 fixture — do not change the math.
    /// </summary>
    public static int XpForBand(double? score)
    {
        var pct = score ?? 0;                                        // Python `score or 0`
        if (pct < 27) return 0;
        return (int)Math.Round(pct / 4.0, MidpointRounding.ToEven);
    }

    // ─── XP / streak award (gamification.py:34-91) ────────────────────────────

    /// <summary>
    /// Award XP for a graded submission and roll the daily streak (gamification.py:34-49). Only real
    /// students accrue XP/streak (teacher/admin runs earn nothing); a non-answered attempt earns
    /// nothing. XP basis is the level-relative score when present, else the absolute band. Best-effort
    /// in Python; here it commits its own unit of work.
    /// </summary>
    public async Task AwardSubmissionAsync(
        Submission sub, Evaluation evaluation, bool answered = true, DateOnly? today = null, CancellationToken ct = default)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == sub.StudentId, ct);
        if (user is null || user.Role != UserRole.Student) return;  // gamification.py:37-38
        if (!answered) return;                                      // gamification.py:41-42

        // Level-relative score (motivating) when available, else the absolute overall (gamification.py:45).
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
        user.Xp += amount;                                          // gamification.py:48
        UpdateStreak(user, today ?? DateOnly.FromDateTime(DateTime.UtcNow));
        await _db.SaveChangesAsync(ct);
    }

    /// <summary>
    /// Reward a non-graded practice attempt (shadowing) with a fixed <see cref="PracticeXp"/> and roll
    /// the streak (gamification.py:55-66). Teacher/admin runs earn nothing.
    /// </summary>
    public async Task AwardPracticeAsync(Submission sub, DateOnly? today = null, CancellationToken ct = default)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == sub.StudentId, ct);
        if (user is null || user.Role != UserRole.Student) return;  // gamification.py:60-61

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
        UpdateStreak(user, today ?? DateOnly.FromDateTime(DateTime.UtcNow));
        await _db.SaveChangesAsync(ct);
    }

    // gamification.py:69-91 — daily streak with freeze bridging + freeze earning. Mutates `user`.
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
                if (user.StreakFreezes >= missed)
                {
                    user.StreakFreezes -= missed;                   // spend freezes to bridge
                    user.CurrentStreak += 1;
                }
                else
                {
                    user.CurrentStreak = 1;                         // streak broken
                }
            }
            // gap <= 0 (a last-practice date in the future): unchanged, mirroring Python.
        }

        user.LastPracticeDate = today;
        user.LongestStreak = Math.Max(user.LongestStreak, user.CurrentStreak);
        if (user.CurrentStreak != 0 && user.CurrentStreak % FreezeEarnEvery == 0)
            user.StreakFreezes += 1;                                // earn a freeze on every Nth day
    }

    // ─── SRS scheduling (gamification.py:94-127) ──────────────────────────────

    /// <summary>
    /// Mark prior open reviews for this (student, question) done, then schedule a new review for the
    /// single weakest skill dimension below <see cref="ReviewThreshold"/> (gamification.py:94-127).
    /// Dimensions are considered in the order fluency → lexical → grammar → relevance; the lowest wins,
    /// ties break to the earliest in that order (mirrors Python <c>min</c> over an ordered dict). Only
    /// real students accrue reviews.
    /// </summary>
    public async Task ScheduleReviewAsync(Submission sub, Evaluation evaluation, CancellationToken ct = default)
    {
        var student = await _db.Users.FirstOrDefaultAsync(u => u.Id == sub.StudentId, ct);
        if (student is null || student.Role != UserRole.Student) return;  // gamification.py:97-98

        var prior = await _db.ReviewItems
            .Where(r => r.StudentId == sub.StudentId && r.QuestionId == sub.QuestionId && !r.Completed)
            .ToListAsync(ct);
        foreach (var r in prior) r.Completed = true;                // gamification.py:99-107

        // gamification.py:109-116 — insertion order matters (Python dict); first-min on ties.
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

    // ─── Leaderboard (engagement.py:36-172) ───────────────────────────────────

    /// <summary>
    /// Ranked by the chosen period's XP with the other period as tiebreak (engagement.py:36-172).
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

        var allTime = period == "all";                              // engagement.py:51
        var weekAgo = DateTime.UtcNow.AddDays(-7);                  // engagement.py:52

        // ── Group/class board: scored from this group's ASSIGNED tasks only (engagement.py:55-101) ──
        if (groupId is not null)
        {
            if (user.Role == UserRole.Student)
            {
                var isMember = await _db.GroupMembers.AnyAsync(
                    gm => gm.GroupId == groupId.Value && gm.StudentId == user.Id, ct);
                if (!isMember)
                    return EngagementResult<IReadOnlyList<LeaderboardEntryResponse>>.Forbidden();  // engagement.py:62-63
            }

            var members = await _db.Users
                .Join(_db.GroupMembers, u => u.Id, gm => gm.StudentId, (u, gm) => new { u, gm })
                .Where(x => x.gm.GroupId == groupId.Value && x.u.Role == UserRole.Student)
                .Select(x => x.u)
                .ToListAsync(ct);

            // XP from submissions linked to an assignment of THIS group (engagement.py:72-77).
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

            // sorted(reverse=True) keeps the original (query) order on full ties — matched by a stable
            // OrderByDescending/ThenByDescending (engagement.py:84-89).
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
                CurrentStreak: s.CurrentStreak,
                IsMe: s.Id == user.Id)).ToList();
            return EngagementResult<IReadOnlyList<LeaderboardEntryResponse>>.Ok(groupList);
        }

        // ── Global board: all students, all XP; rank in SQL (engagement.py:103-138) ──
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
            CurrentStreak: r.CurrentStreak,
            IsMe: r.Id == user.Id)).ToList();

        // engagement.py:139-171 — a student outside the top 50 gets their true rank appended.
        if (user.Role == UserRole.Student && !top.Any(e => e.IsMe))
        {
            var myWeekly = await _db.XpEvents
                .Where(x => x.StudentId == user.Id && x.CreatedAt >= weekAgo)
                .SumAsync(x => (long?)x.Amount, ct) ?? 0L;
            var myXp = (long)user.Xp;

            // rank = students (within scope) strictly ahead of me + 1 (engagement.py:148-160).
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
                CurrentStreak: user.CurrentStreak,
                IsMe: true));
        }

        return EngagementResult<IReadOnlyList<LeaderboardEntryResponse>>.Ok(top);
    }

    // ─── SRS review queue (engagement.py:176-317) ─────────────────────────────

    /// <summary>
    /// GET /review — the student's DUE, still-open reviews, one per question (dedup keeps the earliest
    /// due), ordered by due date (engagement.py:176-215). Any active user; null ⇒ 401.
    /// </summary>
    public async Task<IReadOnlyList<ReviewItemResponse>?> MyReviewsAsync(Guid userId, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return null;

        var now = DateTime.UtcNow;
        var items = await _db.ReviewItems
            .Where(r => r.StudentId == user.Id && !r.Completed && r.DueAt <= now)
            .OrderBy(r => r.DueAt)
            .ToListAsync(ct);

        var qmap = items.Count == 0
            ? new Dictionary<Guid, Question>()
            : await _db.Questions
                .Where(q => items.Select(i => i.QuestionId).Contains(q.Id))
                .ToDictionaryAsync(q => q.Id, ct);

        var seen = new HashSet<Guid>();
        var outList = new List<ReviewItemResponse>();
        foreach (var it in items)
        {
            if (!seen.Add(it.QuestionId)) continue;                 // one row per question (engagement.py:199-202)
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

    /// <summary>
    /// POST /review — a teacher adds question(s) to a student's / group's review queue, due now and
    /// tagged "teacher" (engagement.py:218-317). Teacher may only target their OWN questions and their
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
        // Validate the questions belong to this teacher (admin: any) — engagement.py:229-234.
        var qquery = _db.Questions.Where(q => questionIds.Contains(q.Id));
        if (teacher.Role != UserRole.Admin)
            qquery = qquery.Where(q => q.TeacherId == teacher.Id);
        var questions = await qquery.ToDictionaryAsync(q => q.Id, ct);
        if (questions.Count == 0)
            return EngagementResult<IReadOnlyList<ReviewItemResponse>>.NotFound();  // engagement.py:233-234

        var targetIds = await ResolveTargetsAsync(payload.StudentIds, payload.GroupId, ct);
        var validIds = await RosterStudentIds(teacher, targetIds, ct);              // engagement.py:250-258 roster filter
        if (validIds.Count == 0)
            return EngagementResult<IReadOnlyList<ReviewItemResponse>>.BadRequest("No target students");

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
            if (made > 0)                                           // only ping when something was added
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

    // ─── Notifications (notifications.py:15-87) ───────────────────────────────

    /// <summary>GET /notifications — the current user's notifications, newest first, capped at
    /// <paramref name="limit"/> (notifications.py:15-26). <paramref name="unreadOnly"/> filters to
    /// unread. Any active user; null ⇒ 401.</summary>
    public async Task<IReadOnlyList<NotificationResponse>?> ListNotificationsAsync(
        Guid userId, bool unreadOnly, int limit, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return null;

        var capped = Math.Clamp(limit, 1, 100);                     // Python Query(ge=1, le=100)
        var q = _db.Notifications.Where(n => n.UserId == user.Id);
        if (unreadOnly) q = q.Where(n => !n.IsRead);
        var items = await q
            .OrderByDescending(n => n.CreatedAt)
            .Take(capped)
            .ToListAsync(ct);
        return items.Select(ToResponse).ToList();
    }

    /// <summary>GET /notifications/unread-count (notifications.py:29-39). Any active user; null ⇒ 401.</summary>
    public async Task<int?> UnreadCountAsync(Guid userId, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return null;
        return await _db.Notifications.CountAsync(n => n.UserId == user.Id && !n.IsRead, ct);
    }

    /// <summary>POST /notifications/read-all — mark all the user's notifications read
    /// (notifications.py:42-52). Returns false ⇒ 401 (no active user).</summary>
    public async Task<bool> MarkAllReadAsync(Guid userId, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return false;
        await _db.Notifications
            .Where(n => n.UserId == user.Id && !n.IsRead)
            .ExecuteUpdateAsync(s => s.SetProperty(n => n.IsRead, true), ct);
        return true;
    }

    /// <summary>POST /notifications/{id}/read — mark one notification read (notifications.py:55-65).
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

    /// <summary>DELETE /notifications/{id} — delete one notification (notifications.py:68-78).
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

    /// <summary>DELETE /notifications — clear all the user's notifications (notifications.py:81-87).
    /// Returns false ⇒ 401.</summary>
    public async Task<bool> ClearAllAsync(Guid userId, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return false;
        await _db.Notifications.Where(n => n.UserId == user.Id).ExecuteDeleteAsync(ct);
        return true;
    }

    /// <summary>Create an in-app notification (services/notifications.py:11-31). Adds to the change
    /// tracker only — the caller owns the commit (Python <c>commit=False</c>).</summary>
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

    // Targets = explicit ids ∪ a whole group's members (engagement.py:236-243).
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

    // engagement.py:250-258 — keep only targets that are students AND (unless admin) on the acting
    // teacher's roster (a member of some group this teacher owns).
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
