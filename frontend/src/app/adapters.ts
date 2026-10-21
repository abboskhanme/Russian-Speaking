/**
 * app/adapters — pure snake_case-API → screen-prop mappers (docs/08 auth slice,
 * priority #5). No React, no i18n (labels that need `t` are built in the pages);
 * these just reshape the wire DTOs into the presentational screens' contracts.
 */
import type { AdminAiBudget } from "../screens/admin/AiBudgetCard";
import type {
  AiBudgetResponse,
  LeaderboardEntryResponse,
  PlanResponse,
  StudentModuleResponse,
  StudentTaskResponse,
} from "../shared/api";

/** "Aziz Karimov" → "Aziz" (the warm first-name greeting). */
export function firstName(fullName: string): string {
  const trimmed = (fullName ?? "").trim();
  if (!trimmed) return "";
  return trimmed.split(/\s+/)[0];
}

export function clampPct(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function moduleProgressPct(m: StudentModuleResponse): number {
  return m.total > 0 ? clampPct((m.done_count / m.total) * 100) : 0;
}

export interface PracticeTarget {
  module: StudentModuleResponse;
  task: StudentTaskResponse;
  /** 1-based index of this task within its module (for progress pips). */
  index: number;
}

/**
 * Resolve which task Practice should present: the one matching `taskId` when
 * given (a module row, an assignment, the daily step, a skip), else the first
 * actionable task across all modules (a `next_task_id` that is not locked).
 * Returns null when nothing is reachable (empty/all-locked catalogue).
 *
 * **An explicit id that is not in the catalogue resolves to null — never to some
 * other task.** It used to fall back to the first open task, which meant a
 * teacher's assignment whose task was unpublished (or a stale link) silently put
 * a DIFFERENT question in front of the student, who then answered it believing
 * they had done their homework. The caller now says "this task is not available"
 * instead; a wrong question is worse than no question.
 */
export function pickPracticeTarget(
  modules: StudentModuleResponse[],
  taskId?: string | null,
): PracticeTarget | null {
  if (taskId) {
    for (const m of modules) {
      const idx = m.tasks.findIndex((tk) => tk.id === taskId);
      if (idx >= 0) return { module: m, task: m.tasks[idx], index: idx + 1 };
    }
    return null;
  }
  for (const m of modules) {
    if (!m.next_task_id) continue;
    const idx = m.tasks.findIndex((tk) => tk.id === m.next_task_id);
    if (idx >= 0) return { module: m, task: m.tasks[idx], index: idx + 1 };
  }
  return null;
}

/** A task the student can answer right now: not done, and behind neither lock.
 * The same three conditions the server uses to pick a module's `next_task_id`. */
function isOpen(task: StudentTaskResponse): boolean {
  return !task.done && !task.locked && !task.premium_locked;
}

/**
 * The next OPEN task after `currentTaskId`, in catalogue order (modules as the
 * server lists them, tasks in their module order), wrapping round to the start —
 * what "O'tkazib yuborish" and "Keyingi vazifa" move to. Never the current task:
 * skipping used to reload the very task being skipped. Null when no other open
 * task exists, so the caller can hide the action instead of offering a no-op.
 *
 * A current id the catalogue does not list (it was just finished and dropped, or
 * never there) starts the search from the beginning.
 */
export function nextOpenTarget(
  modules: StudentModuleResponse[],
  currentTaskId?: string | null,
): PracticeTarget | null {
  const flat: PracticeTarget[] = modules.flatMap((m) =>
    m.tasks.map((task, i) => ({ module: m, task, index: i + 1 })),
  );
  const start = flat.findIndex((x) => x.task.id === currentTaskId);
  for (let step = 1; step <= flat.length; step++) {
    const candidate = flat[(start + step + flat.length) % flat.length];
    if (candidate.task.id !== currentTaskId && isOpen(candidate.task)) return candidate;
  }
  return null;
}

/** The grading-failure codes the backend writes to `submissions.error_message`. */
const KNOWN_FAILURES = [
  "grading_timeout",
  "stt_failed",
  "grader_failed",
  // The platform-wide AI budget is paused or spent: "try again later", not "it broke".
  "ai_unavailable",
  // STT heard no words (silence / muted mic): nothing was sent to the grader.
  "no_speech",
  "internal",
];

/**
 * A grading-failure machine code → its `results.failure.*` i18n key.
 *
 * `error_message` is a CODE, never prose: the raw value must not reach the screen
 * (it used to — as an English exception message). Anything that is not one of the
 * known codes — rows failed before the codes existed still hold free text, and a
 * newer backend may add codes — reads as `internal`, the generic failure, rather
 * than as a raw key or an empty line.
 */
export function gradingFailureKey(code?: string | null): string {
  return code && KNOWN_FAILURES.includes(code)
    ? `results.failure.${code}`
    : "results.failure.internal";
}

/**
 * The cheapest active MONTHLY plan (28–31 days), for the Profile's "…dan boshlab"
 * price line — or null when none is on offer, and the card then shows no price.
 * A yearly plan is never used: its per-year figure next to "oyiga" would be a
 * number nobody is charged, and dividing it into a monthly one would be a price
 * no plan actually has.
 */
export function cheapestMonthlyPlan(plans: PlanResponse[]): PlanResponse | null {
  const monthly = plans.filter(
    (p) => p.is_active && p.duration_days >= 28 && p.duration_days <= 31 && p.price_minor > 0,
  );
  if (monthly.length === 0) return null;
  return monthly.reduce((min, p) => (p.price_minor < min.price_minor ? p : min));
}

/** The current user's own leaderboard row (real XP + streak), or null. */
export function myLeaderboardRow(
  rows: LeaderboardEntryResponse[],
): LeaderboardEntryResponse | null {
  return rows.find((r) => r.is_me) ?? null;
}

/* ── AI feedback / corrections: stored as JSON, not prose ─────────────────── */

/**
 * The grader's structured feedback (`evaluations.feedback`).
 * Mirrors `GraderResult` in `Govori.Platform/Grader/IGraderProvider.cs`.
 */
export interface AiFeedback {
  summary: string;
  strengths: string[];
  improvements: string[];
  vocabulary: string[];
  /**
   * The language the grader was asked to write in (`feedback.lang`, S9). Rows
   * graded before S9 carry none and were all written in Uzbek, so the parser
   * fills `uz`; plain-text legacy rows leave it undefined (unknown).
   */
  lang?: "uz" | "ru" | "en";
}

/**
 * Model "nothing here" placeholders that must never render as a bullet
 * ("None", "N/A", "-", "нет", "yoʻq"…). The backend drops them at grading time
 * (`FeedbackText`); this is the defensive copy for rows stored before that.
 */
const PLACEHOLDER_ITEMS = new Set([
  "none", "n/a", "na", "-", "--", "—", "–", "null", "nil", "nothing", "no", "empty",
  "нет", "ничего", "отсутствует", "отсутствуют",
  "yoʻq", "yo'q", "yo‘q", "yo`q", "yok", "hech narsa", "mavjud emas",
]);

/** True when a feedback list item is blank or only a placeholder like "None". */
export function isPlaceholderItem(item: string): boolean {
  const core = item.trim().replace(/[.!\s]+$/u, "").trim().toLowerCase();
  return core.length === 0 || PLACEHOLDER_ITEMS.has(core);
}

/** One targeted correction (`evaluations.corrections`). */
export interface AiCorrection {
  original: string;
  corrected: string;
  /** Grader's category, e.g. "word_order" | "grammar". */
  type: string;
  explanation: string;
}

/**
 * Parse `AttemptDetailResponse.feedback`.
 *
 * **The column holds JSON, not prose.** The assessment pipeline serializes a whole
 * `GraderResult` into it (`{summary, strengths, improvements, orthoepy_errors,
 * vocabulary_suggestions}`), so rendering the field directly puts a raw JSON blob
 * in front of the reader — which is what both this screen and the student's own
 * result screen were doing.
 *
 * Returns null when there is nothing usable, so callers can hide the section
 * rather than show an empty shell. A non-JSON value is treated as plain prose,
 * which keeps any legacy row that really did store text readable.
 */
export function parseFeedback(raw?: string | null): AiFeedback | null {
  if (!raw || !raw.trim()) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (typeof o !== "object" || o === null) return { summary: raw, strengths: [], improvements: [], vocabulary: [] };
    const strs = (v: unknown): string[] =>
      Array.isArray(v)
        ? v
            .filter((x): x is string => typeof x === "string")
            .filter((x) => !isPlaceholderItem(x))
            .map((x) => x.trim())
        : [];
    const fb: AiFeedback = {
      summary: typeof o.summary === "string" ? o.summary : "",
      strengths: strs(o.strengths),
      improvements: strs(o.improvements),
      vocabulary: strs(o.vocabulary_suggestions),
      lang: o.lang === "ru" || o.lang === "en" ? o.lang : "uz",
    };
    const empty =
      !fb.summary && !fb.strengths.length && !fb.improvements.length && !fb.vocabulary.length;
    return empty ? null : fb;
  } catch {
    // Legacy/plain text — show it as the summary rather than dropping it.
    return { summary: raw, strengths: [], improvements: [], vocabulary: [] };
  }
}

