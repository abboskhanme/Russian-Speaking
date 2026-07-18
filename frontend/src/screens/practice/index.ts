/**
 * screens/practice — the core practice loop screen (docs/04 §4.2–4.6).
 * Presentational + prop-driven; composed from `shared/ui` + `widgets` + tokens.
 *
 *   PracticeScreen      — the controllable, prop-driven screen.
 *   PracticeScreenDemo  — a self-wired default export, renderable standalone.
 */
export { PracticeScreen, default as PracticeScreenDemo } from "./PracticeScreen";
export type {
  PracticeScreenProps,
  PracticePhase,
  PracticeTask,
  PracticeProgress,
  PracticeFeedback,
  PracticeCorrection,
  PracticeCriterion,
} from "./PracticeScreen";
export { mockTask, mockProgress, mockFeedback } from "./practice.mock";
