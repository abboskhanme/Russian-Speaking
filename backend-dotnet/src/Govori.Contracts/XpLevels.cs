namespace Govori.Contracts;

// ─── XP levels (shared kernel) ───────────────────────────────────────────────
// The "Daraja N" a student sees on the Home XP bar. It is NOT the CEFR level (that is derived from
// the average band through CefrScale) — it is a pure progression rule over the lifetime XP total
// (User.Xp), so it needs no column and can never disagree with the XP figure printed beside it.
// It lives in Contracts, as a pure static class, for the same reason ProductDay and StreakRules do:
// one rule every module can read without a domain→domain edge.

/// <summary>
/// The XP progression curve: reaching level <c>L</c> takes <c>50·L·(L−1)</c> lifetime XP, i.e. the
/// gap to the next level grows by 100 XP each level (100, 200, 300 …). Level 1 starts at 0 XP.
///
/// <para><b>Why this curve.</b> A graded answer earns 0–25 XP (C8, <c>XpForBand</c>), so the first
/// level-up comes after roughly 6–8 answers — inside a learner's first week — and later levels
/// stretch out without ever becoming a wall: level 10 is 4 500 XP, level 20 is 19 000 XP.</para>
/// </summary>
public static class XpLevels
{
    /// <summary>Each level's gap is this many XP larger than the previous one's.</summary>
    public const int Step = 100;

    /// <summary>Total XP at which level <paramref name="level"/> begins (level ≥ 1).</summary>
    public static int StartOf(int level)
    {
        var l = Math.Max(level, 1);
        return (int)Math.Min((long)Step * l * (l - 1) / 2, int.MaxValue);
    }

    /// <summary>
    /// The level a lifetime total of <paramref name="xp"/> is in, with the XP at which that level
    /// began and the XP at which the next one begins. A negative total is treated as 0.
    /// </summary>
    public static (int Level, int LevelStart, int NextLevelAt) For(int xp)
    {
        var x = Math.Max(xp, 0);
        var level = 1;
        while (StartOf(level + 1) <= x && level < 10_000) level++;
        return (level, StartOf(level), StartOf(level + 1));
    }
}
