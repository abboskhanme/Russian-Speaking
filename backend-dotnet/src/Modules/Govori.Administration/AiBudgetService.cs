using System.Globalization;
using Govori.Contracts;
using Govori.Infrastructure;
using Govori.Platform.Ai;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Govori.Administration;

/// <summary>
/// The defaults and parsing rules of the global AI budget. One place, so the admin read model, the
/// PATCH validation and the enforcement can never disagree about what an unset cap means.
/// </summary>
public static class AiBudgetSettings
{
    /// <summary>Daily cap when neither <c>app_settings</c> nor <c>AI_DAILY_CAP_USD</c> sets one:
    /// $10 — about 800 graded attempts at the $0.012/attempt target (docs/01), far above launch
    /// traffic, small enough that a runaway loop costs one dinner, not one month.</summary>
    public const decimal DefaultDailyCapUsd = 10m;

    /// <summary>Monthly cap default (<c>AI_MONTHLY_CAP_USD</c>): $200 — twenty full days at the daily
    /// cap, so the monthly ceiling still binds if the daily one is hit every day.</summary>
    public const decimal DefaultMonthlyCapUsd = 200m;

    /// <summary>Largest cap accepted. Not "unlimited" in disguise: a ceiling exists so that a typo
    /// with three extra zeros is refused rather than stored.</summary>
    public const decimal MaxCapUsd = 1_000_000m;

    /// <summary>Spend fraction of a cap at which a warning is logged.</summary>
    public const decimal WarnFraction = 0.8m;

    private static readonly HashSet<string> TrueWords = new(StringComparer.Ordinal) { "true", "1", "yes", "on" };

    /// <summary>A dollar amount in invariant format ("12.5"), or null when malformed, negative, zero
    /// (unless <paramref name="allowZero"/>) or above <see cref="MaxCapUsd"/>.</summary>
    public static decimal? ParseUsd(string? raw, bool allowZero = false)
    {
        if (string.IsNullOrWhiteSpace(raw)
            // No thousands separator: "12,5" must be refused, not read as 125.
            || !decimal.TryParse(raw.Trim(), NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var value))
            return null;
        if (value < 0 || (value == 0 && !allowZero) || value > MaxCapUsd)
            return null;
        return value;
    }

    public static bool ParseFlag(string? raw)
        => raw is not null && TrueWords.Contains(raw.Trim().ToLowerInvariant());
}

/// <summary>
/// The <see cref="IAiBudget"/> implementation: the kill switch and the daily/monthly caps (from
/// <c>app_settings</c> → env → <see cref="AiBudgetSettings"/> defaults) enforced against the
/// <c>ai_spend_daily</c> ledger.
///
/// <para><b>Concurrency — a bounded overshoot, by design.</b> A check does not reserve money: N
/// requests that pass the check together each make one vendor call, and the ledger can end up above
/// the cap by at most what those in-flight calls cost (one call per concurrent request — a few cents
/// at the worker's concurrency). Once the recorded total reaches the cap, no NEW call starts in any
/// process, because every check reads the shared table. Ledger writes are one atomic upsert, so no
/// increment is ever lost under concurrency. Reserving before each call would make the bound exact
/// but needs the cost before the call — and for a grader that is the one number nobody knows until
/// the vendor answers.</para>
///
/// <para><b>The kill switch</b> is an <c>app_settings</c> row read through the same ~30s cache as
/// every other setting; a write is broadcast to every process over Redis, so in production the pause
/// lands on the next vendor call. Calls already in flight finish.</para>
///
/// <para>Scoped: it reads through the scoped DbContext.</para>
/// </summary>
public sealed class AiBudgetService : IAiBudget
{
    private readonly GovoriDbContext _db;
    private readonly AppSettingsService _settings;
    private readonly ILogger<AiBudgetService> _logger;
    private readonly TimeProvider _time;

