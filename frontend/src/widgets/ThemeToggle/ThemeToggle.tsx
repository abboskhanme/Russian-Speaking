import { useCallback, useEffect, useState } from "react";
import type { ButtonHTMLAttributes, SVGProps } from "react";
import { cx } from "../../shared/ui";
import {
  applyTheme,
  getStoredTheme,
  getSystemTheme,
  storeTheme,
} from "./theme";
import type { ThemeMode } from "./theme";
import styles from "./ThemeToggle.module.css";

export interface ThemeToggleProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  /** Called after each flip with the new mode. */
  onChange?: (mode: ThemeMode) => void;
}

/**
 * ThemeToggle — flips `:root[data-theme]` between light and dark, persisting the
 * choice to `localStorage` and honouring the OS default until the user chooses
 * (docs/03 §3.10). Accessible toggle button: `aria-pressed` reflects dark mode,
 * with a descriptive `aria-label`; the sun/moon icon is decorative.
 */
export function ThemeToggle({ className, onChange, ...props }: ThemeToggleProps) {
  // Light on the server / first paint; synced to the real theme in the effect
  // below (avoids a hydration mismatch and reads `window` safely).
  const [mode, setMode] = useState<ThemeMode>("light");

  useEffect(() => {
    const stored = getStoredTheme();
    // Re-assert a stored choice on mount so a reload keeps the user's theme
    // even without an inline boot script.
    applyTheme(stored);
    setMode(stored ?? getSystemTheme());

    if (!window.matchMedia) return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystem = () => {
      // Track the OS only while the user hasn't made an explicit choice.
      if (!getStoredTheme()) setMode(getSystemTheme());
    };
    mql.addEventListener?.("change", onSystem);
    return () => mql.removeEventListener?.("change", onSystem);
  }, []);

  const toggle = useCallback(() => {
    setMode((prev) => {
      const next: ThemeMode = prev === "dark" ? "light" : "dark";
      applyTheme(next);
      storeTheme(next);
      onChange?.(next);
      return next;
    });
  }, [onChange]);

  const isDark = mode === "dark";
  const label = isDark ? "Yorug' rejimga o'tish" : "Qorong'i rejimga o'tish";

  return (
    <button
      type="button"
      className={cx(styles.toggle, className)}
      onClick={toggle}
      aria-pressed={isDark}
      aria-label={label}
      title={label}
      {...props}
    >
      <span className={styles.icon} aria-hidden>
        {isDark ? <MoonIcon /> : <SunIcon />}
      </span>
    </button>
  );
}

function SunIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" {...props}>
      <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth={1.8} />
      <path
        d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9 5.3 5.3"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" {...props}>
      <path
        d="M20 14.2A8 8 0 0 1 9.8 4 7 7 0 1 0 20 14.2z"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
    </svg>
  );
}
