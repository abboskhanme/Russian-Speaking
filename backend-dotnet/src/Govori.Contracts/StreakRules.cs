namespace Govori.Contracts;

// ─── Daily-streak arithmetic (shared kernel) ─────────────────────────────────
// The streak is WRITTEN in exactly one place — Govori.Engagement's UpdateStreak, on the next XP
// award — but it is READ by three modules: Identity (GET /api/profile/stats), Practice
// (GET /api/daily) and Engagement itself (both leaderboards). A reader cannot call into Engagement
// (Identity→Engagement and Practice→Engagement are illegal domain edges, docs/07 §7.2), so the rule
// lives HERE, where CefrScale and PhoneNumbers already live for the same reason: Govori.Contracts is
// referenced by every module and depends on nothing (a pure static class keeps that ArchTest green).
// UpdateStreak asks SurvivesGap too, so the writer and every reader decide "is this streak still
// alive" with the same line of code and cannot drift apart.

/// <summary>
/// The rules that turn the stored streak columns into the streak a student actually has today.
///
/// <para><b>Why the stored value is not the answer.</b> <c>users.current_streak</c> only changes when
/// the student is next awarded XP. A student who stops practising keeps whatever number they had on
/// their last day, indefinitely — so the profile, the daily screen and the leaderboards were all
/// showing week-old streaks as live ones. Nothing wrong was ever WRITTEN; the column simply has not
/// been asked yet. The read paths therefore compute the effective value with <see cref="Effective"/>
/// instead of printing the column.</para>
///
/// <para><b>Why at read time, and not a nightly job that zeroes broken streaks.</b> A nightly job is
/// wrong for up to a day after every midnight (the exact staleness being fixed, only shorter), it
/// would have to spend or ignore freezes on the student's behalf, and it is one more write path that
/// can disagree with the real one. Deriving at read time is correct at every instant and writes
/// nothing: reading NEVER consumes a freeze — freezes are spent lazily, only by UpdateStreak, only
/// when the student actually comes back.</para>
///
/// <para><b>Days are UTC</b> (the documented S6 decision): the writer keys off
/// <c>DateOnly.FromDateTime(DateTime.UtcNow)</c>, so every reader must too, or a student in
/// Tashkent would see their streak break five hours before the writer thinks it has.</para>
/// </summary>
public static class StreakRules
{
    /// <summary>Today's streak day — UTC, matching the writer (S6).</summary>
    public static DateOnly Today() => DateOnly.FromDateTime(DateTime.UtcNow);

    /// <summary>
    /// Whether a streak whose last practice was <paramref name="gapDays"/> days ago can still be
    /// continued today. 0 (practised today) and 1 (practised yesterday) always can; beyond that, each
    /// missed day in between needs one freeze to bridge it. This is the SAME test UpdateStreak applies
    /// when the student does practise, which is what makes the read path's answer the one the writer
    /// would give.
    /// </summary>
    public static bool SurvivesGap(int gapDays, int streakFreezes)
        => gapDays <= 1 || streakFreezes >= gapDays - 1;

    /// <summary>
    /// The streak to SHOW: the stored one while it can still be continued today, otherwise 0.
    /// <list type="bullet">
    ///   <item>practised today or yesterday → the stored streak;</item>
    ///   <item>missed days that the available freezes cover → the stored streak (practising today
    ///   will bridge them);</item>
    ///   <item>missed more days than there are freezes → 0 (the next practice restarts at 1).</item>
    /// </list>
    /// With no last-practice date there is no gap to measure, so the stored value is returned as-is
    /// rather than invented — the writer never produces a positive streak without a date.
    /// </summary>
    public static int Effective(int currentStreak, DateOnly? lastPracticeDate, int streakFreezes, DateOnly today)
    {
        if (currentStreak <= 0 || lastPracticeDate is null)
            return currentStreak;

        var gap = today.DayNumber - lastPracticeDate.Value.DayNumber;
        return SurvivesGap(gap, streakFreezes) ? currentStreak : 0;
    }
}
