/**
 * screens/home — the student's Bosh sahifa (docs/04 §4.1, §4.5), rebuilt to the
 * owner's mockup: today's-practice hero + teacher/group block + QISQACHA summary.
 * Presentational + prop-driven; composed from `shared/ui` + `widgets` + tokens.
 *
 *   HomeScreen      — the controllable, prop-driven screen.
 *   HomeScreenDemo  — a self-wired default export, renderable standalone.
 */
export { HomeScreen, default as HomeScreenDemo } from "./HomeScreen";
export type {
  HomeScreenProps,
  HomeUser,
  HomeToday,
  HomeGroup,
  HomeAssignment,
  HomeStats,
  HomeDaily,
} from "./HomeScreen";
export {
  mockHomeUser,
  mockHomeToday,
  mockHomeGroup,
  mockHomeStats,
} from "./home.mock";
