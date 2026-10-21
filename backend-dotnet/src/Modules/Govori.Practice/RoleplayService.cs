using System.Runtime.CompilerServices;
using System.Text.Json;
using Govori.Contracts;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Govori.Platform.Grader;
using Govori.Platform.Stt;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

// The product-day boundaries in this assembly are pinned by the integration tests: the roleplay
// budget's (RoleplayService.SpentTodayAsync with an explicit clock — "resets at 19:00Z, not 00:00Z"
// can only be shown with a clock the test controls) and /api/daily's default offset
// (DailyService.SessionOffset). Internal stays internal; this only widens visibility to that sibling
// test assembly.
[assembly: InternalsVisibleTo("Govori.IntegrationTests")]

namespace Govori.Practice;

/// <summary>HTTP-shaped outcome of a roleplay call. Everything a student can legitimately run into —
/// the flag being off, no AI key, a spent budget, a closed conversation — is NOT here: those are
/// <see cref="RoleplayState"/> values on a 200 body. This enum only carries the answers that really
/// are errors, including <c>Unauthorized</c> for a missing or DEACTIVATED account (see
/// <c>RoleplayService.IsActiveAsync</c>).</summary>
public enum RoleplayStatus { Ok, NotFound, BadRequest, Unauthorized }

/// <summary>The three numbers and one boolean that decide whether a turn may run at all.</summary>
/// <param name="Enabled">The <c>roleplay_enabled</c> flag.</param>
/// <param name="MaxTurns">Hard turn ceiling for one conversation.</param>
/// <param name="DailyTurns">Hard per-student ceiling for one product day (local midnight in
/// Tashkent, <see cref="ProductDay"/>).</param>
public sealed record RoleplayLimits(bool Enabled, int MaxTurns, int DailyTurns);

/// <summary>
/// F1 · Roleplay / AI Suhbat (docs/08 Faza 6.5) — the conversation engine behind the Suhbat screen.
///
/// <para>One turn is: the student's audio → <see cref="ISttProvider"/> → a faithful transcript →
/// <see cref="IGraderProvider"/> judging that transcript against the beat the partner is on → the
/// partner either moves on or asks again → one <c>roleplay_turns</c> row. The seams are the same
/// two the Assessment pipeline uses, so a key pasted into the admin panel lights up grading and
/// conversation together, and a vendor outage degrades both the same way.</para>
///
/// <para><b>Cost containment is part of the feature.</b> docs/08 lists "Roleplay AI xarajati
/// portlaydi" as a live risk against a free tier, with three named mitigations, and all three are
/// enforced here rather than left to a follow-up:</para>
/// <list type="number">
///   <item><b>Turn limit per conversation</b> (<c>roleplay_max_turns</c>) — the conversation closes
///   itself. Without it one open tab is an open tab on someone's invoice.</item>
///   <item><b>Per-student daily budget</b> (<c>roleplay_daily_turns</c>) — counted from the rows
///   themselves, so it survives a restart, cannot be reset by starting a new conversation, and is
///   the same number whichever host served the request.</item>
///   <item><b>A bounded prompt.</b> Each grader call carries ONE beat and ONE utterance, truncated
///   to <see cref="MaxTranscriptChars"/> — never the growing transcript. Turn 8 therefore costs what
///   turn 1 cost, instead of the quadratic bill a chat history produces. The wrap-up adds no call at
///   all: it averages grades already paid for.</item>
/// </list>
///
/// <para><b>The transcript stays faithful.</b> <c>student_text</c> is written exactly as STT heard
/// it and is never repaired, never replaced by the grader's corrected form, and never fed forward as
/// a "cleaned up" version — the next turn's prompt does not carry it at all. Corrections travel
/// beside the transcript, plainly marked, because a learner shown a quietly fixed copy of their own
/// sentence concludes they said it right.</para>
///
/// <para><b>Defer, don't fail.</b> With no configured STT/grader backend this returns
/// <see cref="RoleplayState.Unconfigured"/> and writes nothing — mirroring
/// <c>AssessmentService</c>'s deferral, for the same reason: a missing key is an operator's problem
/// and must not cost the student a turn, a budget slot, or a stack trace.</para>
/// </summary>
public sealed class RoleplayService
{
    private readonly GovoriDbContext _db;
    private readonly ISttProvider _stt;
    private readonly IGraderProvider _grader;
    private readonly IConfiguration _config;
    private readonly ILogger<RoleplayService> _logger;

