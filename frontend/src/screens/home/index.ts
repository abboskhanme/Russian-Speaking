/**
 * screens/home — the student's Bosh sahifa (docs/04 §4.1, §4.5).
 * Presentational + prop-driven; composed from `shared/ui` + `widgets` + tokens.
 *
 *   HomeScreen      — the controllable, prop-driven screen.
 *   HomeScreenDemo  — a self-wired default export, renderable standalone.
 */
export { HomeScreen, default as HomeScreenDemo } from "./HomeScreen";
export type {
  HomeScreenProps,
  HomeUser,
  HomeDailyGoal,
  HomeStreak,
  HomeContinueTarget,
  HomeContinueSteps,
  HomeModule,
  ModuleStatus,
} from "./HomeScreen";
export {
  mockUser,
  mockDailyGoal,
  mockStreak,
  mockContinue,
  mockModules,
} from "./home.mock";
