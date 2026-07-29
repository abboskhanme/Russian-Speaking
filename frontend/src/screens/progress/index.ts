/**
 * screens/progress — the student's Progress place (docs/04 §4.1), split into
 * three inner tabs: Ko'nikmalar · Yutuqlar · Reyting.
 * Presentational + prop-driven; composed from `shared/ui` + `widgets` + tokens.
 *
 *   ProgressScreen      — the controllable, prop-driven screen (the shell).
 *   ProgressScreenDemo  — a self-wired default export, renderable standalone.
 */
export { ProgressScreen, default as ProgressScreenDemo } from "./ProgressScreen";
export type { ProgressScreenProps, ProgressTabKey } from "./ProgressScreen";

export { SkillsTab } from "./tabs/SkillsTab";
export type { SkillsTabProps, SkillKey } from "./tabs/SkillsTab";

export { AchievementsTab } from "./tabs/AchievementsTab";
export type { AchievementsTabProps } from "./tabs/AchievementsTab";

export { LeaderboardTab } from "./tabs/LeaderboardTab";
export type { LeaderboardTabProps, LeaderboardPeriod } from "./tabs/LeaderboardTab";

export { LineChart } from "./LineChart";
export type { LineChartProps } from "./LineChart";

export {
  mockSkills,
  mockProgressAchievements,
  mockLeaderboard,
} from "./progress.mock";
