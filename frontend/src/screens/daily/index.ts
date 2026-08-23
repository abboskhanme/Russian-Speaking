/**
 * screens/daily — «Bugungi 5 daqiqa», the F3 daily session (docs/01 F3,
 * docs/04 §4.5, docs/08 Faza 6.3).
 *
 * One short, finishable session a day, assembled from what already exists:
 * warm up → say one task → correct one mistake. It is a GUIDE, not a container —
 * the task and the correction happen on the screens that already own them, so
 * there is no second recording path and no second grading path to keep in step.
 *
 *   DailyScreen      — the controllable, prop-driven screen.
 *   DailyScreenDemo  — a self-wired default export, renderable standalone.
 */
export { DailyScreen, default as DailyScreenDemo } from "./DailyScreen";
export type {
  DailyScreenProps,
  DailyStep,
  DailyStepKind,
  DailyPhrase,
} from "./DailyScreen";
export { mockDailySteps } from "./daily.mock";
export { useRussianVoice } from "./useRussianVoice";
export type { RussianVoice } from "./useRussianVoice";
