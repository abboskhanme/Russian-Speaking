using Govori.Contracts;
using Govori.Infrastructure;
using Govori.Platform.Ai;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace Govori.Identity;

/// <summary>
/// Builds the <see cref="ClientFeatures"/> block of <c>GET /api/auth/me</c>: the student-facing
/// feature switches, read once so the SPA can hide a switched-off entry point instead of probing
/// each feature's route for a 404.
///
/// <para><b>Same mechanism as the modules that own the flags.</b> Each flag lives in
/// <c>app_settings</c> (edited in the admin panel by <c>Govori.Administration</c>) with an env
/// fallback (<c>ROLEPLAY_ENABLED</c> …) and an OFF default — read here straight off the table through
/// the shared DbContext, exactly as <c>Govori.Practice</c> reads <c>roleplay_enabled</c>. A
/// reference to the owning modules would be a cross-domain edge the ArchTests refuse; the key names
/// are the wire contract and are pinned by the integration test.</para>
///
/// <para><b>Advisory only.</b> Every route still enforces its own flag server-side; this answer
/// only decides what the UI offers. A stale value costs a hidden or a refused button, never access.</para>
/// </summary>
public sealed class ClientFeaturesReader
{
    internal const string RoleplayKey = "roleplay_enabled";
    internal const string DailyFiveKey = "daily_five_enabled";
    internal const string ReviewDrillKey = "review_drill_enabled";
    internal const string PhonemeDrillKey = "phoneme_drill_enabled";
    internal const string PaymentsKey = "payments_enabled";

    private static readonly string[] Keys = [RoleplayKey, DailyFiveKey, ReviewDrillKey, PhonemeDrillKey, PaymentsKey];

    private static readonly HashSet<string> TrueWords = new(StringComparer.Ordinal) { "true", "1", "yes", "on" };

    private readonly GovoriDbContext _db;
    private readonly IConfiguration _config;
    private readonly IAiBudget? _budget;
    private readonly ILogger<ClientFeaturesReader> _logger;

    public ClientFeaturesReader(
        GovoriDbContext db, IConfiguration config, ILogger<ClientFeaturesReader> logger, IAiBudget? budget = null)
    {
        _db = db;
        _config = config;
        _logger = logger;
        _budget = budget;
    }

    public async Task<ClientFeatures> ReadAsync(CancellationToken ct = default)
    {
        var stored = await _db.AppSettings
            .AsNoTracking()
            .Where(s => Keys.Contains(s.Key))
            .ToDictionaryAsync(s => s.Key, s => s.Value, ct);

        return new ClientFeatures(
            Roleplay: Flag(stored, RoleplayKey),
            DailyFive: Flag(stored, DailyFiveKey),
            ReviewDrill: Flag(stored, ReviewDrillKey),
            PhonemeDrill: Flag(stored, PhonemeDrillKey),
            Payments: Flag(stored, PaymentsKey),
            AiAvailable: await AiOpenAsync(ct));
    }

    /// <summary>The global AI budget (kill switch + caps). A failure to read it answers "available":
    /// the budget is still enforced before every vendor call, so the worst case of a wrong "yes" is
    /// the refusal the student would have got anyway, while a wrong "no" would hide working features.</summary>
    private async Task<bool> AiOpenAsync(CancellationToken ct)
    {
        if (_budget is null) return true;
        try
        {
            return (await _budget.CheckAsync(ct)).IsOpen;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "AI budget check failed while building /me features; reporting AI as available");
            return true;
        }
    }

    // An override counts only when non-empty, so a cleared row falls through to the env default —
    // the rule AppSettingsService and RoleplayService follow.
    private bool Flag(IReadOnlyDictionary<string, string?> stored, string key)
    {
        var raw = stored.TryGetValue(key, out var v) && !string.IsNullOrWhiteSpace(v)
            ? v!
            : _config[key.ToUpperInvariant()] ?? string.Empty;
        return TrueWords.Contains(raw.Trim().ToLowerInvariant());
    }
}