    /// <summary>The flag this whole feature hangs off (docs/08 Faza 6: "flag ortida", and cutover
    /// does not wait for it). Resolved like every other setting — an <c>app_settings</c> override
    /// over the <c>ROLEPLAY_ENABLED</c> environment default.
    ///
    /// <para>It defaults to OFF, unlike <c>orthoepy_enabled</c>, which defaults on. Orthoepy makes an
    /// existing score slightly better; this makes vendor calls nobody has budgeted for yet. A new
    /// spend defaults to off and is turned on deliberately.</para></summary>
    public const string EnabledKey = "roleplay_enabled";

    /// <summary>Turn ceiling per conversation. Eight is about five minutes of speaking — long enough
    /// to finish any of the seeded scenarios twice over, short enough that a forgotten tab cannot
    /// run up a bill.</summary>
    public const string MaxTurnsKey = "roleplay_max_turns";

    /// <summary>Per-student turns per product day (<see cref="ProductDay"/>: resets at local midnight
    /// in Tashkent, not at UTC midnight). Twenty-four is three full conversations — generous
    /// for practice, bounded for the invoice.</summary>
    public const string DailyTurnsKey = "roleplay_daily_turns";

    private const bool DefaultEnabled = false;
    private const int DefaultMaxTurns = 8;
    private const int DefaultDailyTurns = 24;

    /// <summary>How much of one utterance reaches the grader. A 30-second turn is ~500 characters;
    /// this leaves room for a talkative student while capping what a stuck microphone — or a pasted
    /// wall of text from a future typed mode — could send.</summary>
    private const int MaxTranscriptChars = 800;

    /// <summary>Largest recording accepted for one turn. A turn is a sentence or two; anything past
    /// this is a bug or an upload probe, and both should be refused before they reach a vendor.</summary>
    private const int MaxAudioBytes = 8 * 1024 * 1024;

    /// <summary>
    /// Relevance at or above which the partner MOVES ON. Set low on purpose: this is a beginner
    /// speaking a foreign language into a phone, and the question being asked is "did they attempt
    /// what was asked", not "was it good". A high bar would strand an A1 student on beat one
    /// repeating themselves, which is the single fastest way to make someone quit — and the score
    /// they earned is still recorded and still shows up in the summary.
    /// </summary>
    private const double AdvanceRelevance = 45.0;

    private static readonly JsonSerializerOptions JsonbOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    private static readonly HashSet<string> TrueWords =
        new(StringComparer.OrdinalIgnoreCase) { "true", "1", "yes", "on" };

    public RoleplayService(
        GovoriDbContext db,
        ISttProvider stt,
        IGraderProvider grader,
        IConfiguration config,
        ILogger<RoleplayService> logger)
    {
        _db = db;
        _stt = stt;
        _grader = grader;
        _config = config;
        _logger = logger;
    }

    // ─── Catalogue ──────────────────────────────────────────────────────────

