import type { HTMLAttributes } from "react";
import { cx } from "../utils/cx";
import { VisuallyHidden } from "../VisuallyHidden/VisuallyHidden";
import styles from "./Spinner.module.css";

export type SpinnerSize = "sm" | "md" | "lg";

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  size?: SpinnerSize;
  /**
   * Screen-reader label. Announced via `role="status"`. Pass an empty string
   * when the spinner is decorative (e.g. already inside a labelled button) —
   * the whole element is then hidden from assistive tech.
   */
  label?: string;
}

/**
 * Spinner — loading primitive (docs/03 §3.6 Feedback).
 * Inherits colour from `currentColor`; respects `prefers-reduced-motion`.
 */
export function Spinner({
  size = "md",
  label = "Yuklanmoqda…",
  className,
  ...props
}: SpinnerProps) {
  const decorative = label.length === 0;
  return (
    <span
      className={cx(styles.root, styles[size], className)}
      role={decorative ? undefined : "status"}
      aria-hidden={decorative ? true : undefined}
      {...props}
    >
      {!decorative && <VisuallyHidden>{label}</VisuallyHidden>}
    </span>
  );
}
