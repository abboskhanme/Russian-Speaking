/**
 * app/adapters — pure snake_case-API → screen-prop mappers (docs/08 auth slice,
 * priority #5). No React, no i18n (labels that need `t` are built in the pages);
 * these just reshape the wire DTOs into the presentational screens' contracts.
 */
import type {
  LeaderboardEntryResponse,
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
 * given (Home "Continue"/module-open passes `next_task_id`), else the first
 * actionable task across all modules (a `next_task_id` that is not locked).
 * Returns null when nothing is reachable (empty/all-locked catalogue).
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
  }
  for (const m of modules) {
    if (!m.next_task_id) continue;
    const idx = m.tasks.findIndex((tk) => tk.id === m.next_task_id);
    if (idx >= 0) return { module: m, task: m.tasks[idx], index: idx + 1 };
  }
  return null;
}

/** The current user's own leaderboard row (real XP + streak), or null. */
export function myLeaderboardRow(
  rows: LeaderboardEntryResponse[],
): LeaderboardEntryResponse | null {
  return rows.find((r) => r.is_me) ?? null;
}
