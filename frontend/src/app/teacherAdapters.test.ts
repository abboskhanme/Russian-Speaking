/**
 * app/teacherAdapters — the numbers a teacher acts on.
 *
 * Two contracts here are cross-system, so they cannot be checked by reading one
 * file:
 *
 *   • `levelFromBand` duplicates `CefrScale.FromBand` in
 *     `Govori.Contracts/CefrScale.cs`. Drift is invisible — both sides keep
 *     working, they just disagree, and one student ends up with two "levels"
 *     depending on whose screen you look at. The boundaries are pinned here so a
 *     one-sided edit fails loudly.
 *   • `skillAverages` must OMIT a skill nobody has been graded on. Returning 0
 *     instead renders an empty bar, which a teacher reads as "scored nothing" when
 *     the truth is "never measured" — the two call for opposite interventions.
 */
import { describe, expect, it } from "vitest";
import type { SubmissionResponse } from "../shared/api";
import { averageBand, levelFromBand, skillAverages } from "./teacherAdapters";

function submission(scores: Partial<SubmissionResponse> = {}): SubmissionResponse {
  return {
    id: "s1",
    student_id: "u1",
    question_id: null,
    reference_text: null,
    audio_key: "k",
    audio_url: null,
    audio_duration_sec: null,
    status: "done",
    error_message: null,
    created_at: "2026-07-30T21:00:00Z",
    completed_at: null,
    student_name: null,
    question_title: null,
    question_topic: null,
    question_level: null,
    model_answer_text: null,
    teacher_comment: null,
    teacher_band: null,
    reviewed_at: null,
    overall_band: null,
    fluency_score: null,
    lexical_score: null,
    grammar_score: null,
    pronunciation_score: null,
    ...scores,
  };
}

describe("levelFromBand", () => {
  it.each([
    [0, "A1"],
    [29, "A1"],
    [30, "A2"],
    [49, "A2"],
    [50, "B1"],
    [69, "B1"],
    [70, "B2"],
    [84, "B2"],
    [85, "C1"],
    [100, "C1"],
  ])("band %i is %s", (band, level) => {
    expect(levelFromBand(band)).toBe(level);
  });
});

describe("skillAverages", () => {
  it("averages each sub-skill independently", () => {
    const subs = [
      submission({ fluency_score: 60, grammar_score: 40 }),
      submission({ fluency_score: 80, grammar_score: 60 }),
    ];
    expect(skillAverages(subs)).toEqual({ fluency: 70, grammar: 50 });
  });

  it("OMITS a never-measured skill rather than reporting it as 0", () => {
    const result = skillAverages([submission({ fluency_score: 70 })]);
    expect(result).toEqual({ fluency: 70 });
    expect("pronunciation" in result).toBe(false);
  });

  it("counts a genuine 0 as a score", () => {
    // The mirror image of the case above: 0 is data, null is absence.
    expect(skillAverages([submission({ lexical_score: 0 })])).toEqual({ lexical: 0 });
  });

  it("skips ungraded attempts without dragging the mean down", () => {
    const subs = [submission({ fluency_score: 80 }), submission({ fluency_score: null })];
    expect(skillAverages(subs)).toEqual({ fluency: 80 });
  });

  it("returns nothing at all for an empty roster", () => {
    expect(skillAverages([])).toEqual({});
  });
});

describe("averageBand", () => {
  it("averages only the graded attempts", () => {
    const subs = [
      submission({ overall_band: 60 }),
      submission({ overall_band: 80 }),
      submission({ overall_band: null }),
    ];
    expect(averageBand(subs)).toBe(70);
  });

  it("is null — not 0 — when nothing is graded", () => {
    expect(averageBand([])).toBeNull();
    expect(averageBand([submission()])).toBeNull();
  });
});
