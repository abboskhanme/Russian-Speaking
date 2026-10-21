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

/** An i18n key plus its `count`, ready for `t(key, { count })`. */
export interface RelativeTime {
  key: string;
  count: number;
}

/**
 * An ISO timestamp → the `time.*` i18n key + count for "2 soat oldin".
 *
 * **Not `Intl.RelativeTimeFormat`.** Chromium ships a REDUCED ICU: `uz` passes
 * `supportedLocalesOf` and `resolvedOptions().locale` reports `"uz"`, but it
 * carries no Uzbek relative-time data — `format(-2, "hour")` renders `"-2 h"`
 * and `format(0, "minute")` silently falls back to English `"this minute"`.
 * Node has full ICU and formats it correctly, so this only shows up in a real
 * browser. Uzbek is the DEFAULT language here, so that is the main path, not an
 * edge case. Going through i18next instead also gets Russian's one/few/many for
 * free from the CLDR plural rules already in use.
 *
 * Returns a descriptor rather than a string so this stays a pure adapter (no
 * `t`, per this module's contract) — the page localizes it.
 *
 * @param now injectable clock, so callers can render deterministically in tests
 */
export function relativeTime(iso: string, now: Date = new Date()): RelativeTime {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return { key: "time.justNow", count: 0 };

  const seconds = Math.max(0, Math.round((now.getTime() - then) / 1000));

  // Largest unit that fits, so "2 soat oldin" wins over "120 daqiqa oldin".
  const units: [string, number][] = [
    ["time.yearsAgo", 31_536_000],
    ["time.monthsAgo", 2_592_000],
    ["time.weeksAgo", 604_800],
    ["time.daysAgo", 86_400],
    ["time.hoursAgo", 3_600],
    ["time.minutesAgo", 60],
  ];

  for (const [key, size] of units) {
    const count = Math.floor(seconds / size);
    if (count >= 1) {
      // "kecha" reads better than "1 kun oldin" — the one special case the
      // mockup's own copy uses.
      if (key === "time.daysAgo" && count === 1) return { key: "time.yesterday", count: 1 };
      return { key, count };
    }
  }
  return { key: "time.justNow", count: 0 };
}

/** Calendar pieces of a timestamp, in LOCAL time, for i18n composition. */
export interface DateParts {
  day: number;
  /** 1–12, matching the `time.month1` … `time.month12` keys. */
  month: number;
  year: number;
  /** Zero-padded 24h clock, e.g. "21:00". */
  time: string;
}

/**
 * Split an ISO timestamp into the pieces a localized date string needs.
 *
 * **Not `Intl.DateTimeFormat` for the month name.** Same reduced-ICU trap as
 * {@link relativeTime}: Chromium has no Uzbek month names, so
 * `{ month: "long" }` renders `"2026 M07"` and `{ month: "short" }` renders
 * `"M07 30"`. Node's full ICU formats both correctly, so it looks fine until it
 * reaches a browser. Month names therefore come from `time.month*` keys and the
 * ORDER comes from a per-language pattern (`time.dayMonthTime` / `time.monthYear`)
 * — Uzbek writes "30-iyul", English "Jul 30".
 *
 * Returns null for an unparseable input so callers can omit the line entirely.
 */
export function dateParts(iso: string): DateParts | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    day: d.getDate(),
    month: d.getMonth() + 1,
    year: d.getFullYear(),
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/**
 * "30-iyul" / "30 июля" / "Jul 30" (with `withTime`: "30-iyul 21:00" …) — a day and
 * month in the active language, for deadlines and "when" lines.
 *
 * The month comes from `time.monthOf*`, not `time.month*`: Russian needs the
 * GENITIVE after a day number ("30 июля", never "30 июль"), while the nominative
 * `time.month*` stays right for a month on its own ("Июль 2026", a chart axis).
 * Uzbek and English have one form, so their `monthOf*` repeat it (English short).
 */
export function formatDayMonth(
  iso: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
  withTime = false,
): string {
  const p = dateParts(iso);
  if (!p) return "";
  const month = t(`time.monthOf${p.month}`);
  return withTime
    ? t("time.dayMonthTime", { day: p.day, month, time: p.time })
    : t("time.dayMonth", { day: p.day, month });
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
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    const fb: AiFeedback = {
      summary: typeof o.summary === "string" ? o.summary : "",
      strengths: strs(o.strengths),
      improvements: strs(o.improvements),
      vocabulary: strs(o.vocabulary_suggestions),
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