    /// <summary>The scenario grid plus the state the hub needs to tell the truth on the tile the
    /// student is about to tap, rather than after they have recorded themselves.</summary>
    public async Task<(RoleplayStatus Status, RoleplayCatalogResponse? Body)> CatalogAsync(
        Guid userId, CancellationToken ct = default)
    {
        if (!await IsActiveAsync(userId, ct))
            return (RoleplayStatus.Unauthorized, null);

        var limits = await LimitsAsync(ct);
        if (!limits.Enabled)
            return (RoleplayStatus.Ok, new RoleplayCatalogResponse(
                RoleplayState.Disabled, Array.Empty<RoleplayScenarioResponse>(), limits.MaxTurns, 0));

        await EnsureSeededAsync(ct);

        var scenarios = await _db.Scenarios
            .AsNoTracking()
            .Where(s => s.IsActive && s.Slug != RoleplayScenarioSeed.FreeSlug)
            .OrderBy(s => s.SortOrder).ThenBy(s => s.Slug)
            .ToListAsync(ct);

        var left = limits.DailyTurns - await SpentTodayAsync(userId, ct);
        var state = !await ProvidersReadyAsync(ct) ? RoleplayState.Unconfigured
            : left <= 0 ? RoleplayState.BudgetSpent
            : RoleplayState.Ready;

        return (RoleplayStatus.Ok, new RoleplayCatalogResponse(
            state, scenarios.Select(Tile).ToList(), limits.MaxTurns, Math.Max(0, left)));
    }

    // ─── Start ──────────────────────────────────────────────────────────────

    /// <summary>
    /// Open a conversation: one row at turn 0 carrying the partner's opening line, so the exchange
    /// the student is about to have is already on disk before they speak.
    ///
    /// <para>Opening a conversation costs no AI call and no budget slot — browsing the scenarios is
    /// free, and only speaking is billed.</para>
    /// </summary>
    public async Task<(RoleplayStatus Status, RoleplayStartResponse? Body)> StartAsync(
        Guid userId, string? slug, CancellationToken ct = default)
    {
        if (!await IsActiveAsync(userId, ct))
            return (RoleplayStatus.Unauthorized, null);
        if (string.IsNullOrWhiteSpace(slug))
            return (RoleplayStatus.BadRequest, null);

        var limits = await LimitsAsync(ct);
        if (!limits.Enabled)
            return (RoleplayStatus.Ok, Blocked(RoleplayState.Disabled, 0));

        await EnsureSeededAsync(ct);

        var scenario = await _db.Scenarios
            .AsNoTracking()
            .FirstOrDefaultAsync(s => s.Slug == slug && s.IsActive, ct);
        if (scenario is null)
            return (RoleplayStatus.NotFound, null);

        var left = limits.DailyTurns - await SpentTodayAsync(userId, ct);

        // Both guards run BEFORE anything is written. A student who arrives with no key wired, or
        // with the day already spent, leaves no row behind — nothing to clean up, and nothing that
        // looks in the data like a conversation that happened.
        if (!await ProvidersReadyAsync(ct))
            return (RoleplayStatus.Ok, Blocked(RoleplayState.Unconfigured, Math.Max(0, left)));
        if (left <= 0)
            return (RoleplayStatus.Ok, Blocked(RoleplayState.BudgetSpent, 0));

        var now = DateTime.UtcNow;
        var conversationId = Guid.NewGuid();
        _db.RoleplayTurns.Add(new RoleplayTurn
        {
            Id = Guid.NewGuid(),
            ConversationId = conversationId,
            StudentId = userId,
            ScenarioId = scenario.Id,
            TurnIndex = 0,
            BeatIndex = 0,
            StudentText = null,                       // the partner spoke first
            PartnerText = scenario.OpeningRu,
            IsFinal = false,
            CreatedAt = now,
            UpdatedAt = now,
        });
        await _db.SaveChangesAsync(ct);

        return (RoleplayStatus.Ok, new RoleplayStartResponse(
            RoleplayState.Ready, conversationId, Tile(scenario), scenario.OpeningRu,
            limits.MaxTurns, Math.Max(0, left)));
    }

    // ─── One spoken turn ────────────────────────────────────────────────────

