import type { HTMLAttributes } from "react";
import { cx } from "../utils/cx";
import styles from "./VisuallyHidden.module.css";

export interface VisuallyHiddenProps extends HTMLAttributes<HTMLSpanElement> {
  /** Render as a different inline element if the semantics require it. */
  as?: "span" | "div" | "label";
}

/**
 * VisuallyHidden — content that is invisible on screen but announced by screen
 * readers. Used for icon-only labels, live-region status text, etc.
 * (docs/03 §3.6 Foundations, §3.9 a11y.)
 */
export function VisuallyHidden({
  as: Tag = "span",
  className,
  ...props
}: VisuallyHiddenProps) {
  return <Tag className={cx(styles.root, className)} {...props} />;
}
