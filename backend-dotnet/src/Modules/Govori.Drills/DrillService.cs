using System.Text.Json;
using System.Text.RegularExpressions;
using Govori.Contracts;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Govori.Platform.Stt;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace Govori.Drills;

/// <summary>HTTP-shaped outcome. Everything a learner can legitimately hit — flag off, no key, spent
/// budget — is a <see cref="DrillState"/> on a 200, not one of these. <c>Unauthorized</c> is a
/// missing or DEACTIVATED account (see <c>DrillService.IsActiveAsync</c>).</summary>
public enum DrillStatus { Ok, NotFound, BadRequest, Unauthorized }

/// <summary>The flag and the ceiling that decide whether an attempt may run.</summary>
public sealed record DrillLimits(bool Enabled, int DailyAttempts);

/// <summary>
/// F2 · Fonema drill + minimal juftliklar (docs/01) — the engine behind the drill screen.
///
/// <para><b>The feature is built on a discrimination test, not on phoneme scores, and that is a
/// correction of the original plan.</b> docs/01 justified F2 with "Azure ma'lumoti tayyor". It is
/// not: measured against the live vendor on 2026-08-23, <c>ru-RU</c> returns an EMPTY name for every
/// phoneme — in scripted mode as well as unscripted, under IPA and SAPI alike — while the identical
/// request against <c>en-US</c> returns full IPA. Azure documents phoneme names for
/// <c>en-US</c>/<c>zh-CN</c> only. "Your ы scored 62" is therefore a sentence this product cannot
/// truthfully say, and no amount of UI would have made the underlying data exist.</para>
///
/// <para>What it CAN say is which of two words the recogniser heard. For a minimal pair that is the
/// same information in a better form: not a number, but a consequence — you asked for a mouse and
/// said bear. It needs no vendor phoneme inventory, so it keeps working whether or not Azure ever
/// adds Russian.</para>
///
/// <para><b>Two passes, and they are not interchangeable.</b> The verdict comes from an UNSCRIPTED
/// pass, because a scripted one cannot answer it: with a reference supplied, <c>Lexical</c> echoes
/// the REFERENCE — measured 6 trials out of 6, a learner who said <c>мишка</c> against target
/// <c>мышка</c> gets the transcript "мышка". That is exactly the bias
/// <c>transcript-must-stay-faithful</c> forbids, so the scripted response's text is read for nothing
/// and stored nowhere. The scripted pass exists only for the per-position scores, and is made ONLY
/// when the learner got it wrong — see <see cref="AssessAsync"/> for why that is both cheaper and
/// pedagogically right.</para>
///
/// <para><b>Per-sound detail is decoration and is treated as such throughout.</b> Azure returns no
/// phoneme entries at all when the recording does not resemble the reference; our own IPA spelling
/// could drift from Azure's segmentation; the chain can fall through to Whisper, which assesses
/// nothing. Every one of those is a normal path, and in every one of them the drill still delivers a
/// complete verdict. Nothing here may make the result conditional on phoneme data existing.</para>
/// </summary>
public sealed class DrillService
{
    private readonly GovoriDbContext _db;
    private readonly ISttProvider _stt;
    private readonly IConfiguration _config;
    private readonly ILogger<DrillService> _logger;

    /// <summary>The flag this feature hangs off — default OFF, like every other new vendor spend
    /// (docs/08 Faza 6, and the <c>roleplay_enabled</c> precedent).</summary>
    public const string EnabledKey = "phoneme_drill_enabled";

    /// <summary>Attempts per student per UTC day. The cost ceiling.</summary>
    public const string DailyAttemptsKey = "phoneme_drill_daily_attempts";

    private const bool DefaultEnabled = false;

    /// <summary>Forty is a real practice session several times over — a pair takes a few seconds —
    /// while bounding what one open tab can spend. Sized like the roleplay budget: comfortably past
    /// any real learner, nowhere near a script.</summary>
    private const int DefaultDailyAttempts = 40;

    /// <summary>Largest recording accepted. A drill utterance is ONE WORD; anything past this is a
    /// bug or a probe, and both should be refused before they reach a vendor.</summary>
    private const int MaxAudioBytes = 2 * 1024 * 1024;

