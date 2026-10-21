/**
 * cefrLabel — the placement caption follows the UI language, keyed by level.
 *
 * The server's `label_uz` is Uzbek whatever the student reads the app in; printed raw it was the
 * one untranslated phrase on the Russian and English result screens.
 */
import { describe, expect, it } from "vitest";
import i18n from "../../shared/i18n";
import { cefrLabel } from "./cefrLabel";

const LEVELS = ["A1", "A2", "B1", "B2", "C1"] as const;

describe("cefrLabel", () => {
  it.each([
    ["uz", "A2", "boshlang'ich"],
    ["ru", "A2", "элементарный"],
    ["en", "A2", "elementary"],
    ["ru", "B2", "выше среднего"],
    ["en", "C1", "advanced"],
  ])("%s · %s → %s", (lang, level, expected) => {
    expect(cefrLabel(i18n.getFixedT(lang, "common"), level, "label_uz")).toBe(expected);
  });

  it("has a caption for every level in every language — never a raw key", () => {
    for (const lang of ["uz", "ru", "en"]) {
      const t = i18n.getFixedT(lang, "common");
      for (const level of LEVELS) {
        const label = cefrLabel(t, level, "label_uz");
        expect(label).not.toContain("placement.levelLabel");
        expect(label).not.toBe("label_uz");
      }
    }
  });

  it("the Uzbek captions are the server's own label_uz, so uz users see no change", () => {
    // Mirrors Govori.Contracts/CefrScale.FromBand.
    const server: Record<string, string> = {
      A1: "yangi boshlovchi",
      A2: "boshlang'ich",
      B1: "o'rta",
      B2: "o'rta-yuqori",
      C1: "yuqori",
    };
    const t = i18n.getFixedT("uz", "common");
    for (const level of LEVELS) expect(cefrLabel(t, level, "x")).toBe(server[level]);
  });

  it("falls back to the server label for a level it does not know", () => {
    expect(cefrLabel(i18n.getFixedT("ru", "common"), "C2", "mukammal")).toBe("mukammal");
  });
});
