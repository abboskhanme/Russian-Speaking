import type { SkillsTabProps } from "./tabs/SkillsTab";

/**
 * Fixtures for the Progress screen — let all three tabs render standalone (the
 * default export uses these) and give the architect a shape reference.
 * Presentational only; nothing here calls a backend. The numbers mirror the
 * owner's mockup so the demo render and the design can be compared side by side.
 *
 * The achievements + leaderboard mocks are typed structurally (not against the
 * sibling tabs' prop interfaces) so this fixture file stands alone.
 */

/* ── Ko'nikmalar ─────────────────────────────────────────────────────────── */

/** A2 · "boshlang'ich", +9 band over 8 weeks, skills 78/71/64/52 — the mockup. */
export const mockSkills: SkillsTabProps = {
  level: "A2",
  levelLabel: "boshlang'ich",
  band: 66,
  bandDelta: 9,
  deltaWeeks: 8,
  trend: [
    { weekIndex: 0, band: 57 },
    { weekIndex: 1, band: 58 },
    { weekIndex: 2, band: 60 },
    { weekIndex: 3, band: 61 },
    { weekIndex: 4, band: 62 },
    { weekIndex: 5, band: 63 },
    { weekIndex: 6, band: 65 },
    { weekIndex: 7, band: 66 },
  ],
  skills: [
    { key: "fluency", score: 78 },
    { key: "pronunciation", score: 71 },
    { key: "lexical", score: 64 },
    { key: "grammar", score: 52 },
  ],
};

/* ── Yutuqlar ────────────────────────────────────────────────────────────── */

/** One coherent mid-journey student's 21-badge catalogue, in the backend's order
 * (unlocked first, then locked closest-to-unlocking first). The shape matches
 * `GET /api/profile/achievements` — the Yutuqlar tab reuses that endpoint. */
export const mockProgressAchievements: {
  key: string;
  progress: number;
  target: number;
  unlocked: boolean;
}[] = [
  { key: "first_step", progress: 1, target: 1, unlocked: true },
  { key: "level_a2", progress: 1, target: 1, unlocked: true },
  { key: "level_b1", progress: 1, target: 1, unlocked: true },
  { key: "score_80", progress: 1, target: 1, unlocked: true },
  { key: "group_member", progress: 1, target: 1, unlocked: true },
  { key: "streak_3", progress: 12, target: 3, unlocked: true },
  { key: "streak_7", progress: 12, target: 7, unlocked: true },
  { key: "attempts_10", progress: 62, target: 10, unlocked: true },
  { key: "attempts_50", progress: 62, target: 50, unlocked: true },
  { key: "practice_1h", progress: 132, target: 60, unlocked: true },
  { key: "xp_100", progress: 1240, target: 100, unlocked: true },
  { key: "xp_500", progress: 1240, target: 500, unlocked: true },
  { key: "xp_1000", progress: 1240, target: 1000, unlocked: true },
  { key: "attempts_100", progress: 62, target: 100, unlocked: false },
  { key: "xp_2500", progress: 1240, target: 2500, unlocked: false },
  { key: "practice_5h", progress: 132, target: 300, unlocked: false },
  { key: "streak_30", progress: 12, target: 30, unlocked: false },
  { key: "xp_5000", progress: 1240, target: 5000, unlocked: false },
  { key: "streak_100", progress: 12, target: 100, unlocked: false },
  { key: "level_b2", progress: 0, target: 1, unlocked: false },
  { key: "score_90", progress: 0, target: 1, unlocked: false },
];

/* ── Reyting ─────────────────────────────────────────────────────────────── */

/** Silver league, rank 34 of 128 (top 27%, matching the mockup), +3 places this
 * week, with a five-row neighbour window centred on the caller. */
export const mockLeaderboard: {
  league: "gold" | "silver" | "bronze";
  myRank: number;
  totalStudents: number;
  percentile: number;
  myXp: number;
  currentStreak: number;
  rankDelta: number | null;
  neighbors: { rank: number; fullName: string; xp: number; isMe: boolean }[];
} = {
  league: "silver",
  myRank: 34,
  totalStudents: 128,
  percentile: 27,
  myXp: 320,
  currentStreak: 12,
  rankDelta: 3,
  neighbors: [
    { rank: 32, fullName: "Malika Yusupova", xp: 356, isMe: false },
    { rank: 33, fullName: "Jasur Toshmatov", xp: 341, isMe: false },
    { rank: 34, fullName: "Aziz Karimov", xp: 320, isMe: true },
    { rank: 35, fullName: "Dilnoza Rasulova", xp: 308, isMe: false },
    { rank: 36, fullName: "Sardor Ibrohimov", xp: 297, isMe: false },
  ],
};
