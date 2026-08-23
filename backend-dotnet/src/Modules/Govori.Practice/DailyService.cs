using Govori.Catalog;
using Govori.Contracts;
using Govori.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace Govori.Practice;

/// <summary>
/// F3 · «Kunlik 5 daqiqa» (docs/01 F3, docs/04 §4.5, docs/08 Faza 6.3) — the daily session
/// assembler.
///
/// <para><b>It is an aggregator, not a feature.</b> Nothing here is new content and nothing here is
/// a new place to practise: the warm-up comes out of <c>shadowing_phrases</c>, the speaking step is
/// the student's existing <c>next_task_id</c> answered on the existing submit route (and therefore
/// under its existing <c>submit_audio</c> rate limit), and the correction step is one card of the
/// xato-replay drill that already exists. F3's whole contribution is that a student who opens the
/// app is not asked to CHOOSE — the session is already picked.</para>
///
/// <para><b>Why it lives in Practice and not in a module of its own.</b> The session needs the
/// "which task is open for this student" answer, and that answer is Catalog's frozen, positional,
/// freemium-aware <c>GetStudentModulesAsync</c>. Practice→Catalog is the single sanctioned
/// cross-domain edge (ArchTests rule 4 allow-list), so hosting the assembler here lets it REUSE
/// that logic rather than reimplement the sequential-lock + premium-position rules and drift from
/// them. The SRS half is read straight off <c>review_items</c> through the shared DbContext — the
/// same move <c>EngagementService</c> makes when it reads <c>app_settings</c> without referencing
/// the Administration module.</para>
///
/// <para><b>No new table (docs/08 §6.3: "yangi jadval yo'q").</b> Today's progress is DERIVED from
/// rows the student's own actions already wrote — a <c>submissions</c> row for the speaking step, an
/// answered <c>review_items</c> row for the drill. The warm-up leaves no trace and is deliberately
/// not given one: a table whose entire job is to remember "read three sentences aloud" would be a
/// migration, a backup line and a cleanup job bought for a fact nobody will ever query.</para>
///
/// <para><b>Stability is the product requirement, not a nicety.</b> Asking twice on the same day
/// must return the same session. A refresh that reshuffled the exercises would turn the one screen
/// whose job is to remove choice into a slot machine, and the habit F3 exists to build dies with
/// it. Each step is therefore chosen by something that cannot move within a day: the warm-up by a
/// deterministic seed over (student, local day), the speaking step by <c>next_task_id</c> — which
/// only advances when the student finishes it, and is then pinned by the submission they just made
/// — and the drill by the queue's earliest-due card.</para>
/// </summary>
public sealed class DailyService
{
    private readonly GovoriDbContext _db;
    private readonly CatalogService _catalog;
    private readonly IConfiguration _config;

    public DailyService(GovoriDbContext db, CatalogService catalog, IConfiguration config)
    {
        _db = db;
        _catalog = catalog;
        _config = config;
    }

    /// <summary>The flag this whole surface hangs off. Faza 6 features ship dark and are switched
    /// on separately (docs/08 "deploy ≠ release"), so it defaults to <b>off</b>: the route 404s
    /// until an admin stores a truthy value (or <c>DAILY_FIVE_ENABLED</c> is set).</summary>
    public const string EnabledKey = "daily_five_enabled";

    /// <summary>The drill step also needs the drill itself to exist. Without this check the session
    /// would hand a student a step whose destination answers 404 — a dead end built on purpose,
    /// which is worse than the step simply not being there.</summary>
    public const string DrillFlagKey = "review_drill_enabled";

    /// <summary>Phrases in the warm-up. Three is the number docs/04 §4.5 promises and about thirty
    /// seconds of speaking; a fourth buys nothing and pushes the session past the five minutes its
    /// name commits to.</summary>
    public const int WarmupPhraseCount = 3;

    // The advertised length of each step, in seconds. They sum to five minutes, which is the whole
    // promise in the feature's name — the client shows them so "5 daqiqa" is a number the student
    // can verify rather than a slogan.
    private const int WarmupSeconds = 30;
    private const int TaskSeconds = 180;
    private const int DrillSeconds = 90;

    /// <summary>Largest timezone offset accepted, in minutes (UTC−14 … UTC+14 covers every real
    /// zone including the Line Islands). A client that sends nonsense is clamped rather than
    /// refused: the offset only decides which day's session someone sees, so the safe failure is
    /// "you got the server's day", not an error screen.</summary>
    private const int MaxOffsetMinutes = 14 * 60;

