/**
 * i18n — the Russian plural contract (docs/08 Faza 4.7 DoD).
 *
 * WHY THIS IS THE FIRST TEST IN THE REPO. Russian has THREE plural forms where
 * English has two, and the difference is not a rounding error — it is the wrong
 * word. `2 балла` vs `2 баллов` is the same mistake to a compiler and a visible
 * grammatical error to every learner on the platform. Nothing in the toolchain
 * notices: an English-shaped `_one`/`_other` pair in `ru/common.json` type-checks,
 * builds, renders, and is simply wrong for two thirds of the number line.
 *
 * So there are two layers here:
 *   1. concrete counts through the real i18next instance and the real locale
 *      files — including 11 and 21, the two numbers that break a naive
 *      `count === 1 ? singular : plural` and even a naive `n % 10 === 1` rule;
 *   2. a structural sweep over every plural key in `ru`, so a NEW key added with
 *      only `_one` + `_other` fails here rather than shipping.
 *
 * `getFixedT` is used instead of `changeLanguage` so nothing depends on an async
 * language switch settling, and the module-global i18n singleton is left on its
 * default language for other suites.
 */
import { describe, expect, it } from "vitest";
import i18n, { DEFAULT_LANG, SUPPORTED_LANGS, getLang, resources, setLang } from "./index";

const ru = i18n.getFixedT("ru", "common");
const uz = i18n.getFixedT("uz", "common");
const en = i18n.getFixedT("en", "common");

/** `{ a: { b: "x" } }` → `{ "a.b": "x" }`, the shape i18next keys address. */
function flatten(obj: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof obj !== "object" || obj === null) return out;
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof value === "string") out[prefix + key] = value;
    else Object.assign(out, flatten(value, `${prefix}${key}.`));
  }
  return out;
}

describe("Russian plurals", () => {
  it.each([
    [1, "1 балл"],
    [2, "2 балла"],
    [4, "4 балла"],
    [5, "5 баллов"],
    // 11 ends in 1 but is CLDR `many` — the case a `% 10 === 1` rule gets wrong.
    [11, "11 баллов"],
    // ...while 21 is `one` again, which is what breaks a `count === 1` rule.
    [21, "21 балл"],
    [22, "22 балла"],
    [0, "0 баллов"],
  ])("units.points with count %i renders «%s»", (count, expected) => {
    expect(ru("units.points", { count })).toBe(expected);
  });

  it("keeps the same three-form split for a second unit", () => {
    expect(ru("units.minutes", { count: 1 })).toBe("1 минута");
    expect(ru("units.minutes", { count: 3 })).toBe("3 минуты");
    expect(ru("units.minutes", { count: 8 })).toBe("8 минут");
  });

  it("gives every ru plural key all three CLDR forms", () => {
    const keys = new Set(Object.keys(flatten(resources.ru.common)));
    const bases = new Set(
      [...keys]
        .filter((key) => /_(one|few|many|other)$/.test(key))
        .map((key) => key.replace(/_(one|few|many|other)$/, "")),
    );

    // A guard on the guard: were the suffix scan ever to stop matching, the
    // filter below would sweep an empty set and this test would prove nothing.
    expect(bases.size).toBeGreaterThan(10);

    const incomplete = [...bases]
      .filter((base) => !["_one", "_few", "_many"].every((suffix) => keys.has(base + suffix)))
      .sort();
    expect(incomplete).toEqual([]);
  });
});

describe("count-bearing UI strings (audit bug 3: \"1 students\" / \"1 учеников\")", () => {
  it("agrees the student count on Home in every language", () => {
    expect(en("home.students", { count: 1 })).toBe("1 student");
    expect(en("home.students", { count: 12 })).toBe("12 students");
    expect(ru("home.students", { count: 1 })).toBe("1 ученик");
    expect(ru("home.students", { count: 3 })).toBe("3 ученика");
    expect(ru("home.students", { count: 11 })).toBe("11 учеников");
    expect(ru("home.students", { count: 21 })).toBe("21 ученик");
    expect(uz("home.students", { count: 1 })).toContain("1 o");
  });

  it("pluralises the other counted nouns", () => {
    expect(en("results.count", { count: 1 })).toBe("1 result");
    expect(en("progress.skills.trendFlat", { count: 1, weeks: 1 })).toBe("No change in 1 week");
    expect(en("progress.lb.meDeltaUp", { count: 1, n: 1, xp: "10" })).toBe("10 XP · ↑ up 1 place");
    expect(ru("progress.lb.meDeltaUp", { count: 2, n: 2, xp: "10" })).toBe("10 XP · ↑ поднялись на 2 места");
    expect(ru("suhbat.phrasesLabel", { count: 5 })).toBe("5 полезных фраз");
    expect(ru("billing.perDays", { count: 30, days: 30 })).toBe("на 30 дней");
    expect(en("billing.perDays", { count: 1, days: 1 })).toBe("for 1 day");
  });

  it("never resolves a Russian count string from the Uzbek fallback", () => {
    // ru must carry every plural base uz/en carry: otherwise i18next walks to the
    // uz fallback for ru_one and prints Uzbek inside the Russian UI.
    const bases = (lang: "uz" | "ru" | "en") =>
      new Set(
        Object.keys(flatten(resources[lang].common))
          .filter((k) => /_(one|other)$/.test(k))
          .map((k) => k.replace(/_(one|other)$/, "")),
      );
    const ruBases = bases("ru");
    expect([...bases("en")].filter((b) => !ruBases.has(b))).toEqual([]);
    expect([...bases("uz")].filter((b) => !ruBases.has(b))).toEqual([]);
  });
});

describe("other languages", () => {
  it("uses the two-form English split", () => {
    expect(en("units.points", { count: 1 })).toBe("1 point");
    expect(en("units.points", { count: 2 })).toBe("2 points");
    expect(en("units.points", { count: 11 })).toBe("11 points");
  });

  it("keeps the Uzbek noun invariant after a numeral", () => {
    // Uzbek does not inflect the counted noun, so both forms are "ball" on
    // purpose — a reviewer "fixing" this to "ballar" would be introducing a bug.
    expect(uz("units.points", { count: 1 })).toBe("1 ball");
    expect(uz("units.points", { count: 5 })).toBe("5 ball");
  });
});

describe("language selection", () => {
  it("serves an unsupported language out of the uz fallback", () => {
    expect(DEFAULT_LANG).toBe("uz");
    expect(i18n.t("nav.home", { lng: "de" })).toBe(uz("nav.home"));
  });

  it("persists an explicit choice under govori_lang", () => {
    setLang("ru");
    expect(localStorage.getItem("govori_lang")).toBe("ru");
  });

  it("narrows an unsupported active language back to the default", async () => {
    await i18n.changeLanguage("de");
    expect(getLang()).toBe(DEFAULT_LANG);
    await i18n.changeLanguage(DEFAULT_LANG);
  });

  it("resolves every supported language", async () => {
    for (const lang of SUPPORTED_LANGS) {
      await i18n.changeLanguage(lang);
      expect(getLang()).toBe(lang);
    }
    await i18n.changeLanguage(DEFAULT_LANG);
  });
});
