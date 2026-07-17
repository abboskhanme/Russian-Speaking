import type { HTMLAttributes } from "react";
import { cx } from "../utils/cx";
import styles from "./Badge.module.css";

export type BadgeVariant =
  | "neutral"
  | "primary"
  | "accent"
  | "success"
  | "warn"
  | "danger"
  | "info";

export type BadgeSize = "sm" | "md";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
  /** Show a redundant leading status dot (pairs with the text label). */
  dot?: boolean;
}

/**
 * Badge — semantic status label (docs/03 §3.6 Data).
 *
 * The pronunciation scale (§3.3) reuses these same tokens:
 *   good → `success`, mid → `warn`, low → `danger`, neutral → `neutral`.
 * (Per-word pronunciation rendering itself lives in `WordTranscript`, where the
 * colour is paired with an underline style — colour is never the only signal.)
 */
export function Badge({
  variant = "neutral",
  size = "sm",
  dot = false,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cx(styles.badge, styles[variant], styles[size], className)}
      {...props}
    >
      {dot && <span className={styles.dot} aria-hidden />}
      {children}
    </span>
  );
}
