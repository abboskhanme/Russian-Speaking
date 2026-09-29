/**
 * app/teacherAdapters — pure wire-DTO → teacher-screen mappers. Same contract as
 * `app/adapters`: no React, no `t` (labels that need i18n are built in the pages).
 */
import { isApiError } from "../shared/api";
import type {
  CodedErrorResponse,
  CreateQuestionArgs,
  GroupDetailResponse,
  GroupResponse,
  InsightsResponse,
  SubmissionResponse,
  TeacherQuestionResponse,
  UpdateQuestionArgs,
} from "../shared/api";
import type { AnalyticsErrorRow, EditableTask, NewTaskDraft, TaskPatch } from "../screens/teacher";

/** A teacher's task on the wire → the task editor's shape (C1 list + C4 rows). */
export function editableTaskFromQuestion(q: TeacherQuestionResponse): EditableTask {
  return {
    id: q.id,
    title: q.title,
    prompt: q.prompt_text,
    instruction: q.instruction_text,
    modelAnswer: q.model_answer_text,
    level: q.level,
    topic: q.topic,
    prepTimeSec: q.prep_time_sec,
    answerTimeLimitSec: q.answer_time_limit_sec,
    published: q.is_published,
    submissionCount: q.submission_count,
    mediaUrl: q.media_url,
    moduleName: q.block_name,
  };
}

/** The editor's "only what changed" → the PATCH body. Absent stays absent (left
 * alone server-side); a blank string is passed through, which clears the field. */
export function questionPatchArgs(patch: TaskPatch): UpdateQuestionArgs {
  const out: UpdateQuestionArgs = {};
  if (patch.title !== undefined) out.title = patch.title;
  if (patch.prompt !== undefined) out.prompt_text = patch.prompt;
  if (patch.instruction !== undefined) out.instruction_text = patch.instruction;
  if (patch.modelAnswer !== undefined) out.model_answer_text = patch.modelAnswer;
  if (patch.level !== undefined) out.level = patch.level;
  if (patch.topic !== undefined) out.topic = patch.topic;
  if (patch.prepTimeSec !== undefined) out.prep_time_sec = patch.prepTimeSec;
  if (patch.answerTimeLimitSec !== undefined) out.answer_time_limit_sec = patch.answerTimeLimitSec;
  return out;
}

/** The create form → the POST body. `blockId` is the module the task goes into:
 * the editor's own module in C4, the picker's choice on the Vazifalar tab. */
export function createQuestionArgs(draft: NewTaskDraft, blockId: string | null): CreateQuestionArgs {
  return {
    title: draft.title,
    prompt_text: draft.prompt,
    level: draft.level || null,
    topic: draft.topic || null,
    instruction_text: draft.instruction || null,
    model_answer_text: draft.modelAnswer || null,
    ...(draft.prepTimeSec !== undefined ? { prep_time_sec: draft.prepTimeSec } : {}),
    ...(draft.answerTimeLimitSec !== undefined
      ? { answer_time_limit_sec: draft.answerTimeLimitSec }
      : {}),
    block_id: blockId,
  };
}

/**
 * The machine `code` of a failed request (`{ detail, code }`), or null.
 *
 * Screens branch on this and map it to i18n — the `detail` beside it is English
 * prose for developers and is never shown to a teacher.
 */
export function apiErrorCode(e: unknown): CodedErrorResponse["code"] | null {
  if (!isApiError(e)) return null;
  const body = e.body;
  if (body && typeof body === "object" && "code" in body) {
    // Checked, not trusted: an older API image sends `{ detail }` alone.
    const code: unknown = (body as Partial<Record<keyof CodedErrorResponse, unknown>>).code;
    return typeof code === "string" && code ? code : null;
  }
  return null;
}

/** HTTP status of a failed request, or null for anything that is not an ApiError. */
export function apiErrorStatus(e: unknown): number | null {
  return isApiError(e) ? e.status : null;
}

/**
 * How many DIFFERENT students the teacher reaches across their groups.
 *
 * `GroupResponse.member_count` is per group, so summing it counts a student who
 * sits in two of the same teacher's groups twice. The rosters are the only place
 * the ids live; a group whose roster could not be loaded contributes its count
 * (the one number known for it) rather than silently vanishing from the total.
 */
export function distinctStudentCount(
  groups: GroupResponse[],
  rosters: GroupDetailResponse[],
): number {
  const ids = new Set<string>();
  let unresolved = 0;
  for (const g of groups) {
    const roster = rosters.find((r) => r.id === g.id);
    if (!roster) {
      unresolved += g.member_count;
      continue;
    }
    for (const m of roster.members) ids.add(m.id);
  }
  return ids.size + unresolved;
}

/**
 * Insights `errors[]` → the rows D1's "Ko'p uchragan xatolar" draws. Shared with
 * A5's "Guruh xatolari" so a group's card and Analitika filtered to that group can
 * never disagree about what an error row says.
 *
 * `label` localizes a machine type (`word_order` → "So'z tartibi"); it is passed
 * in because this module stays free of `t`.
 *
 * `remediation` collapses the feature flag into ONE signal: `undefined` when the
 * deployment has it off (no button at all), `null` when it is on but this row has
 * nothing to drill (a disabled button with a reason).
 */
export function errorRowsFromInsights(
  insights: InsightsResponse,
  label: (type: string) => string,
): AnalyticsErrorRow[] {
  return insights.errors.map((e) => ({
    type: e.type,
    label: label(e.type),
    count: e.count,
    studentCount: e.student_count,
    share: e.share,
    remediation: !insights.remediation_enabled
      ? undefined
      : e.remediation
        ? {
            questionId: e.remediation.question_id,
            questionTitle: e.remediation.question_title,
            questionTopic: e.remediation.question_topic,
            questionLevel: e.remediation.question_level,
            students: e.remediation.students.map((s) => ({ id: s.id, fullName: s.full_name })),
          }
        : null,
  }));
}

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
