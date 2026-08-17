/**
 * screens/review — «Xatolar ustida», the F5 xato-replay drill (docs/08 Faza
 * 6.1). The half the spaced-repetition queue was missing: not a list of the
 * questions that beat you, but the place you redo them.
 *
 * Named for what it is, NOT «Takrorlash» — that label belongs to shadowing
 * («Eshit va takrorla») elsewhere in the product, and reusing it here would put
 * two unrelated exercises under one word.
 *
 *   ReviewDrillScreen      — the controllable, prop-driven screen.
 *   ReviewDrillScreenDemo  — a self-wired default export, renderable standalone.
 */
export { ReviewDrillScreen, default as ReviewDrillScreenDemo } from "./ReviewDrillScreen";
export type {
  ReviewDrillScreenProps,
  ReviewDrillCard,
  DrillVerdict,
} from "./ReviewDrillScreen";
export { mockDrillCards } from "./review.mock";
