/**
 * shared/format/date — the ONE way a date or time is written on screen.
 *
 *  - absolute:   `21.10.2026` and `21.10.2026, 14:37` (24-hour, every language)
 *  - day+month:  `21-oktabr` / `21 октября` / `Oct 21` (deadlines, "when" lines)
 *  - month+year: `2026-yil oktabr` / `октябрь 2026` / `October 2026`
 *  - relative:   `1 soat oldin` / `1 час назад` / `1 hour ago` (i18next plurals)
 *
 * **No `Intl.DateTimeFormat` / `Intl.RelativeTimeFormat` anywhere.** Chromium and
 * iOS Safari ship a REDUCED ICU: `uz` is "supported" but carries no Uzbek data, so
 * `{ month: "long" }` renders `"M10"` and relative time falls back to `"-2 h"` or
 * English. Node has full ICU, so it only breaks in a real browser — and Uzbek is
 * the default language. Numbers are therefore assembled by hand and month names
 * come from the hard-coded table below, which is identical on every engine.
 *
 * Time zone: `zone: "local"` (default) reads the device clock; `zone: "tashkent"`
 * reads Asia/Tashkent wall-clock — the zone the product's "days" are cut in
 * (audit filters, AI budget day, billing). Tashkent is a fixed UTC+5 with no DST
 * since 1992, so it is a plain offset — again no ICU time-zone data needed.
 */

export type DateLang = "uz" | "ru" | "en";
export type DateZone = "local" | "tashkent";
export type DateInput = string | number | Date | null | undefined;

export interface DateOptions {
  zone?: DateZone;
}

/** i18next language → one of the three product languages (Uzbek by default). */
export function dateLang(lang: string | undefined | null): DateLang {
  const base = (lang ?? "").toLowerCase().slice(0, 2);
  return base === "ru" || base === "en" ? base : "uz";
}

const TASHKENT_OFFSET_MS = 5 * 3_600_000;

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Calendar pieces of an instant in the chosen zone. `month` is 1–12. */
export interface CalendarParts {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
}

export function calendarParts(value: DateInput, opts: DateOptions = {}): CalendarParts | null {
  const d = toDate(value);
  if (!d) return null;
  if (opts.zone === "tashkent") {
    const t = new Date(d.getTime() + TASHKENT_OFFSET_MS);
    return {
      year: t.getUTCFullYear(),
      month: t.getUTCMonth() + 1,
      day: t.getUTCDate(),
      hours: t.getUTCHours(),
      minutes: t.getUTCMinutes(),
    };
  }
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    hours: d.getHours(),
    minutes: d.getMinutes(),
  };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** `21.10.2026`; "" for a missing/unparseable value. */
export function formatDate(value: DateInput, opts: DateOptions = {}): string {
  const p = calendarParts(value, opts);
  return p ? `${pad2(p.day)}.${pad2(p.month)}.${p.year}` : "";
}

/** `14:37` (24-hour); "" for a missing/unparseable value. */
export function formatTime(value: DateInput, opts: DateOptions = {}): string {
  const p = calendarParts(value, opts);
  return p ? `${pad2(p.hours)}:${pad2(p.minutes)}` : "";
}

/** `21.10.2026, 14:37`; "" for a missing/unparseable value. */
export function formatDateTime(value: DateInput, opts: DateOptions = {}): string {
  const p = calendarParts(value, opts);
  return p ? `${formatDate(value, opts)}, ${pad2(p.hours)}:${pad2(p.minutes)}` : "";
}

/* -------------------------------------------------------------------------- */
/* Month names                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Hard-coded on purpose (see the header): the browser's ICU has no Uzbek months.
 * Uzbek uses the official Latin spellings, lower-case as in running text.
 * Russian needs the nominative on its own ("октябрь 2026") and the genitive after
 * a day number ("21 октября").
 */
const MONTHS: Record<"uz" | "ru" | "ruOf" | "en" | "enShort", readonly string[]> = {
  uz: ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"],
  ru: ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"],
  ruOf: ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  enShort: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};

export type MonthForm = "standalone" | "afterDay";

