/**
 * app/teacherAdapters — pure wire-DTO → teacher-screen mappers. Same contract as
 * `app/adapters`: no React, no `t` (labels that need i18n are built in the pages).
 */
import type { SubmissionResponse } from "../shared/api";

/**
 * A 0–100 speaking band → its CEFR bucket.
 *
 * Mirrors `CefrScale.FromBand` in `Govori.Contracts/CefrScale.cs` — the SAME
 * thresholds the server uses for `me.level` and the profile stats. Keeping them
 * identical is what makes the level a teacher sees on a student match the level
 * that student sees on their own screens; drifting either side silently produces
 * two different "levels" for one person.
 */
export function levelFromBand(band: number): string {
  if (band < 30) return "A1";
  if (band < 50) return "A2";
  if (band < 70) return "B1";
  if (band < 85) return "B2";
  return "C1";
}

/** The four graded sub-skills, in the order the mockup's bars appear. */
export const SKILL_KEYS = ["fluency", "grammar", "pronunciation", "lexical"] as const;
export type SkillKey = (typeof SKILL_KEYS)[number];

/**
 * Mean of each sub-skill across a student's graded attempts.
 *
 * Returns only the skills that have at least one score: a skill nobody has been
 * graded on must be ABSENT, not 0 — a zero bar reads as "scored nothing" when the
 * truth is "never measured".
 */
export function skillAverages(subs: SubmissionResponse[]): Partial<Record<SkillKey, number>> {
  const sums: Record<string, { total: number; n: number }> = {};
  const pick: Record<SkillKey, (s: SubmissionResponse) => number | null> = {
    fluency: (s) => s.fluency_score,
    grammar: (s) => s.grammar_score,
    pronunciation: (s) => s.pronunciation_score,
    lexical: (s) => s.lexical_score,
  };

  for (const s of subs) {
    for (const key of SKILL_KEYS) {
      const v = pick[key](s);
      if (v == null) continue;
      const acc = (sums[key] ??= { total: 0, n: 0 });
      acc.total += v;
      acc.n += 1;
    }
  }

  const out: Partial<Record<SkillKey, number>> = {};
  for (const key of SKILL_KEYS) {
    const acc = sums[key];
    if (acc && acc.n > 0) out[key] = acc.total / acc.n;
  }
  return out;
}

/** Mean overall band across graded attempts, or null when none are graded. */
export function averageBand(subs: SubmissionResponse[]): number | null {
  const bands = subs.map((s) => s.overall_band).filter((b): b is number => b != null);
  if (bands.length === 0) return null;
  return bands.reduce((a, b) => a + b, 0) / bands.length;
}
