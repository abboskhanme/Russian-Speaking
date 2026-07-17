import type { HTMLAttributes } from "react";
import { cx } from "../../shared/ui";
import styles from "./Brand.module.css";

export interface BrandProps extends HTMLAttributes<HTMLSpanElement> {
  /** Show only the logo mark (used in the collapsed sidebar). */
  markOnly?: boolean;
}

/**
 * Brand — the govorim logo mark (speech squircle + level bars) and wordmark
 * (docs/03; mark from `RussianDesign/Govori/Govorim - Student.dc.html`).
 * Tokens only — the bubble uses `--primary-on`, the bars `--primary`.
 *
 * The wordmark carries `data-gv-wordmark`; the AppShell sidebar hides it in the
 * icon-only (md) range so only the mark shows.
 */
export function Brand({ markOnly = false, className, ...props }: BrandProps) {
  return (
    <span className={cx(styles.brand, className)} {...props}>
      <span className={styles.mark} aria-hidden>
        <svg viewBox="0 0 100 100" width="100%" height="100%">
          <rect x="18" y="14" width="64" height="56" rx="22" fill="var(--primary-on)" />
          <path d="M30 62 L22 82 L44 72 Z" fill="var(--primary-on)" />
          <g fill="var(--primary)">
            <rect x="36" y="34" width="7" height="14" rx="3.5" />
            <rect x="47" y="28" width="7" height="20" rx="3.5" />
            <rect x="58" y="22" width="7" height="26" rx="3.5" />
          </g>
        </svg>
      </span>
      {!markOnly && (
        <span className={styles.word} data-gv-wordmark>
          govorim
        </span>
      )}
    </span>
  );
}