    // The truthy spellings app_settings uses for boolean-ish keys, identical to every other
    // module's set — two toggles in one table that disagree about what "on" spells is a bug waiting
    // to be filed against whichever one the admin typed "yes" into.
    private static readonly HashSet<string> TrueWords =
        new(StringComparer.OrdinalIgnoreCase) { "true", "1", "yes", "on" };

    /// <summary>
    /// Whether F3 is switched on. Same resolution order as every other setting — an
    /// <c>app_settings</c> override over the <c>DAILY_FIVE_ENABLED</c> environment default, over
    /// <c>false</c>. A stored NULL or <c>""</c> is not an override: clearing the row really does
    /// revert the flag.
    /// </summary>
    public async Task<bool> EnabledAsync(CancellationToken ct = default)
        => Flag(await FlagsAsync(ct), EnabledKey);

    /// <summary>
    /// <c>GET /api/daily</c> — today's session, or <c>null</c> when the flag is off or the caller is
    /// not an active user (the endpoint turns those into 404 and 401 respectively).
    /// </summary>
    /// <param name="userId">The caller, from the access token's <c>sub</c>.</param>
    /// <param name="tzOffsetMinutes">Minutes to ADD to UTC to get the student's local time (Tashkent
    /// = +300). Null ⇒ UTC. Clamped to ±14 h. The client sends
    /// <c>-new Date().getTimezoneOffset()</c>, which is the same convention with JavaScript's sign
    /// flipped once, at the edge, where it is visible.</param>
    /// <param name="ct">Cancellation.</param>
    public async Task<DailySessionResponse?> SessionAsync(
        Guid userId, int? tzOffsetMinutes, CancellationToken ct = default)
    {
        var flags = await FlagsAsync(ct);
        if (!Flag(flags, EnabledKey)) return null;

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null || !user.IsActive) return null;

        var offset = TimeSpan.FromMinutes(Math.Clamp(tzOffsetMinutes ?? 0, -MaxOffsetMinutes, MaxOffsetMinutes));
        var localDay = DateOnly.FromDateTime(DateTime.UtcNow + offset);
        // The student's day expressed back in UTC, which is what every timestamp column stores.
        // The Kind is set EXPLICITLY: DateOnly.ToDateTime yields Unspecified, and Npgsql refuses to
        // write an Unspecified DateTime to a `timestamptz` column — so without this every query
        // below throws at the driver, and the route 500s for a purely arithmetic reason.
        var dayStartUtc = DateTime.SpecifyKind(
            localDay.ToDateTime(TimeOnly.MinValue) - offset, DateTimeKind.Utc);
        var dayEndUtc = dayStartUtc.AddDays(1);

        var steps = new List<DailyStepResponse>(3);

        var warmup = await WarmupStepAsync(userId, localDay, ct);
        if (warmup is not null) steps.Add(warmup);

        var task = await TaskStepAsync(userId, dayStartUtc, dayEndUtc, ct);
        if (task is not null) steps.Add(task);

        var drill = Flag(flags, DrillFlagKey)
            ? await DrillStepAsync(userId, dayStartUtc, dayEndUtc, ct)
            : null;
        if (drill is not null) steps.Add(drill);

        // "Completed" counts only the steps the server can actually observe. The warm-up is excluded
        // on both sides of that sentence — it never reports done, so letting it vote would pin the
        // session permanently open; a session that is nothing BUT a warm-up is likewise never
        // "completed", because nothing was asked that could be checked.
        var observable = steps.Where(s => s.Kind != DailyStepKind.Warmup).ToList();
        var completed = observable.Count > 0 && observable.All(s => s.Done);