    private static readonly JsonSerializerOptions JsonbOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    /// <summary>Unicode-aware on purpose: forcing ECMAScript mode would strip Cyrillic and leave
    /// every comparison empty.</summary>
    private static readonly Regex NonWord = new(@"[^\w\s]", RegexOptions.Compiled);

    private static readonly HashSet<string> TrueWords =
        new(StringComparer.OrdinalIgnoreCase) { "true", "1", "yes", "on" };

    public DrillService(
        GovoriDbContext db, ISttProvider stt, IConfiguration config, ILogger<DrillService> logger)
    {
        _db = db;
        _stt = stt;
        _config = config;
        _logger = logger;
    }

    // ─── Catalogue ──────────────────────────────────────────────────────────

    /// <summary>The pair grid plus the state the hub needs to tell the truth BEFORE the learner has
    /// recorded themselves.</summary>
    public async Task<(DrillStatus Status, DrillCatalogResponse? Body)> CatalogAsync(
        Guid userId, CancellationToken ct = default)
    {
        if (!await IsActiveAsync(userId, ct))
            return (DrillStatus.Unauthorized, null);

        var limits = await LimitsAsync(ct);
        if (!limits.Enabled)
            return (DrillStatus.Ok, new DrillCatalogResponse(DrillState.Disabled, Array.Empty<DrillPairResponse>(), 0));

        await EnsureSeededAsync(ct);

        var pairs = await _db.MinimalPairs.AsNoTracking()
            .Where(p => p.IsActive)
            .OrderBy(p => p.SortOrder).ThenBy(p => p.Slug)
            .ToListAsync(ct);

        // One grouped query for the whole grid rather than a count per tile — six pairs today, but a
        // per-tile query is the kind of thing that is never revisited once the content grows.
        var progress = await _db.Drills.AsNoTracking()
            .Where(d => d.StudentId == userId)
            .GroupBy(d => d.PairId)
            .Select(g => new
            {
                PairId = g.Key,
                Attempts = g.Count(),
                Correct = g.Count(d => d.Outcome == nameof(DrillOutcome.Correct).ToLower()),
            })
            .ToDictionaryAsync(x => x.PairId, ct);

        var left = Math.Max(0, limits.DailyAttempts - await SpentTodayAsync(userId, ct));

        var state = left <= 0
            ? DrillState.BudgetSpent
            : await _stt.IsConfiguredAsync(ct) ? DrillState.Ready : DrillState.Unconfigured;

        return (DrillStatus.Ok, new DrillCatalogResponse(
            state,
            pairs.Select(p =>
            {
                progress.TryGetValue(p.Id, out var stat);
                return new DrillPairResponse(
                    p.Slug, p.ContrastRu, p.WhyUz, p.Level, p.WordA, p.WordB, p.GlossAUz, p.GlossBUz,
                    MinimalPairSeed.ReadIpa(p.IpaA), MinimalPairSeed.ReadIpa(p.IpaB),
                    p.FocusIndexA, p.FocusIndexB,
                    stat?.Attempts ?? 0, stat?.Correct ?? 0);
            }).ToList(),
            left));
    }

    // ─── One attempt ────────────────────────────────────────────────────────

