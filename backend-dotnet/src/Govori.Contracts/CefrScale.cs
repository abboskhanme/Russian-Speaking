namespace Govori.Contracts;

// ─── CEFR band → level scale (shared kernel) ─────────────────────────────────
// This mapping was born inside Govori.Assessment's PlacementService.MapCefr, but TWO more
// surfaces now need the identical buckets: GET /api/auth/me and the Profile slice
// (GET /api/profile/{stats,achievements}) both report `level` / `level_label`. Those live in
// Govori.Identity, and a Identity→Assessment project reference would be an illegal domain→domain
// edge (docs/07 §7.2; only Practice→Catalog is allow-listed in Govori.ArchTests).
//
// So the thresholds are promoted HERE — Govori.Contracts is the one assembly every module and both
// hosts already reference, it has no dependencies of its own (the "Contracts depends on nothing"
// ArchTest still holds for a pure static class), and it is where the wire shape of `level` /
// `level_label` is already defined. Precedent: RateLimitPolicyNames is likewise a non-DTO constant
// holder in this project. PlacementService.MapCefr now DELEGATES to this type, so the thresholds
// exist exactly once and cannot drift.

/// <summary>
/// The single source of truth for turning a 0–100 speaking band into a CEFR bucket plus its short
/// Uzbek label. Thresholds are VERBATIM the ones originally tuned in
/// <c>Govori.Assessment.PlacementService.MapCefr</c> (a mid-range placement ~45 reads
/// A2 · "boshlang'ich" exactly like the mockup, and higher bands climb sanely) — moving them here
/// changed nothing about their behaviour.
/// </summary>
public static class CefrScale
{
    /// <summary>
    /// The five levels in ascending order. Backs <see cref="IsAtLeast"/> (the <c>level_b1</c>
    /// achievement asks "B1 or higher"); indexes are the comparison key, never persisted.
    /// </summary>
    public static readonly IReadOnlyList<string> Ladder = new[] { "A1", "A2", "B1", "B2", "C1" };

    /// <summary>
    /// CEFR bucket + short Uzbek label from a 0–100 band. The exact thresholds ported out of
    /// <c>PlacementService.MapCefr</c>.
    /// </summary>
    public static (string Level, string LabelUz) FromBand(double band) => band switch
    {
        < 30 => ("A1", "yangi boshlovchi"),
        < 50 => ("A2", "boshlang'ich"),
        < 70 => ("B1", "o'rta"),
        < 85 => ("B2", "o'rta-yuqori"),
        _ => ("C1", "yuqori"),
    };

    /// <summary>
    /// Nullable-in / nullable-out overload for the "derived level" contract: with no graded attempts
    /// there is no average band, so <c>level</c> and <c>level_label</c> are both <c>null</c> and the
    /// UI hides the badge. Never invents an A1 out of missing data.
    /// </summary>
    public static (string? Level, string? LabelUz) FromAverageBand(double? averageBand)
        => averageBand is { } band ? FromBand(band) : (null, null);

    /// <summary>
    /// Whether <paramref name="level"/> sits at or above <paramref name="minimum"/> on the
    /// <see cref="Ladder"/>. A null/unknown level is never "at least" anything (returns false).
    /// </summary>
    public static bool IsAtLeast(string? level, string minimum)
    {
        if (level is null) return false;
        var have = RankOf(level);
        var need = RankOf(minimum);
        return have >= 0 && need >= 0 && have >= need;
    }

    // Position on the ladder, or -1 for an unknown label. (IReadOnlyList has no IndexOf.)
    private static int RankOf(string level)
    {
        for (var i = 0; i < Ladder.Count; i++)
            if (string.Equals(Ladder[i], level, StringComparison.Ordinal))
                return i;
        return -1;
    }
}