    public AiBudgetService(
        GovoriDbContext db, AppSettingsService settings, ILogger<AiBudgetService> logger,
        TimeProvider? time = null)
    {
        _db = db;
        _settings = settings;
        _logger = logger;
        _time = time ?? TimeProvider.System;
    }

    /// <summary>The resolved kill switch and caps.</summary>
    public async Task<(bool Paused, decimal DailyCap, decimal MonthlyCap)> LimitsAsync(CancellationToken ct = default)
    {
        var paused = AiBudgetSettings.ParseFlag(await _settings.GetAsync("ai_paused", "false", ct));
        return (paused,
                await CapAsync("ai_daily_cap_usd", AiBudgetSettings.DefaultDailyCapUsd, ct),
                await CapAsync("ai_monthly_cap_usd", AiBudgetSettings.DefaultMonthlyCapUsd, ct));
    }

    // Unset → the default. Malformed (e.g. a bad env value) → the default too, loudly: a typo must
    // never be read as "no cap".
    private async Task<decimal> CapAsync(string key, decimal fallback, CancellationToken ct)
    {
        var raw = await _settings.GetAsync(key, ct: ct);
        if (AiBudgetSettings.ParseUsd(raw) is { } cap)
            return cap;
        if (!string.IsNullOrWhiteSpace(raw))
            _logger.LogWarning("{Key} = '{Raw}' is not a positive dollar amount; using the default {Cap}",
                key, raw, fallback);
        return fallback;
    }

    public async Task<AiBudgetCheck> CheckAsync(CancellationToken ct = default)
    {
        var (paused, dailyCap, monthlyCap) = await LimitsAsync(ct);
        if (paused)
            return new AiBudgetCheck(AiBudgetBlock.Paused);

        var (today, month) = await SpendAsync(Today(), ct);
        return Judge(today, month, dailyCap, monthlyCap);
    }

