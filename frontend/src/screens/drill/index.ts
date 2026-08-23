/**
 * screens/drill — «Tovushlar mashqi», the F2 minimal-pair drill (docs/01 F2).
 *
 * The pronunciation exercise that says a CONSEQUENCE instead of a score: not
 * "your ы scored 62" — a sentence the vendor data cannot support for Russian —
 * but "you asked for a mouse and said bear".
 *
 *   DrillScreen      — the controllable, prop-driven screen.
 *   DrillScreenDemo  — a self-wired default export, renderable standalone.
 */
export { DrillScreen, default as DrillScreenDemo } from "./DrillScreen";
export type {
  DrillScreenProps,
  DrillPair,
  DrillPhoneme,
  DrillResult,
  DrillOutcome,
  DrillState,
} from "./DrillScreen";
export { mockDrillPairs } from "./drill.mock";
