/**
 * ThemeToggle/theme — the dark-mode precedence contract (docs/03 §3.10).
 *
 * The rule that matters: an EXPLICIT choice always beats the OS. It is easy to
 * break in a way nothing catches — the CSS defines `:root[data-theme="dark"]`
 * *and* a `prefers-color-scheme` media query, so a regression where the stored
 * choice stops being reflected still renders a perfectly valid-looking page; it
 * is just the wrong one for anyone whose OS disagrees with them.
 *
 * The headless screenshot recipe depends on `govori-theme` specifically: it pins
 * the theme by writing that key, so a rename silently makes every "dark mode"
 * screenshot a second light-mode one.
 */
import { describe, expect, it } from "vitest";
import { setSystemDark } from "../../test/setup";
import {
  THEME_STORAGE_KEY,
  applyTheme,
  getEffectiveTheme,
  getStoredTheme,
  getSystemTheme,
  storeTheme,
} from "./theme";

describe("getStoredTheme", () => {
  it("reads back a stored choice", () => {
    storeTheme("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(getStoredTheme()).toBe("dark");
  });

  it("is null when the user follows the OS", () => {
    expect(getStoredTheme()).toBeNull();
    storeTheme("dark");
    storeTheme(null);
    expect(getStoredTheme()).toBeNull();
  });

  it("ignores a junk value rather than stamping it on <html>", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "solarized");
    expect(getStoredTheme()).toBeNull();
  });
});

describe("getSystemTheme", () => {
  it("follows prefers-color-scheme", () => {
    expect(getSystemTheme()).toBe("light");
    setSystemDark(true);
    expect(getSystemTheme()).toBe("dark");
  });
});

describe("getEffectiveTheme", () => {
  it("lets an explicit choice win over the OS in BOTH directions", () => {
    setSystemDark(true);
    storeTheme("light");
    expect(getEffectiveTheme()).toBe("light");

    setSystemDark(false);
    storeTheme("dark");
    expect(getEffectiveTheme()).toBe("dark");
  });

  it("falls back to the OS once the choice is cleared", () => {
    setSystemDark(true);
    storeTheme("light");
    storeTheme(null);
    expect(getEffectiveTheme()).toBe("dark");
  });
});

describe("applyTheme", () => {
  it("stamps and clears data-theme on the root element", () => {
    applyTheme("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    applyTheme("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    applyTheme(null);
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
});
