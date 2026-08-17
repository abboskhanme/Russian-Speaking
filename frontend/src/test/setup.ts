/**
 * Global test setup — runs once per test file before the suite.
 *
 * Three things the suite would otherwise get wrong:
 *
 *   • jsdom ships NO `matchMedia`. `widgets/ThemeToggle/theme.ts` guards on
 *     `!window.matchMedia` and returns "light", so without a stub the OS-preference
 *     branch is never actually exercised and a test of it passes for the wrong
 *     reason. The default here answers "light"; `setSystemDark(true)` flips it.
 *
 *   • jsdom shares ONE `localStorage` per environment instance, so a leftover
 *     `govori-theme` / `govori_access` from one file changes what the next file
 *     observes.
 *
 *   • Testing Library only auto-unmounts when `afterEach` is a global, and this
 *     project runs Vitest WITHOUT `globals` (see vitest.config.ts). Left alone,
 *     every render stacks up in the same `document.body` and `getByRole` starts
 *     finding two of everything.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

/** Drive `prefers-color-scheme` for the current test. */
export function setSystemDark(dark: boolean): void {
  window.matchMedia = vi.fn((query: string) => ({
    matches: dark && query.includes("dark"),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  setSystemDark(false);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});