        return new DailySessionResponse(
            Day: localDay.ToString("yyyy-MM-dd"),
            Streak: user.CurrentStreak,
            Completed: completed,
            Steps: steps);
    }

    // ─── Step 1 · Isinish (warm-up) ───────────────────────────────────────────

    // Three active shadowing phrases, chosen deterministically for (student, day). Reading them
    // aloud is the whole step: nothing is recorded, uploaded or graded, so the warm-up costs no
    // vendor call and none of a free student's three attempts. That is also why it has no `done` —
    // there is nothing for the server to observe, and the client remembers it locally instead.
    //
    // The selection deliberately ignores the student's CEFR level even though the rows carry one.
    // Level can change mid-day (a graded attempt moves it), and a session that reshuffles itself
    // because the student did well is exactly the instability this feature must not have.
    private async Task<DailyStepResponse?> WarmupStepAsync(Guid userId, DateOnly localDay, CancellationToken ct)
    {
        var phrases = await _db.ShadowingPhrases
            .AsNoTracking()
            .Where(p => p.IsActive)
            .Select(p => new { p.Id, p.Text, p.Level })
            .ToListAsync(ct);
        if (phrases.Count == 0) return null;             // no content ⇒ no step, never an empty one

        var seed = $"{userId:N}:{localDay:yyyy-MM-dd}";
        var picked = phrases
            .OrderBy(p => StableHash(seed, p.Id))
            .ThenBy(p => p.Id)                           // total order, so equal hashes still settle
            .Take(WarmupPhraseCount)
            .Select(p => new DailyPhraseResponse(p.Id, p.Text, p.Level))
            .ToList();

        return new DailyStepResponse(
            Kind: DailyStepKind.Warmup,
            Done: false,
            EstSeconds: WarmupSeconds,
            Phrases: picked,
            TaskId: null, TaskTitle: null, ModuleName: null, Level: null, DueCount: null);
    }

    // ─── Step 2 · Gapirish (one task) ─────────────────────────────────────────

    // The day's speaking step, and the one place stability needs actual care.
    //
    // Before the student answers, it is Catalog's `next_task_id` — the first task that is neither
    // done, nor sequentially locked, nor premium-locked. That is already stable: it moves only when
    // the student finishes it.
    //
    // The moment they DO finish it, `next_task_id` advances to the following task — and a naive
    // read would swap today's card for a different exercise the instant it was completed, which is
    // the reshuffle this feature must never do. So once the student has spoken today, the day's task
    // is pinned to their FIRST attempt of the day and reported done. It is the same question either
    // side of the answer, and a refresh cannot change it.
    private async Task<DailyStepResponse?> TaskStepAsync(
        Guid userId, DateTime dayStartUtc, DateTime dayEndUtc, CancellationToken ct)
    {
        var spokenToday = await _db.Submissions
            .AsNoTracking()
            .Where(s => s.StudentId == userId
                        && s.QuestionId != null
                        && s.CreatedAt >= dayStartUtc && s.CreatedAt < dayEndUtc)
            .OrderBy(s => s.CreatedAt)
            .Select(s => s.QuestionId!.Value)
            .FirstOrDefaultAsync(ct);

        if (spokenToday != Guid.Empty)
            return await TaskStepForAsync(spokenToday, done: true, ct);

        // Nothing spoken yet today — the Catalog decides what is open. Its module list is already
        // ordered (teacher modules first, then official ones by position), so the first module with
        // an actionable task is the one the student is actually working through.
        var modules = await _catalog.GetStudentModulesAsync(userId, ct);
        var next = modules?.FirstOrDefault(m => m.NextTaskId is not null);
        if (next?.NextTaskId is null) return null;       // everything done or locked ⇒ no step

        var nextTask = next.Tasks.FirstOrDefault(t => t.Id == next.NextTaskId.Value);
        return new DailyStepResponse(
            Kind: DailyStepKind.Task,
            Done: false,
            EstSeconds: TaskSeconds,
            Phrases: [],
            TaskId: next.NextTaskId.Value,
            TaskTitle: nextTask?.Title,
            ModuleName: next.Name,
            Level: nextTask?.Level ?? next.Level,
            DueCount: null);
    }

    // The pinned "already spoken today" case: the question is named from the questions table
    // directly, because the student may have answered the LAST task of a module and so no longer
    // appears in any module's `next_task_id`.
    private async Task<DailyStepResponse?> TaskStepForAsync(Guid questionId, bool done, CancellationToken ct)
    {
        var row = await _db.Questions
            .AsNoTracking()
            .Where(q => q.Id == questionId)
            .Select(q => new { q.Title, q.Level, ModuleName = q.Block != null ? q.Block.Name : null })
            .FirstOrDefaultAsync(ct);
        if (row is null) return null;                    // question deleted out from under the day

        return new DailyStepResponse(
            Kind: DailyStepKind.Task,
            Done: done,
            EstSeconds: TaskSeconds,
            Phrases: [],
            TaskId: questionId,
            TaskTitle: row.Title,
            ModuleName: row.ModuleName,
            Level: row.Level,
            DueCount: null);
    }

    // ─── Step 3 · Tuzatish (one drill card) ───────────────────────────────────

    // Present only when there is something to correct — either cards are due now, or the student has
    // already answered one today. An empty SRS queue means the step is ABSENT, not a step reporting
    // "0 ta element": a student who has made no mistakes worth replaying should see a two-step
    // session, not a screen congratulating itself.
    //
    // `done` keys off an answered review rather than an emptied queue, so a student with forty
    // overdue cards still gets credit for the one the session asked for.
    private async Task<DailyStepResponse?> DrillStepAsync(
        Guid userId, DateTime dayStartUtc, DateTime dayEndUtc, CancellationToken ct)
    {
        // `UpdatedAt > CreatedAt` is what tells an ANSWERED review apart from a freshly enqueued
        // one. Only AnswerReviewAsync moves UpdatedAt; the grader's re-scheduling completes prior
        // items without touching it, so grading a task during the session cannot fake a drill.
        var answeredToday = await _db.ReviewItems
            .AsNoTracking()
            .AnyAsync(r => r.StudentId == userId
                           && r.UpdatedAt > r.CreatedAt
                           && r.UpdatedAt >= dayStartUtc && r.UpdatedAt < dayEndUtc, ct);

        // Same due rule as the drill's own queue (open, due, question still alive), deduplicated by
        // question so one shaky question cannot fill the session on its own.
        var now = DateTime.UtcNow;
        var dueCount = await _db.ReviewItems
            .AsNoTracking()
            .Where(r => r.StudentId == userId && !r.Completed && r.DueAt <= now)
            .Where(r => _db.Questions.Any(q => q.Id == r.QuestionId && !q.IsDeleted))
            .Select(r => r.QuestionId)
            .Distinct()
            .CountAsync(ct);

        if (dueCount == 0 && !answeredToday) return null;

        return new DailyStepResponse(
            Kind: DailyStepKind.Drill,
            Done: answeredToday,
            EstSeconds: DrillSeconds,
            Phrases: [],
            TaskId: null, TaskTitle: null, ModuleName: null, Level: null,
            DueCount: dueCount);
    }

    // ─── Settings + helpers ───────────────────────────────────────────────────

    // Both flags in one indexed read. Administration owns AppSettingsService, and a module→module
    // reference is exactly what the §7.2 boundary guardrail forbids, so the table is read directly —
    // the same trade EngagementService makes for `review_drill_enabled`.
    private async Task<Dictionary<string, string?>> FlagsAsync(CancellationToken ct)
        => await _db.AppSettings
            .AsNoTracking()
            .Where(s => s.Key == EnabledKey || s.Key == DrillFlagKey)
            .ToDictionaryAsync(s => s.Key, s => s.Value, ct);

    private bool Flag(IReadOnlyDictionary<string, string?> overrides, string key)
    {
        var raw = overrides.TryGetValue(key, out var stored) && !string.IsNullOrWhiteSpace(stored)
            ? stored!.Trim()
            : (_config[key.ToUpperInvariant()] ?? string.Empty).Trim();
        return raw.Length > 0 && TrueWords.Contains(raw);
    }

    /// <summary>
    /// A 64-bit FNV-1a over the seed and the row id — a STABLE shuffle key.
    ///
    /// <para><c>string.GetHashCode</c> would have been the obvious choice and is the wrong one:
    /// .NET randomises it per process, so the API and the worker — and the same API after a restart
    /// — would each pick a different warm-up for the same student on the same day. The bug would
    /// look like "the session sometimes changes on refresh", which is the exact failure this
    /// feature is defined against.</para>
    /// </summary>
    internal static ulong StableHash(string seed, Guid id)
    {
        const ulong offsetBasis = 14695981039346656037UL;
        const ulong prime = 1099511628211UL;

        var hash = offsetBasis;
        foreach (var ch in seed)
        {
            hash ^= ch;
            hash *= prime;
        }
        Span<byte> bytes = stackalloc byte[16];
        id.TryWriteBytes(bytes);
        foreach (var b in bytes)
        {
            hash ^= b;
            hash *= prime;
        }
        return hash;
    }
}