    public async Task RecordAsync(AiUsage usage, CancellationToken ct = default)
    {
        try
        {
            var day = Today();
            var failed = usage.Succeeded ? 0 : 1;
            var seconds = Math.Round((decimal)usage.AudioSeconds, 2);

            // One statement, atomic under any number of concurrent writers: the row is created on the
            // first call of the day and incremented in place by every later one.
            await _db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO ai_spend_daily
                    (day, provider, operation, calls, failed_calls, audio_seconds,
                     input_tokens, output_tokens, cost_usd, updated_at)
                VALUES ({day}, {usage.Provider}, {usage.Operation}, 1, {failed}, {seconds},
                        {usage.InputTokens}, {usage.OutputTokens}, {usage.CostUsd}, now())
                ON CONFLICT (day, provider, operation) DO UPDATE SET
                    calls         = ai_spend_daily.calls + 1,
                    failed_calls  = ai_spend_daily.failed_calls + EXCLUDED.failed_calls,
                    audio_seconds = ai_spend_daily.audio_seconds + EXCLUDED.audio_seconds,
                    input_tokens  = ai_spend_daily.input_tokens + EXCLUDED.input_tokens,
                    output_tokens = ai_spend_daily.output_tokens + EXCLUDED.output_tokens,
                    cost_usd      = ai_spend_daily.cost_usd + EXCLUDED.cost_usd,
                    updated_at    = now()
                """, ct);

            await WarnOnThresholdAsync(day, usage.CostUsd, ct);
        }
        catch (Exception ex)
        {
            // The vendor call already happened and its result is the student's. Failing it because
            // the ledger could not be written would charge them for our bookkeeping. Logged as an
            // error: a ledger that silently stops counting is a ceiling that silently stops working.
            _logger.LogError(ex, "could not record AI spend ({Provider} {Operation} ${Cost})",
                usage.Provider, usage.Operation, usage.CostUsd);
        }
    }

    /// <summary>The admin read model: switch, caps, spend so far and this month's breakdown.</summary>
    public async Task<AiBudgetResponse> StatusAsync(CancellationToken ct = default)
    {
        var (paused, dailyCap, monthlyCap) = await LimitsAsync(ct);
        var day = Today();
        var monthStart = new DateOnly(day.Year, day.Month, 1);

        var rows = await _db.AiSpendDaily.AsNoTracking()
            .Where(r => r.Day >= monthStart && r.Day <= day)
            .ToListAsync(ct);

        var today = rows.Where(r => r.Day == day).Sum(r => r.CostUsd);
        var month = rows.Sum(r => r.CostUsd);

        var state = paused
            ? AiBudgetStates.Paused
            : Judge(today, month, dailyCap, monthlyCap).Block switch
            {
                AiBudgetBlock.MonthlyCap => AiBudgetStates.MonthlyCap,
                AiBudgetBlock.DailyCap => AiBudgetStates.DailyCap,
                _ => AiBudgetStates.Open,
            };

        var lines = rows
            .GroupBy(r => (r.Provider, r.Operation))
            .Select(g => new AiSpendLine(
                g.Key.Provider, g.Key.Operation, g.Sum(r => r.Calls), g.Sum(r => r.FailedCalls),
                (double)Math.Round(g.Sum(r => r.CostUsd), 4)))
            .OrderByDescending(l => l.CostUsd).ThenBy(l => l.Provider).ThenBy(l => l.Operation)
            .ToList();

        return new AiBudgetResponse(
            paused, (double)dailyCap, (double)monthlyCap,
            (double)Math.Round(today, 4), (double)Math.Round(month, 4),
            state, day, lines);
    }

    // ─── internals ────────────────────────────────────────────────────────────

    private DateOnly Today() => ProductDay.Today(_time.GetUtcNow().UtcDateTime);

    // Monthly first: when both are spent, the honest answer is the one that does NOT reopen at midnight.
    private static AiBudgetCheck Judge(decimal today, decimal month, decimal dailyCap, decimal monthlyCap)
        => month >= monthlyCap ? new AiBudgetCheck(AiBudgetBlock.MonthlyCap)
         : today >= dailyCap ? new AiBudgetCheck(AiBudgetBlock.DailyCap)
         : AiBudgetCheck.Open;

    // Today's and this month's recorded spend. At most ~31 days × backends × 2 rows.
    private async Task<(decimal Today, decimal Month)> SpendAsync(DateOnly day, CancellationToken ct)
    {
        var monthStart = new DateOnly(day.Year, day.Month, 1);
        var rows = await _db.AiSpendDaily.AsNoTracking()
            .Where(r => r.Day >= monthStart && r.Day <= day)
            .Select(r => new { r.Day, r.CostUsd })
            .ToListAsync(ct);
        return (rows.Where(r => r.Day == day).Sum(r => r.CostUsd), rows.Sum(r => r.CostUsd));
    }

    // Logs once per crossing (per process): the write that takes the total from below a threshold to
    // at-or-above it is the one that reports. 80% is a warning to act; 100% says AI has stopped.
    private async Task WarnOnThresholdAsync(DateOnly day, decimal added, CancellationToken ct)
    {
        if (added <= 0)
            return;

        var (_, dailyCap, monthlyCap) = await LimitsAsync(ct);
        var (today, month) = await SpendAsync(day, ct);

        Report("daily", today, dailyCap);
        Report("monthly", month, monthlyCap);

        void Report(string which, decimal after, decimal cap)
        {
            var before = after - added;
            if (before < cap && after >= cap)
                _logger.LogWarning(
                    "AI budget: {Which} cap reached — ${Spent} of ${Cap}. New AI work is refused until it resets or an admin raises the cap.",
                    which, Math.Round(after, 2), cap);
            else if (before < cap * AiBudgetSettings.WarnFraction && after >= cap * AiBudgetSettings.WarnFraction)
                _logger.LogWarning(
                    "AI budget: {Which} spend passed {Percent}% of the cap — ${Spent} of ${Cap}.",
                    which, (int)(AiBudgetSettings.WarnFraction * 100), Math.Round(after, 2), cap);
        }
    }
}