/** Month name for 1–12. `afterDay` = the form used right after a day number. */
export function monthName(month: number, lang: DateLang, form: MonthForm = "standalone"): string {
  const i = Math.min(12, Math.max(1, Math.round(month))) - 1;
  if (lang === "ru") return (form === "afterDay" ? MONTHS.ruOf : MONTHS.ru)[i];
  if (lang === "en") return (form === "afterDay" ? MONTHS.enShort : MONTHS.en)[i];
  return MONTHS.uz[i];
}

const capitalize = (s: string) => (s ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s);

/**
 * `2026-yil oktabr` / `октябрь 2026` / `October 2026`. `capitalize` upper-cases
 * the first letter for a heading or axis label ("Октябрь 2026").
 */
export function formatMonthYear(
  value: DateInput,
  lang: DateLang,
  opts: DateOptions & { capitalize?: boolean } = {},
): string {
  const p = calendarParts(value, opts);
  if (!p) return "";
  const m = monthName(p.month, lang);
  const out = lang === "uz" ? `${p.year}-yil ${m}` : `${m} ${p.year}`;
  return opts.capitalize ? capitalize(out) : out;
}

/**
 * `21-oktabr` / `21 октября` / `Oct 21`; with `withTime`: `21-oktabr, 14:37`.
 */
export function formatDayMonth(
  value: DateInput,
  lang: DateLang,
  opts: DateOptions & { withTime?: boolean } = {},
): string {
  const p = calendarParts(value, opts);
  if (!p) return "";
  const m = monthName(p.month, lang, "afterDay");
  const date = lang === "uz" ? `${p.day}-${m}` : lang === "ru" ? `${p.day} ${m}` : `${m} ${p.day}`;
  return opts.withTime ? `${date}, ${pad2(p.hours)}:${pad2(p.minutes)}` : date;
}

/* -------------------------------------------------------------------------- */
/* Relative                                                                   */
/* -------------------------------------------------------------------------- */

type TFn = (key: string, opts?: Record<string, unknown>) => string;

/** An i18n key plus its `count`, ready for `t(key, { count })`. */
export interface RelativeTime {
  key: string;
  count: number;
}

/**
 * An instant → the `time.*` key + count for "2 soat oldin". A descriptor rather
 * than a string so it stays pure; {@link formatRelative} localises it.
 * Russian one/few/many comes from i18next's CLDR plural rules.
 */
export function relativeTime(value: DateInput, now: Date = new Date()): RelativeTime {
  const d = toDate(value);
  if (!d) return { key: "time.justNow", count: 0 };
  const seconds = Math.max(0, Math.round((now.getTime() - d.getTime()) / 1000));
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
      if (key === "time.daysAgo" && count === 1) return { key: "time.yesterday", count: 1 };
      return { key, count };
    }
  }
  return { key: "time.justNow", count: 0 };
}

/** "2 soat oldin" / "2 часа назад" / "2 hours ago". */
export function formatRelative(value: DateInput, t: TFn, now: Date = new Date()): string {
  const r = relativeTime(value, now);
  return t(r.key, { count: r.count });
}

/** Whole calendar days from `from` to `to`, by day boundary in the zone (DST-safe). */
export function calendarDaysBetween(from: DateInput, to: DateInput, opts: DateOptions = {}): number {
  const a = calendarParts(from, opts);
  const b = calendarParts(to, opts);
  if (!a || !b) return Number.NaN;
  const ta = Date.UTC(a.year, a.month - 1, a.day);
  const tb = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((tb - ta) / 86_400_000);
}

/**
 * Day-granular relative label for lists: "Bugun" / "Kecha" / "3 kun oldin" /
 * "2 hafta oldin", and past ~a month the absolute `21.10.2026` (a "14 hafta oldin"
 * makes the reader do arithmetic). "" for an unparseable value.
 */
export function formatRelativeDay(
  value: DateInput,
  t: TFn,
  now: Date = new Date(),
  opts: DateOptions = {},
): string {
  const days = calendarDaysBetween(value, now, opts);
  if (Number.isNaN(days)) return "";
  // Clock skew can put a fresh row marginally in the future — still today.
  if (days <= 0) return t("profile.relativeDate.today");
  if (days === 1) return t("profile.relativeDate.yesterday");
  if (days < 7) return t("profile.relativeDate.daysAgo", { count: days });
  if (days < 35) return t("profile.relativeDate.weeksAgo", { count: Math.floor(days / 7) });
  return formatDate(value, opts);
}