    /// <summary>
    /// The student speaks once: transcribe, judge, reply, persist.
    ///
    /// <para>The order matters. Every ceiling is checked before the audio is read, so a refused turn
    /// costs neither a vendor call nor a database row. After STT succeeds the turn is committed no
    /// matter what the grader does — a vendor outage costs the coaching for that turn, never the
    /// turn itself, and never the transcript the student just produced.</para>
    /// </summary>
    public async Task<(RoleplayStatus Status, RoleplayTurnResponse? Body)> TurnAsync(
        Guid userId, Guid conversationId, Stream audio, string filename, double? clientDurationSec,
        CancellationToken ct = default)
    {
        // First, before a ceiling is read or a byte of audio reaches a vendor: this is the route that
        // spends money, and a suspended account must stop spending the moment it is suspended, not
        // when its access token happens to expire.
        if (!await IsActiveAsync(userId, ct))
            return (RoleplayStatus.Unauthorized, null);

        var limits = await LimitsAsync(ct);
        var turns = await ConversationAsync(userId, conversationId, ct);
        if (turns.Count == 0)
            return (RoleplayStatus.NotFound, null);

        var last = turns[^1];
        var spoken = turns.Count(t => t.StudentText is not null);
        var left = limits.DailyTurns - await SpentTodayAsync(userId, ct);

        if (!limits.Enabled)
            return (RoleplayStatus.Ok, Blocked(conversationId, RoleplayState.Disabled, spoken, limits, 0));
        if (last.IsFinal)
            return (RoleplayStatus.Ok, Blocked(conversationId, RoleplayState.Finished, spoken, limits, Math.Max(0, left)));
        if (!await ProvidersReadyAsync(ct))
            return (RoleplayStatus.Ok, Blocked(conversationId, RoleplayState.Unconfigured, spoken, limits, Math.Max(0, left)));
        if (left <= 0)
            return (RoleplayStatus.Ok, Blocked(conversationId, RoleplayState.BudgetSpent, spoken, limits, 0));
        if (spoken >= limits.MaxTurns)
        {
            await CloseAsync(last, ct);
            return (RoleplayStatus.Ok, Blocked(conversationId, RoleplayState.Finished, spoken, limits, Math.Max(0, left)));
        }

        var bytes = await ReadCappedAsync(audio, ct);
        if (bytes is null || bytes.Length == 0)
            return (RoleplayStatus.BadRequest, null);

        var scenario = await _db.Scenarios.AsNoTracking().FirstAsync(s => s.Id == last.ScenarioId, ct);
        var beats = RoleplayScenarioSeed.ReadBeats(scenario.Beats);
        var beatIndex = Math.Clamp(last.BeatIndex, 0, Math.Max(0, beats.Count - 1));
        var beat = beats.Count > 0 ? beats[beatIndex] : null;

        var stt = await _stt.TranscribeAsync(bytes, filename, referenceText: null, ct);
        var studentText = stt.Text ?? string.Empty;    // verbatim — never repaired, here or later

        // A silent recording is a real answer to record, but there is nothing in it for a model to
        // judge; skipping the grader here is both honest and one call cheaper.
        double? relevance = null;
        double? overall = null;
        string? llmModel = null;
        IReadOnlyList<GraderCorrection> corrections = Array.Empty<GraderCorrection>();

        if (!string.IsNullOrWhiteSpace(studentText) && beat is not null)
        {
            try
            {
                // The correction explanations come back to this student in this response, so they
                // are written in the language their app is set to (unknown → Uzbek). Inside the
                // try: a failed lookup must cost the coaching, never the turn.
                var feedbackLanguage = FeedbackLanguage.Normalize(await _db.Users
                    .AsNoTracking()
                    .Where(u => u.Id == userId)
                    .Select(u => u.PreferredLanguage)
                    .FirstOrDefaultAsync(ct));

                var grade = await _grader.AnalyzeAsync(new GraderRequest
                {
                    FeedbackLanguage = feedbackLanguage,
                    QuestionPrompt = last.PartnerText,          // what the student was answering
                    Instruction = beat.GoalRu,                  // what this turn had to achieve
                    TranscriptText = Truncate(studentText),
                    QuestionTitle = scenario.TitleRu,
                    Topic = scenario.PersonaRu,
                    Level = scenario.Level,
                }, ct);

                relevance = grade.Scores.Relevance;
                overall = grade.Scores.Overall;
                corrections = grade.Corrections;
                llmModel = grade.Model;                         // what really ran (docs/07 §7.9)
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;                                          // the student left; nothing to persist
            }
            catch (Exception ex)
            {
                // The student spoke and STT heard them. Losing that to a vendor's bad minute would be
                // the worst possible trade, so the conversation continues uncoached.
                _logger.LogWarning(
                    ex, "roleplay grading failed (conversation {ConversationId}, turn {Turn}) — continuing uncoached",
                    conversationId, last.TurnIndex + 1);
            }
        }

        var delivered = relevance is not null && relevance.Value >= AdvanceRelevance;
        var nextBeat = delivered ? beatIndex + 1 : beatIndex;
        var partnerText = beat is null
            ? scenario.OpeningRu
            : delivered ? beat.LineRu : beat.NudgeRu;

        var turnIndex = last.TurnIndex + 1;
        var spokenAfter = spoken + 1;
        // Closed either because the beats ran out — the scenario reached its end — or because the
        // ceiling did. Both are the conversation finishing, not failing.
        var finished = nextBeat >= beats.Count || spokenAfter >= limits.MaxTurns;

        var now = DateTime.UtcNow;
        _db.RoleplayTurns.Add(new RoleplayTurn
        {
            Id = Guid.NewGuid(),
            ConversationId = conversationId,
            StudentId = userId,
            ScenarioId = scenario.Id,
            TurnIndex = turnIndex,
            BeatIndex = nextBeat,
            StudentText = studentText,
            PartnerText = partnerText,
            Relevance = relevance,
            Overall = overall,
            Corrections = corrections.Count > 0 ? JsonSerializer.Serialize(corrections, JsonbOptions) : null,
            SttModel = Fit(stt.Model, 64),
            LlmModel = Fit(llmModel, 64),
            AudioDurationSec = stt.DurationSec ?? clientDurationSec,
            IsFinal = finished,
            CreatedAt = now,
            UpdatedAt = now,
        });
        await _db.SaveChangesAsync(ct);

        return (RoleplayStatus.Ok, new RoleplayTurnResponse(
            RoleplayState.Ready,
            conversationId,
            turnIndex,
            studentText,
            partnerText,
            corrections.Select(c => new RoleplayCorrection(c.Original, c.Corrected, c.Type, c.Explanation)).ToList(),
            Retried: !delivered,
            TurnsLeft: Math.Max(0, limits.MaxTurns - spokenAfter),
            DailyTurnsLeft: Math.Max(0, left - 1),
            Finished: finished));
    }