/**
 * Parse `AttemptDetailResponse.corrections` — a JSON array of
 * `{original, corrected, type, explanation}`. Same reasoning as
 * {@link parseFeedback}: the column is JSON, so it must never be printed as-is.
 *
 * Returns an empty array for absent or unparseable data; entries missing both
 * `original` and `corrected` are dropped, since a correction with neither side
 * tells the reader nothing.
 */
export function parseCorrections(raw?: string | null): AiCorrection[] {
  if (!raw || !raw.trim()) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((x): AiCorrection => {
        const o = (x ?? {}) as Record<string, unknown>;
        return {
          original: typeof o.original === "string" ? o.original : "",
          corrected: typeof o.corrected === "string" ? o.corrected : "",
          type: typeof o.type === "string" ? o.type : "",
          explanation: typeof o.explanation === "string" ? o.explanation : "",
        };
      })
      .filter((c) => c.original || c.corrected);
  } catch {
    return [];
  }
}

/** `GET /api/admin/settings/ai-budget` → the AI budget card's props. */
export function toAdminAiBudget(b: AiBudgetResponse): AdminAiBudget {
  return {
    paused: b.ai_paused,
    dailyCapUsd: b.daily_cap_usd,
    monthlyCapUsd: b.monthly_cap_usd,
    spentTodayUsd: b.spent_today_usd,
    spentMonthUsd: b.spent_month_usd,
    state: b.state,
    day: b.day,
    month: b.month.map((l) => ({
      provider: l.provider,
      operation: l.operation,
      calls: l.calls,
      failedCalls: l.failed_calls,
      costUsd: l.cost_usd,
    })),
  };
}
