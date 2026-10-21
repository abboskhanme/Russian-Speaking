/**
 * Every i18n key the admin panel names exists in ALL THREE locales.
 *
 * WHY. The component tests assert through `t()`, and `t()` answers a missing key with
 * the key itself — so a screen printing `admin.role.errLastAdmin` and a test expecting
 * `t("admin.role.errLastAdmin")` agree perfectly, and the suite passes over a raw key on
 * screen. And a missing ru/en key never shows in a uz test at all: the uz fallback
 * quietly answers for it.
 *
 * So this reads the SOURCE of every admin file for literal `t("…")` keys and the locale
 * FILES (not `t()`) for their definitions. A plural key counts as defined when its
 * `_one`/`_other` forms are. Template-literal keys are out of reach here and are kept
 * rare on purpose.
 */
import { describe, expect, it } from "vitest";
import { SUPPORTED_LANGS, resources } from "../../shared/i18n";
// Vite's `?raw`: under Vitest `import.meta.url` is not a `file:` URL, so fs paths off it
// throw (same posture as app/nav.test.ts).
import people from "./AdminPeopleScreen.tsx?raw";
import addTeacher from "./AddTeacherSheet.tsx?raw";
import roleDialog from "./RoleChangeDialog.tsx?raw";
import accounts from "./AdminAccountsList.tsx?raw";
import chrome from "./AdminChrome.tsx?raw";
import content from "./AdminContentExtras.tsx?raw";
import profile from "./AdminProfileScreen.tsx?raw";
import dashboard from "./AdminDashboardScreen.tsx?raw";
import billing from "./AdminBillingScreen.tsx?raw";
import audit from "./AdminAuditScreen.tsx?raw";
import settings from "./AdminSettingsScreen.tsx?raw";
import errors from "./adminErrors.ts?raw";
import navItems from "../../widgets/Nav/navItems.tsx?raw";

const SOURCES: Record<string, string> = {
  AdminPeopleScreen: people,
  AddTeacherSheet: addTeacher,
  RoleChangeDialog: roleDialog,
  AdminAccountsList: accounts,
  AdminChrome: chrome,
  AdminContentExtras: content,
  AdminProfileScreen: profile,
  AdminDashboardScreen: dashboard,
  AdminBillingScreen: billing,
  AdminAuditScreen: audit,
  AdminSettingsScreen: settings,
  adminErrors: errors,
  navItems,
};

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

const keysIn = (src: string) => [...src.matchAll(/\bt\(\s*"([A-Za-z0-9_.]+)"/g)].map(([, key]) => key);

const ALL_KEYS = [...new Set(Object.values(SOURCES).flatMap(keysIn))].sort();

describe("admin locale coverage", () => {
  it("finds the keys it is meant to check, so the sweep is not vacuous", () => {
    expect(ALL_KEYS).toContain("admin.addTeacher");
    expect(ALL_KEYS).toContain("admin.role.errLastAdmin");
    expect(ALL_KEYS).toContain("admin.catalog.emptyTitle");
    expect(ALL_KEYS).toContain("admin.audit.action.secretReveal");
    expect(ALL_KEYS.length).toBeGreaterThan(100);
  });

  it.each(SUPPORTED_LANGS)("defines every admin key in %s", (lang) => {
    const strings = flatten(resources[lang].common);
    const defined = (key: string) =>
      Boolean(strings[key]?.trim()) || Boolean(strings[`${key}_one`]?.trim() && strings[`${key}_other`]?.trim());
    expect(ALL_KEYS.filter((key) => !defined(key))).toEqual([]);
  });

  it("keeps the uz admin copy on the ASCII apostrophe", () => {
    // The admin section mixed ‘ and ' on one screen ("O‘qituvchilar" beside
    // "O'quvchi"). The rest of the uz file uses the ASCII one.
    const uz = flatten(resources.uz.common);
    const curly = Object.entries(uz)
      .filter(([key]) => key.startsWith("admin.") || key.startsWith("nav.admin"))
      .filter(([, value]) => /[‘’ʻ]/.test(value))
      .map(([key]) => key);
    expect(curly).toEqual([]);
  });
});
