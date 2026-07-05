import type { Submission } from "./types";

/**
 * The single 0–100 score for one answer — mirrors backend app/services/scoring.py.
 * A teacher's manual override wins; otherwise the LEVEL-relative AI score (fair,
 * stable); legacy rows with no level fall back to the absolute band.
 */
export function answerScore(s: Submission): number | null {
  if (s.teacher_band != null) return s.teacher_band;
  if (s.status === "done" && s.evaluation) {
    return s.evaluation.level_score ?? s.evaluation.overall_band;
  }
  return null;
}