    // ─── Wrap-up ────────────────────────────────────────────────────────────

    /// <summary>
    /// Close the conversation and read the summary off the turns already on disk — no extra model
    /// call, by design (see the contract note on <see cref="RoleplaySummaryResponse"/>).
    ///
    /// <para>Idempotent: ending an already-ended conversation returns the same numbers, so a
    /// double-tapped "Tugatish" and a reloaded summary page agree.</para>
    /// </summary>
    public async Task<(RoleplayStatus Status, RoleplaySummaryResponse? Body)> EndAsync(
        Guid userId, Guid conversationId, CancellationToken ct = default)
    {
        if (!await IsActiveAsync(userId, ct))
            return (RoleplayStatus.Unauthorized, null);

        var turns = await ConversationAsync(userId, conversationId, ct);
        if (turns.Count == 0)
            return (RoleplayStatus.NotFound, null);

        var last = turns[^1];
        if (!last.IsFinal)
            await CloseAsync(last, ct);

        var scenario = await _db.Scenarios.AsNoTracking().FirstAsync(s => s.Id == last.ScenarioId, ct);
        var beatCount = RoleplayScenarioSeed.ReadBeats(scenario.Beats).Count;

        var spoken = turns.Where(t => t.StudentText is not null).ToList();
        var graded = spoken.Where(t => t.Overall is not null).Select(t => t.Overall!.Value).ToList();

        // Fluency is the mean of what was actually graded, or null when nothing was — an ungraded
        // run shows no number rather than a zero the student did not earn.
        double? fluency = graded.Count > 0 ? Math.Round(graded.Average(), 0) : null;

        // The goal is reached when the partner got through every beat. Not "spoke enough times":
        // the point of the scenario is the task, and a student who talked for eight turns without
        // ever asking the price did not buy the medicine.
        var goalReached = beatCount > 0 && last.BeatIndex >= beatCount;

        return (RoleplayStatus.Ok, new RoleplaySummaryResponse(
            RoleplayState.Finished,
            conversationId,
            scenario.TitleRu,
            spoken.Count,
            fluency,
            goalReached,
            RoleplayScenarioSeed.ReadPhrases(scenario.Phrases),
            MergeCorrections(spoken)));
    }

