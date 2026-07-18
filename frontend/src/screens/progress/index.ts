/**
 * screens/progress — the student's Progress place (docs/04 §4.1).
 * Presentational + prop-driven; composed from `shared/ui` + `widgets` + tokens.
 *
 *   ProgressScreen      — the controllable, prop-driven screen.
 *   ProgressScreenDemo  — a self-wired default export, renderable standalone.
 */
export { ProgressScreen, default as ProgressScreenDemo } from "./ProgressScreen";
export type {
  ProgressScreenProps,
  ProgressBandTrend,
  ProgressBandPoint,
  ProgressLevel,
  ProgressStreak,
  ProgressStreakDay,
  ProgressAchievement,
  AchievementStatus,
  TrendDirection,
} from "./ProgressScreen";
export {
  mockBandTrend,
  mockLevel,
  // Re-exported under a distinct name — `mockStreak` also lives in home.mock,
  // and the top-level screens barrel star-exports both.
  mockStreak as mockProgressStreak,
  mockAchievements,
} from "./progress.mock";
