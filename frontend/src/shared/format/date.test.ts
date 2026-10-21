import { describe, expect, it } from "vitest";
import i18n from "../i18n";
import {
  calendarDaysBetween,
  dateLang,
  formatDate,
  formatDateTime,
  formatDayMonth,
  formatMonthYear,
  formatRelative,
  formatRelativeDay,
  formatTime,
  monthName,
  relativeTime,
} from "./date";

/** A LOCAL wall-clock instant, so "local" assertions hold in any TZ the CI runs in. */
const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi);

describe("absolute formats", () => {
  it("writes dd.MM.yyyy and a 24-hour clock", () => {
    const d = local(2026, 3, 5, 9, 7);
    expect(formatDate(d)).toBe("05.03.2026");
    expect(formatTime(local(2026, 3, 5, 21, 30))).toBe("21:30");
    expect(formatDateTime(d)).toBe("05.03.2026, 09:07");
  });

  it("reads Tashkent wall-clock (UTC+5) across midnight", () => {
    expect(formatDateTime("2026-10-20T21:30:00Z", { zone: "tashkent" })).toBe("21.10.2026, 02:30");
    expect(formatDate("2026-12-31T19:00:00Z", { zone: "tashkent" })).toBe("01.01.2027");
  });

  it("returns empty for missing or unparseable input", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDate("")).toBe("");
    expect(formatDateTime("not-a-date")).toBe("");
  });
});

describe("month names", () => {
  it("uses real Uzbek / Russian / English names, never ICU's 'M10'", () => {
    expect(monthName(10, "uz")).toBe("oktabr");
    expect(monthName(10, "ru")).toBe("октябрь");
    expect(monthName(10, "ru", "afterDay")).toBe("октября");
    expect(monthName(10, "en")).toBe("October");
  });

  it("formats month + year per language", () => {
    const d = local(2026, 7, 15);
    expect(formatMonthYear(d, "uz")).toBe("2026-yil iyul");
    expect(formatMonthYear(d, "ru")).toBe("июль 2026");
    expect(formatMonthYear(d, "ru", { capitalize: true })).toBe("Июль 2026");
    expect(formatMonthYear(d, "en")).toBe("July 2026");
  });

  it("formats day + month per language", () => {
    const d = local(2026, 7, 30, 21, 0);
    expect(formatDayMonth(d, "uz")).toBe("30-iyul");
    expect(formatDayMonth(d, "ru")).toBe("30 июля");
    expect(formatDayMonth(d, "en", { withTime: true })).toBe("Jul 30, 21:00");
  });

  it("maps i18next languages to the product's three", () => {
    expect(dateLang("ru-RU")).toBe("ru");
    expect(dateLang("en")).toBe("en");
    expect(dateLang("uz-Latn")).toBe("uz");
    expect(dateLang(undefined)).toBe("uz");
  });
});

describe("relative", () => {
  const NOW = new Date("2026-10-21T12:00:00Z");
  const ago = (s: number) => new Date(NOW.getTime() - s * 1000).toISOString();

  it("picks the largest unit", () => {
    expect(relativeTime(ago(30), NOW)).toEqual({ key: "time.justNow", count: 0 });
    expect(relativeTime(ago(3600), NOW)).toEqual({ key: "time.hoursAgo", count: 1 });
    expect(relativeTime(ago(86_400), NOW)).toEqual({ key: "time.yesterday", count: 1 });
  });

  it("localises with correct plurals in all three languages", async () => {
    const t = i18n.getFixedT.bind(i18n);
    expect(formatRelative(ago(3600), t("uz"), NOW)).toBe("1 soat oldin");
    expect(formatRelative(ago(3600), t("ru"), NOW)).toBe("1 час назад");
    expect(formatRelative(ago(3 * 3600), t("ru"), NOW)).toBe("3 часа назад");
    expect(formatRelative(ago(5 * 3600), t("ru"), NOW)).toBe("5 часов назад");
    expect(formatRelative(ago(3600), t("en"), NOW)).toBe("1 hour ago");
    expect(formatRelative(ago(2 * 3600), t("en"), NOW)).toBe("2 hours ago");
  });

  it("counts calendar days, not 24h blocks", () => {
    expect(calendarDaysBetween(local(2026, 10, 20, 23, 0), local(2026, 10, 21, 1, 0))).toBe(1);
    expect(calendarDaysBetween("2026-10-20T18:59:00Z", "2026-10-20T19:01:00Z", { zone: "tashkent" })).toBe(1);
  });

  it("day labels fall back to the absolute date past a month", () => {
    const t = i18n.getFixedT("en");
    const now = local(2026, 10, 21, 12);
    expect(formatRelativeDay(local(2026, 10, 21, 8), t, now)).toBe("Today");
    expect(formatRelativeDay(local(2026, 10, 20, 23), t, now)).toBe("Yesterday");
    expect(formatRelativeDay(local(2026, 10, 18), t, now)).toBe("3 days ago");
    expect(formatRelativeDay(local(2026, 10, 7), t, now)).toBe("2 weeks ago");
    expect(formatRelativeDay(local(2026, 8, 1), t, now)).toBe("01.08.2026");
    expect(formatRelativeDay("nope", t, now)).toBe("");
  });
});