    // ─── Limits, flag and budget ────────────────────────────────────────────

    /// <summary>
    /// Resolves the flag and the two ceilings: an <c>app_settings</c> override wins, else the
    /// environment default, else the constant.
    ///
    /// <para>This repeats a few lines of <c>AppSettingsService</c> deliberately. That class lives in
    /// <c>Govori.Administration</c>, and Practice→Administration is a cross-domain edge the
    /// ArchTests refuse (the only sanctioned one is Practice→Catalog). Reading the same
    /// <c>app_settings</c> table through the shared DbContext keeps the MECHANISM identical — same
    /// rows, same admin panel, same precedence — without opening a boundary for three keys.</para>
    ///
    /// <para>One query per call, and no cache: a roleplay turn already costs an STT call and a
    /// grader call, so a settings read is not the expensive part, and an operator who switches the
    /// flag off during an incident should see it take effect on the next turn rather than in half a
    /// minute.</para>
    /// </summary>
    public async Task<RoleplayLimits> LimitsAsync(CancellationToken ct = default)
    {
        var keys = new[] { EnabledKey, MaxTurnsKey, DailyTurnsKey };
        var overrides = await _db.AppSettings
            .AsNoTracking()
            .Where(s => keys.Contains(s.Key))
            .ToDictionaryAsync(s => s.Key, s => s.Value, ct);

        return new RoleplayLimits(
            Enabled: Flag(overrides, EnabledKey, DefaultEnabled),
            MaxTurns: Number(overrides, MaxTurnsKey, DefaultMaxTurns, 1, 20),
            DailyTurns: Number(overrides, DailyTurnsKey, DefaultDailyTurns, 1, 500));
    }

    private string Resolve(IReadOnlyDictionary<string, string?> overrides, string key)
    {
        // An override counts only when it is non-empty, so a cleared row falls through to the env
        // default instead of blanking the setting — the same rule AppSettingsService follows.
        if (overrides.TryGetValue(key, out var stored) && !string.IsNullOrWhiteSpace(stored))
            return stored!.Trim();
        return (_config[key.ToUpperInvariant()] ?? string.Empty).Trim();
    }

    private bool Flag(IReadOnlyDictionary<string, string?> overrides, string key, bool fallback)
    {
        var raw = Resolve(overrides, key);
        return raw.Length == 0 ? fallback : TrueWords.Contains(raw);
    }

    private int Number(IReadOnlyDictionary<string, string?> overrides, string key, int fallback, int min, int max)
    {
        var raw = Resolve(overrides, key);
        // Clamped, not validated: a typo in a settings row must not remove the ceiling it exists to
        // impose. "0" and "999999" both land inside the range that was budgeted for.
        return int.TryParse(raw, out var parsed) ? Math.Clamp(parsed, min, max) : fallback;
    }

