/**
 * shared/i18n — i18next + react-i18next bootstrap (docs/08 Faza 4.7).
 *
 * Contract:
 *   • Languages: uz · ru · en. Default AND fallback = `uz` (docs/08 §4.7).
 *   • Language detection is intentionally OFF — the language is an explicit,
 *     app-owned choice (persisted server-side per user in the real product), so
 *     nothing here sniffs the browser / navigator. Call `setLang()` to change it.
 *   • Namespaces: a single `common` ns (every screen's copy, keyed by area, plus
 *     the `units.*` plural sample the tests pin). The full 2085-key extraction
 *     and the namespace split are described in ./README.md.
 *   • Plurals use i18next's built-in CLDR rules (Intl.PluralRules), so Russian
 *     gets one/few/many automatically — e.g. `t("units.points", { count: 2 })`
 *     → «2 балла» (the Faza 4.7 DoD). No i18next-icu needed for this.
 *
 * Resources are bundled JSON (imported statically), so `init()` resolves
 * synchronously and `useTranslation()` works on first render without Suspense.
 */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enCommon from "../../locales/en/common.json";
import ruCommon from "../../locales/ru/common.json";
import uzCommon from "../../locales/uz/common.json";

// DEVELOPMENT-ONLY strings — today, the login page's one-tap demo-account picker.
// They live in their own files rather than in common.json because common.json is
// bundled WHOLE: a key added there ships to production even when the component
// that reads it has been compiled out, and "Faqat development" appearing in a
// production bundle is exactly the trace this feature must not leave. Merged in
// below, behind `import.meta.env.DEV`, which Vite folds to `false` in a
// production build — so these three imports become unreferenced and Rollup drops
// the JSON along with them.
import enDev from "../../locales/en/dev.json";
import ruDev from "../../locales/ru/dev.json";
import uzDev from "../../locales/uz/dev.json";

export const SUPPORTED_LANGS = ["uz", "ru", "en"] as const;
export type AppLang = (typeof SUPPORTED_LANGS)[number];

export const DEFAULT_LANG: AppLang = "uz";
export const FALLBACK_LANG: AppLang = "uz";

/** Localized language names for a language switcher (docs/08 §4.7). */
export const LANG_LABELS: Record<AppLang, string> = {
  uz: "O‘zbekcha",
  ru: "Русский",
  en: "English",
};

export const defaultNS = "common" as const;

/** localStorage key for the user's explicit UI-language choice (Profile). */
const LANG_STORAGE_KEY = "govori_lang";

/** The persisted language if valid, else the default (uz). */
function getInitialLang(): AppLang {
  try {
    const stored = localStorage.getItem(LANG_STORAGE_KEY);
    if (stored && (SUPPORTED_LANGS as readonly string[]).includes(stored)) {
      return stored as AppLang;
    }
  } catch {
    /* localStorage may be unavailable (SSR/private mode) — fall through. */
  }
  return DEFAULT_LANG;
}

export const resources = {
  uz: { common: uzCommon },
  ru: { common: ruCommon },
  en: { common: enCommon },
} as const;

// Guard against double-init under Vite HMR / React StrictMode.
if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources,
    lng: getInitialLang(),
    fallbackLng: FALLBACK_LANG,
    supportedLngs: SUPPORTED_LANGS as unknown as string[],
    ns: [defaultNS],
    defaultNS,
    // No language detector — the choice is explicit (see file header).
    interpolation: { escapeValue: false }, // React already escapes.
    returnNull: false,
    react: { useSuspense: false },
  });
}

// Merge the development-only strings over `common`, in every language. Deep merge
// + overwrite, so this ADDS keys and never disturbs a shipped one. The whole block
// disappears from a production build (see the imports above).
if (import.meta.env.DEV) {
  const devResources: Record<AppLang, object> = { uz: uzDev, ru: ruDev, en: enDev };
  for (const lang of SUPPORTED_LANGS) {
    i18n.addResourceBundle(lang, defaultNS, devResources[lang], true, true);
  }
}

/** Change the active UI language (uz | ru | en) and persist the choice. */
export function setLang(lang: AppLang): void {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    /* ignore persistence failures */
  }
  void i18n.changeLanguage(lang);
}

/** The current UI language, narrowed to a supported code. */
export function getLang(): AppLang {
  const code = i18n.resolvedLanguage ?? i18n.language ?? DEFAULT_LANG;
  return (SUPPORTED_LANGS as readonly string[]).includes(code)
    ? (code as AppLang)
    : DEFAULT_LANG;
}

export default i18n;
