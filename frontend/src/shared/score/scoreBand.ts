/**
 * scoreBand — the ONE rule for how a 0..100 score is coloured and how Govo
 * reacts to it, so a list dot, a ring and a mascot can never disagree.
 *
 *   great ≥ 80 · good ≥ 60 · fair ≥ 35 · low < 35
 *
 * A 0 is "low" (danger tint), never success green: colour follows the score.
 */
export type ScoreBand = "great" | "good" | "fair" | "low";

export function scoreBand(score: number): ScoreBand {
  if (score >= 80) return "great";
  if (score >= 60) return "good";
  if (score >= 35) return "fair";
  return "low";
}

/** The semantic tone a band paints in. */
export function scoreTone(score: number): "success" | "warn" | "danger" {
  const b = scoreBand(score);
  return b === "great" || b === "good" ? "success" : b === "fair" ? "warn" : "danger";
}