    /// <summary>
    /// Assess one recording of one word.
    ///
    /// <para><b>Pass 1 (always, unscripted) produces the verdict.</b> It is the only pass whose
    /// transcript is trustworthy, and it alone answers the question the drill is built on: which
    /// word did the recogniser hear?</para>
    ///
    /// <para><b>Pass 2 (scripted) runs ONLY when the learner did not get it right.</b> Two reasons,
    /// and the cost one is the lesser. Pedagogically, per-position scores on a correct answer
    /// diagnose nothing — the learner already succeeded, and covering a success in numbers invites
    /// them to chase 100 on a thing they have finished. On a miss the same numbers localise the
    /// failure. Financially, it means the second vendor call is spent only where it teaches, and the
    /// bill falls as the student improves rather than scaling with how much they practise.</para>
    /// </summary>
    public async Task<(DrillStatus Status, DrillResultResponse? Body)> AttemptAsync(
        Guid userId, string? pairSlug, string? targetWord, Stream audio, string filename,
        double? clientDurationSec, CancellationToken ct = default)
    {
        // First, before the flag, the budget or a vendor: an attempt is up to two paid STT calls,
        // and a suspended account must stop spending when it is suspended, not when its access
        // token happens to expire.
        if (!await IsActiveAsync(userId, ct))
            return (DrillStatus.Unauthorized, null);

        var limits = await LimitsAsync(ct);
        if (!limits.Enabled)
            return (DrillStatus.Ok, Blocked(DrillState.Disabled, targetWord, 0));

        if (string.IsNullOrWhiteSpace(pairSlug))
            return (DrillStatus.BadRequest, null);

        await EnsureSeededAsync(ct);

        var pair = await _db.MinimalPairs.AsNoTracking()
            .FirstOrDefaultAsync(p => p.Slug == pairSlug && p.IsActive, ct);
        if (pair is null)
            return (DrillStatus.NotFound, null);

        // The target must be one of the pair's own twins. Anything else and the drill would be
        // scoring against a word it has no IPA for — and, worse, would let a caller choose the
        // reference text sent to the vendor.
        var target = Resolve(pair, targetWord);
        if (target is null)
            return (DrillStatus.BadRequest, null);

        var left = limits.DailyAttempts - await SpentTodayAsync(userId, ct);
        if (left <= 0)
            return (DrillStatus.Ok, Blocked(DrillState.BudgetSpent, target.Word, 0));
        if (!await _stt.IsConfiguredAsync(ct))
            return (DrillStatus.Ok, Blocked(DrillState.Unconfigured, target.Word, Math.Max(0, left)));

        var bytes = await ReadCappedAsync(audio, ct);
        if (bytes is null || bytes.Length == 0)
            return (DrillStatus.BadRequest, null);

        // ── Pass 1: unscripted. The verdict, and the only transcript we trust. ──
        var heardResult = await _stt.TranscribeAsync(bytes, filename, referenceText: null, ct);
        var heardText = heardResult.Text ?? string.Empty;
        var outcome = Judge(heardText, target, pair);

        double? accuracy = null;
        IReadOnlyList<DrillPhonemeResponse> phonemes = Array.Empty<DrillPhonemeResponse>();

        // ── Pass 2: scripted, only on a miss. Decoration, and never allowed to fail the attempt. ──
        if (outcome is DrillOutcome.Twin or DrillOutcome.Other)
        {
            try
            {
                var scored = await _stt.TranscribeAsync(
                    bytes, filename, target.Word, ct, SttRecognitionMode.Scripted);

                // NOTE: `scored.Text` is deliberately NOT read. Under a reference text Azure echoes
                // the reference back, so it would report the target as though the learner had said
                // it — the exact opposite of what just happened.
                var word = scored.Words?.FirstOrDefault();
                accuracy = word?.Accuracy;
                phonemes = Align(target, word?.Phonemes);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                // The learner spoke and we already know what they said. Losing the verdict to a
                // vendor's bad minute — for a decoration — would be the worse bug by far.
                _logger.LogWarning(
                    ex, "drill scored pass failed for pair {Pair}; returning the verdict alone", pair.Slug);
            }
        }

        var now = DateTime.UtcNow;
        _db.Drills.Add(new Drill
        {
            Id = Guid.NewGuid(),
            StudentId = userId,
            PairId = pair.Id,
            TargetWord = target.Word,
            HeardText = heardText,                       // unscripted, verbatim
            Outcome = outcome.ToString().ToLowerInvariant(),
            Accuracy = accuracy,
            Phonemes = phonemes.Count == 0 ? null : JsonSerializer.Serialize(phonemes, JsonbOptions),
            FocusScore = phonemes.FirstOrDefault(p => p.Focus)?.Score,
            SttModel = heardResult.Model,
            AudioDurationSec = heardResult.DurationSec ?? clientDurationSec,
            CreatedAt = now,
            UpdatedAt = now,
        });
        await _db.SaveChangesAsync(ct);

        return (DrillStatus.Ok, new DrillResultResponse(
            DrillState.Ready,
            outcome,
            target.Word,
            heardText,
            outcome == DrillOutcome.Twin ? target.Twin : null,
            accuracy,
            phonemes,
            Math.Max(0, left - 1)));
    }

    // ─── The verdict ────────────────────────────────────────────────────────

