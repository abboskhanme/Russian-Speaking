/**
 * Theme wiring for the Ovoz DS dark-mode contract (docs/03 §3.10, tokens.css §1):
 *
 *   1. No `data-theme`            → light defaults, but the OS `prefers-color-scheme`
 *                                   media query flips to dark automatically.
 *   2. `:root[data-theme="light"]`→ user forced light (wins over the OS).
 *   3. `:root[data-theme="dark"]` → user forced dark  (wins over the OS).
 *
 * So an explicit choice is stored + reflected as `data-theme`; clearing it lets
 * the OS drive again. A manual choice ALWAYS beats the OS preference.
 */

export type ThemeMode = "light" | "dark";

export const THEME_STORAGE_KEY = "govori-theme";

/** The user's explicit choice, or `null` when they're following the OS. */
export function getStoredTheme(): ThemeMode | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

/** The OS `prefers-color-scheme` value (defaults to light when unavailable). */
export function getSystemTheme(): ThemeMode {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** What is actually showing now: explicit choice if any, otherwise the OS. */
export function getEffectiveTheme(): ThemeMode {
  return getStoredTheme() ?? getSystemTheme();
}

/** Reflect a mode onto `<html data-theme>`; `null` clears it (follow the OS). */
export function applyTheme(mode: ThemeMode | null): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (mode) root.setAttribute("data-theme", mode);
  else root.removeAttribute("data-theme");
}

/** Persist an explicit choice; `null` removes it (follow the OS). */
export function storeTheme(mode: ThemeMode | null): void {
  if (typeof window === "undefined") return;
  try {
    if (mode) window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    else window.localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {
    /* ignore private-mode / quota failures */
  }
}