    /// <summary>Turns this student has spent today. Counted from the rows rather than held in
    /// memory, so it is the same number after a restart and across both hosts — a budget one process
    /// can forget is not a budget.</summary>
    private Task<int> SpentTodayAsync(Guid userId, CancellationToken ct)
        => SpentTodayAsync(userId, DateTime.UtcNow, ct);

    /// <summary>
    /// Turns spent since the start of the product day containing <paramref name="utcNow"/> — local
    /// midnight in Tashkent (<see cref="ProductDay"/>), i.e. 19:00Z. It used to be UTC midnight, which
    /// is 05:00 in Tashkent: the budget "reset" in the middle of the night and an evening's
    /// conversation at 23:30 and one at 00:30 drew on the same allowance. Uzbekistan-only product, no
    /// stored timezone — see <see cref="ProductDay"/> for why one fixed offset is the rule.
    /// <para>The explicit clock is the test seam (production passes <c>DateTime.UtcNow</c> through
    /// the overload above); it is internal, visible only to the integration tests.</para>
    /// </summary>
    internal Task<int> SpentTodayAsync(Guid userId, DateTime utcNow, CancellationToken ct = default)
    {
        var since = ProductDay.StartOfTodayUtc(utcNow);
        return _db.RoleplayTurns
            .AsNoTracking()
            .CountAsync(t => t.StudentId == userId && t.CreatedAt >= since && t.StudentText != null, ct);
    }

    /// <summary>
    /// Is the caller an existing, ACTIVE account? Read from the database on every call, never from
    /// the token — the same rule every other module applies (§7.5): an access token outlives the
    /// moment an admin suspends an account, and without this check a suspended student kept opening
    /// conversations and spending STT + grader calls until it expired. Missing or inactive is a 401,
    /// exactly as it is on the submit route.
    /// </summary>
    private Task<bool> IsActiveAsync(Guid userId, CancellationToken ct)
        => _db.Users.AnyAsync(u => u.Id == userId && u.IsActive, ct);

    /// <summary>Both seams must be live: a conversation with no ears is not a conversation, and one
    /// with no judgement cannot advance a beat.</summary>
    private async Task<bool> ProvidersReadyAsync(CancellationToken ct)
        => await _stt.IsConfiguredAsync(ct) && await _grader.IsConfiguredAsync(ct);

    // ─── Persistence helpers ────────────────────────────────────────────────

    // A conversation is its rows. Scoped to the caller in the same query as the id, so a guessed
    // conversation id is indistinguishable from a missing one — it never leaks that it exists.
    private Task<List<RoleplayTurn>> ConversationAsync(Guid userId, Guid conversationId, CancellationToken ct)
        => _db.RoleplayTurns
            .Where(t => t.ConversationId == conversationId && t.StudentId == userId)
            .OrderBy(t => t.TurnIndex)
            .ToListAsync(ct);

    private async Task CloseAsync(RoleplayTurn last, CancellationToken ct)
    {
        last.IsFinal = true;
        last.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
    }