    /// <summary>
    /// Which word did the recogniser hear? Compared on normalised forms so punctuation and casing
    /// cannot decide a learner's result.
    ///
    /// <para><c>ё</c> is folded onto <c>е</c> for the same reason the shadowing comparison folds it:
    /// Russian is written both ways and Azure picks one. Note that this also means a pair whose
    /// whole contrast is <c>ё</c>/<c>е</c> could never be judged here — which is why no such pair is
    /// in the seed, and why one must not be added.</para>
    /// </summary>
    private static DrillOutcome Judge(string heardText, DrillTarget target, MinimalPair pair)
    {
        var heard = Normalize(heardText);
        if (heard.Length == 0)
            return DrillOutcome.Silent;

        if (heard == Normalize(target.Word))
            return DrillOutcome.Correct;

        if (heard == Normalize(target.Twin))
            return DrillOutcome.Twin;

        // A single word was asked for, but recognisers split and pad ("че ль" for «чель»). If the
        // target's letters are all that was said, treat it as the target rather than punishing the
        // learner for the recogniser's spacing.
        var collapsed = heard.Replace(" ", string.Empty);
        if (collapsed == Normalize(target.Word).Replace(" ", string.Empty))
            return DrillOutcome.Correct;
        if (collapsed == Normalize(target.Twin).Replace(" ", string.Empty))
            return DrillOutcome.Twin;

        return DrillOutcome.Other;
    }

