namespace Govori.Contracts;

// ─── Progress screen DTOs (progress redesign — shared contract) ──────────────
// Backs the two computed read endpoints behind the redesigned Progress screen's
// "Ko'nikmalar" (skills) and "Reyting" (leaderboard) tabs:
//   GET /api/progress/skills        → ProgressSkillsResponse
//   GET /api/progress/leaderboard   → ProgressLeaderboardResponse
// (The "Yutuqlar" tab reuses the existing GET /api/profile/achievements — no new shape.)
//
// NO SCHEMA CHANGE (docs/07 §7.4 rule 3): every field is COMPUTED from columns that already exist —
// Evaluation.{FluencyScore,PronunciationScore,LexicalScore,GrammarScore,OverallBand},
// Submission.{StudentId,CreatedAt}, User.{Xp,CurrentStreak,LastPracticeDate,StreakFreezes} (the last
// three only through StreakRules.Effective — the streak reported is the one alive TODAY) and
// XpEvent.{StudentId,Amount,CreatedAt}.
// There is no stored `level` column: Level/LevelLabel derive from the student's average
// Evaluation.OverallBand through the shared <see cref="CefrScale"/> (never duplicated here).
//
// Every field serializes snake_case via the host's global JsonNamingPolicy.SnakeCaseLower
// (Program.cs), so `LevelLabel` → "level_label", `BandDelta` → "band_delta", `WeekIndex` →
// "week_index", `MyRank` → "my_rank", `TotalStudents` → "total_students", `MyXp` → "my_xp",
// `RankDelta` → "rank_delta", `FullName` → "full_name", `IsMe` → "is_me". The snake_case wire shape
// is LOAD-BEARING — the frontend TS mirrors read exactly these names.

// ── Skills (Ko'nikmalar tab) ──

/// <summary>
/// One of the four speaking skills — <c>Key</c> ∈ <c>fluency | pronunciation | lexical | grammar</c>,
/// <c>Score</c> the caller's mean for that skill rounded to a whole 0..100. The four are ALWAYS
/// returned in that fixed order; a skill with no scores (e.g. pronunciation, which is nullable in the
/// DB and often absent) reads <c>0</c>, so the bar renders empty rather than missing.
///
/// <para><c>Scored</c> (APPEND-ONLY) tells that "no scores" 0 apart from a real mean of 0: it is
/// <c>false</c> exactly when the caller has no score at all for this skill, so the UI can print "—"
/// instead of claiming a zero the student never earned.</para>
/// </summary>
public sealed record ProgressSkillResponse(string Key, int Score, bool Scored);

/// <summary>
/// One point of the band trend line — <c>Band</c> is a weekly average <c>Evaluation.OverallBand</c>
/// (1dp) and <c>WeekIndex</c> is a 0-based sequence for the x-axis (oldest = 0), NOT a calendar week
/// id.
/// </summary>
public sealed record ProgressTrendPointResponse(int WeekIndex, double Band);

/// <summary>
/// <c>GET /api/progress/skills</c> — the calling student's skill breakdown, derived level and weekly
/// band trend, all scoped to the caller. <c>null</c> at the service ⇒ the user is missing or inactive
/// (401).
///
/// <para><c>Level</c>/<c>LevelLabel</c> derive from <c>Band</c> (the current average
/// <c>OverallBand</c>, 1dp) via the shared <see cref="CefrScale"/>; all three are <c>null</c> together
/// when nothing has been graded yet (the UI hides the badge). <c>Trend</c> buckets the caller's
/// evaluations by ISO week, averages the band per week and emits oldest→newest, capped to the last
/// several weeks; <c>[]</c> when there is no graded history. <c>BandDelta</c> is <c>Band</c> minus the
/// earliest trend point's band (both 1dp); it is <c>null</c> with <c>DeltaWeeks == 0</c> when there is
/// fewer than 2 weeks of data, and otherwise <c>DeltaWeeks</c> is the number of weekly points the
/// delta spans.</para>
/// </summary>
public sealed record ProgressSkillsResponse(
    string? Level,
    string? LevelLabel,
    double? Band,
    double? BandDelta,
    int DeltaWeeks,
    IReadOnlyList<ProgressTrendPointResponse> Trend,
    IReadOnlyList<ProgressSkillResponse> Skills);

// ── Leaderboard summary (Reyting tab) ──

/// <summary>
/// One row of the "YAQIN ATROFDAGILAR" neighbours list. <c>Rank</c> is the 1-based position in the
/// chosen period across all students; <c>Xp</c> is the row's XP FOR that period (weekly / monthly /
/// all-time); <c>IsMe</c> flags the caller's own row.
/// </summary>
public sealed record ProgressLeaderboardRowResponse(
    int Rank,
    Guid Id,
    string FullName,
    int Xp,
    bool IsMe);

/// <summary>
/// <c>GET /api/progress/leaderboard?period=weekly|monthly|all</c> — the caller's standing in the
/// student ranking for the chosen period, plus a small window of neighbours centred on them.
///
/// <para><b>period XP</b>: <c>weekly</c> sums the caller's/each student's XpEvents in the last 7 days,
/// <c>monthly</c> the last 30 days, <c>all</c> uses the denormalised <c>User.Xp</c>. Students are
/// ranked by that period XP, tie-broken by all-time XP. <b>league</b> derives from <c>Percentile</c>:
/// <c>&lt;= 10</c> → "gold", <c>&lt;= 35</c> → "silver", else "bronze". <b>percentile</b> is
/// <c>ceil(MyRank / TotalStudents * 100)</c> clamped 1..100 ("top X%"). <b>neighbours</b> is a sliding
/// window of up to five rows (2 above + caller + 2 below, shifted to stay in-bounds at the ends),
/// ascending by rank, always including the caller (<c>IsMe = true</c>). <b>rank_delta</b> is
/// best-effort: <c>previousRank - MyRank</c> using each student's cumulative XpEvents as of the
/// period's start boundary (positive ⇒ climbed); it is <c>null</c> for <c>all</c> (no previous
/// period). A non-student caller is 403 at the endpoint.</para>
/// </summary>
public sealed record ProgressLeaderboardResponse(
    string Period,
    string League,
    int MyRank,
    int TotalStudents,
    int Percentile,
    int MyXp,
    int CurrentStreak,
    int? RankDelta,
    IReadOnlyList<ProgressLeaderboardRowResponse> Neighbors);