    /// <summary>
    /// Plants the authored catalogue the first time it is needed, and ONLY into an empty table.
    ///
    /// <para>The empty check is what makes this safe to call on every request: it is a first-run
    /// import, not a reconciliation. An operator who rewrites a Russian line, or retires a scenario,
    /// keeps that change — a seed that re-asserted itself would silently revert their work on the
    /// next deploy, and they would have no way to tell that it had.</para>
    /// </summary>
    private async Task EnsureSeededAsync(CancellationToken ct)
    {
        if (await _db.Scenarios.AsNoTracking().AnyAsync(ct))
            return;

        var now = DateTime.UtcNow;
        foreach (var seed in RoleplayScenarioSeed.All)
        {
            _db.Scenarios.Add(new Scenario
            {
                Id = Guid.NewGuid(),
                Slug = seed.Slug,
                TitleRu = seed.TitleRu,
                GoalUz = seed.GoalUz,
                Level = seed.Level,
                Minutes = seed.Minutes,
                Tone = seed.Tone,
                Icon = seed.Icon,
                PersonaRu = seed.PersonaRu,
                OpeningRu = seed.OpeningRu,
                Beats = RoleplayScenarioSeed.Serialize(seed.Beats),
                Phrases = RoleplayScenarioSeed.Serialize(seed.Phrases),
                SortOrder = seed.SortOrder,
                IsActive = true,
                CreatedAt = now,
                UpdatedAt = now,
            });
        }

        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex)
        {
            // Two first requests can race here; the unique slug index settles it. The loser drops
            // its copy and reads what the winner wrote, because both wrote the same catalogue.
            _db.ChangeTracker.Clear();
            _logger.LogInformation(ex, "roleplay scenario seed lost a race; using the rows already stored");
        }
    }

    // ─── Shaping ────────────────────────────────────────────────────────────

    private static RoleplayScenarioResponse Tile(Scenario s)
        => new(s.Slug, s.TitleRu, s.GoalUz, s.Level, s.Minutes, s.Tone, s.Icon);

    private static RoleplayStartResponse Blocked(string state, int dailyLeft)
        => new(state, null, null, null, 0, dailyLeft);

    private static RoleplayTurnResponse Blocked(
        Guid conversationId, string state, int spoken, RoleplayLimits limits, int dailyLeft)
        => new(state, conversationId, spoken, null, string.Empty,
               Array.Empty<RoleplayCorrection>(), false,
               Math.Max(0, limits.MaxTurns - spoken), dailyLeft, state == RoleplayState.Finished);

    /// <summary>
    /// The conversation's coaching, deduplicated on the mistake itself and capped at six.
    ///
    /// <para>A learner who says «я хочу идти в аптека» in three different turns has one thing to fix,
    /// not three, and a summary that lists it three times reads as noise. Six is what fits on the E4
    /// card without scrolling past the "Yana urinish" button.</para>
    /// </summary>
    private static IReadOnlyList<RoleplayCorrection> MergeCorrections(IEnumerable<RoleplayTurn> turns)
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var merged = new List<RoleplayCorrection>();

        foreach (var turn in turns)
        {
            if (string.IsNullOrWhiteSpace(turn.Corrections))
                continue;

            List<GraderCorrection>? parsed;
            try
            {
                parsed = JsonSerializer.Deserialize<List<GraderCorrection>>(turn.Corrections, JsonbOptions);
            }
            catch (JsonException)
            {
                continue;                                  // one unreadable row must not lose the rest
            }

            foreach (var c in parsed ?? new List<GraderCorrection>())
            {
                if (merged.Count >= 6)
                    return merged;
                if (seen.Add($"{c.Original}→{c.Corrected}"))
                    merged.Add(new RoleplayCorrection(c.Original, c.Corrected, c.Type, c.Explanation));
            }
        }

        return merged;
    }

    private static string Truncate(string text)
    {
        var trimmed = text.Trim();
        return trimmed.Length <= MaxTranscriptChars ? trimmed : trimmed[..MaxTranscriptChars];
    }

    private static string? Fit(string? value, int max)
        => string.IsNullOrWhiteSpace(value) ? null
            : value.Length <= max ? value : value[..max];

    // Reads the upload with a hard ceiling instead of trusting Content-Length, which the client
    // supplies. Returns null past the cap so the endpoint can refuse rather than hand a vendor a
    // payload nobody meant to send.
    private static async Task<byte[]?> ReadCappedAsync(Stream source, CancellationToken ct)
    {
        using var buffer = new MemoryStream();
        var chunk = new byte[81920];
        int read;
        while ((read = await source.ReadAsync(chunk, ct)) > 0)
        {
            if (buffer.Length + read > MaxAudioBytes)
                return null;
            buffer.Write(chunk, 0, read);
        }
        return buffer.ToArray();
    }
}