    private static string Normalize(string? text)
    {
        var lowered = (text ?? string.Empty).ToLowerInvariant().Replace('ё', 'е');
        return string.Join(' ', NonWord.Replace(lowered, " ")
            .Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
    }

    // ─── Per-sound detail (decoration) ──────────────────────────────────────

    /// <summary>
    /// Join our IPA names to Azure's positional scores — and REFUSE to do it when the two disagree
    /// about how many sounds the word has.
    ///
    /// <para>This guard is the whole reason per-sound detail is safe to show. Azure emits one entry
    /// per reference phoneme, so for curated content the counts line up (verified for all twelve
    /// seeded words). But content is editable, Azure's segmentation is not ours to control, and a
    /// silent off-by-one would print the score of one sound under the name of another —
    /// authoritatively, to someone who cannot tell it is wrong. That is strictly worse than showing
    /// nothing, so a mismatch drops the entire array and the learner keeps a complete verdict.</para>
    /// </summary>
    private IReadOnlyList<DrillPhonemeResponse> Align(
        DrillTarget target, IReadOnlyList<SttPhoneme>? scored)
    {
        if (scored is null || scored.Count == 0)
            return Array.Empty<DrillPhonemeResponse>();       // normal: Azure aligned nothing

        if (target.Ipa.Count == 0)
            return Array.Empty<DrillPhonemeResponse>();

        if (scored.Count != target.Ipa.Count)
        {
            _logger.LogWarning(
                "drill phoneme alignment refused for {Word}: content has {Ours} symbols, Azure returned "
                + "{Theirs} positions. Showing the verdict without per-sound detail.",
                target.Word, target.Ipa.Count, scored.Count);
            return Array.Empty<DrillPhonemeResponse>();
        }

        var aligned = new List<DrillPhonemeResponse>(scored.Count);
        for (var i = 0; i < scored.Count; i++)
            aligned.Add(new DrillPhonemeResponse(target.Ipa[i], scored[i].Accuracy, i == target.FocusIndex));

        return aligned;
    }

    // ─── Settings, budget, seed ─────────────────────────────────────────────

    public async Task<DrillLimits> LimitsAsync(CancellationToken ct = default)
    {
        var keys = new[] { EnabledKey, DailyAttemptsKey };
        var overrides = await _db.AppSettings.AsNoTracking()
            .Where(s => keys.Contains(s.Key))
            .ToDictionaryAsync(s => s.Key, s => s.Value, ct);

        return new DrillLimits(
            Enabled: Flag(overrides, EnabledKey, DefaultEnabled),
            DailyAttempts: Number(overrides, DailyAttemptsKey, DefaultDailyAttempts, 1, 500));
    }

    private string Resolve(IReadOnlyDictionary<string, string?> overrides, string key)
    {
        // An override counts only when non-empty, so a cleared row falls through to the env default
        // instead of blanking the setting — the rule AppSettingsService follows.
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
        // Clamped, not validated: a typo in a settings row must not remove the ceiling it exists to
        // impose.
        var raw = Resolve(overrides, key);
        return int.TryParse(raw, out var parsed) ? Math.Clamp(parsed, min, max) : fallback;
    }

    /// <summary>Attempts spent since UTC midnight, counted from the rows — a budget one process can
    /// forget is not a budget.</summary>
    private Task<int> SpentTodayAsync(Guid userId, CancellationToken ct)
    {
        var since = DateTime.UtcNow.Date;
        return _db.Drills.AsNoTracking()
            .CountAsync(d => d.StudentId == userId && d.CreatedAt >= since, ct);
    }

    /// <summary>
    /// Is the caller an existing, ACTIVE account? Read from the database on every call, never from
    /// the token — the rule every other module applies (§7.5). An access token outlives the moment
    /// an admin suspends an account; without this a suspended learner kept calling the STT vendor
    /// until it expired. Missing or inactive is a 401, as on the submit route.
    /// </summary>
    private Task<bool> IsActiveAsync(Guid userId, CancellationToken ct)
        => _db.Users.AnyAsync(u => u.Id == userId && u.IsActive, ct);

    /// <summary>Plants the curated pairs the first time they are needed, and ONLY into an empty
    /// table. The empty check is what makes this safe on every request: it is a first-run import,
    /// not a reconciliation, so an operator who fixes a gloss keeps their fix.</summary>
    private async Task EnsureSeededAsync(CancellationToken ct)
    {
        if (await _db.MinimalPairs.AsNoTracking().AnyAsync(ct))
            return;

        var now = DateTime.UtcNow;
        foreach (var seed in MinimalPairSeed.All)
        {
            _db.MinimalPairs.Add(new MinimalPair
            {
                Id = Guid.NewGuid(),
                Slug = seed.Slug,
                ContrastRu = seed.ContrastRu,
                WhyUz = seed.WhyUz,
                Level = seed.Level,
                WordA = seed.WordA,
                WordB = seed.WordB,
                GlossAUz = seed.GlossAUz,
                GlossBUz = seed.GlossBUz,
                IpaA = MinimalPairSeed.Serialize(seed.IpaA),
                IpaB = MinimalPairSeed.Serialize(seed.IpaB),
                FocusIndexA = seed.FocusIndexA,
                FocusIndexB = seed.FocusIndexB,
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
            // Two hosts can reach an empty table at the same moment; the unique slug index makes the
            // loser's insert fail. The content is already there, which is all this method wanted.
            _logger.LogInformation(ex, "minimal-pair seed lost a race; the content is already present");
            foreach (var entry in _db.ChangeTracker.Entries<MinimalPair>().ToList())
                entry.State = EntityState.Detached;
        }
    }

    // ─── Helpers ────────────────────────────────────────────────────────────

    /// <summary>The word being drilled, its twin, and the IPA/focus that belong to it.</summary>
    private sealed record DrillTarget(
        string Word, string Twin, IReadOnlyList<string> Ipa, int FocusIndex);

    /// <summary>Maps the requested word onto one of the pair's twins. A request naming neither is
    /// refused rather than defaulted — silently drilling a word nobody asked for would make the
    /// result meaningless.</summary>
    private static DrillTarget? Resolve(MinimalPair pair, string? requested)
    {
        var want = Normalize(requested);
        if (want.Length == 0)
            return null;

        if (want == Normalize(pair.WordA))
            return new DrillTarget(
                pair.WordA, pair.WordB, MinimalPairSeed.ReadIpa(pair.IpaA), pair.FocusIndexA);

        if (want == Normalize(pair.WordB))
            return new DrillTarget(
                pair.WordB, pair.WordA, MinimalPairSeed.ReadIpa(pair.IpaB), pair.FocusIndexB);

        return null;
    }

    private static DrillResultResponse Blocked(DrillState state, string? target, int left)
        => new(state, DrillOutcome.Silent, target ?? string.Empty, null, null, null,
               Array.Empty<DrillPhonemeResponse>(), left);

    /// <summary>Reads at most <see cref="MaxAudioBytes"/>; anything larger is refused (null) before
    /// it can reach a vendor.</summary>
    private static async Task<byte[]?> ReadCappedAsync(Stream audio, CancellationToken ct)
    {
        using var buffer = new MemoryStream();
        var chunk = new byte[81920];
        int read;
        while ((read = await audio.ReadAsync(chunk, ct)) > 0)
        {
            if (buffer.Length + read > MaxAudioBytes)
                return null;
            buffer.Write(chunk, 0, read);
        }

        return buffer.ToArray();
    }
}
