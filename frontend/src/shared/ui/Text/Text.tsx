import type { ElementType, HTMLAttributes } from "react";
import { cx } from "../utils/cx";
import styles from "./Text.module.css";

export type TextVariant =
  | "score"
  | "display"
  | "title-l"
  | "title-m"
  | "title-s"
  | "body-l"
  | "body"
  | "body-s"
  | "label"
  | "mono";

export type TextColor =
  | "ink"
  | "ink-soft"
  | "muted"
  | "faint"
  | "primary"
  | "accent"
  | "success"
  | "warn"
  | "danger"
  | "info";

export type TextWeight =
  | "regular"
  | "medium"
  | "semibold"
  | "bold"
  | "black";

export type TextTag =
  | "p"
  | "span"
  | "div"
  | "label"
  | "strong"
  | "em"
  | "small"
  | "code"
  | "li"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6";

export interface TextProps extends HTMLAttributes<HTMLElement> {
  /** HTML element to render. Choose for semantics (headings, list items…). */
  as?: TextTag;
  variant?: TextVariant;
  color?: TextColor;
  weight?: TextWeight;
  align?: "start" | "center" | "end";
  /** Single-line ellipsis truncation. */
  truncate?: boolean;
  /** `font-variant-numeric: tabular-nums` (scores, XP, streaks — §3.4). */
  numeric?: boolean;
}

const variantClass: Record<TextVariant, string> = {
  score: styles.score,
  display: styles.display,
  "title-l": styles.titleL,
  "title-m": styles.titleM,
  "title-s": styles.titleS,
  "body-l": styles.bodyL,
  body: styles.body,
  "body-s": styles.bodyS,
  label: styles.label,
  mono: styles.mono,
};

const colorClass: Record<TextColor, string> = {
  ink: styles.cInk,
  "ink-soft": styles.cInkSoft,
  muted: styles.cMuted,
  faint: styles.cFaint,
  primary: styles.cPrimary,
  accent: styles.cAccent,
  success: styles.cSuccess,
  warn: styles.cWarn,
  danger: styles.cDanger,
  info: styles.cInfo,
};

const weightClass: Record<TextWeight, string> = {
  regular: styles.wRegular,
  medium: styles.wMedium,
  semibold: styles.wSemibold,
  bold: styles.wBold,
  black: styles.wBlack,
};

const alignClass = {
  start: styles.taStart,
  center: styles.taCenter,
  end: styles.taEnd,
} as const;

/**
 * Text — the single typographic component (docs/03 §3.4).
 * Keeps the "≤ 4 sizes per screen" rule enforceable: every size is a named role.
 */
export function Text({
  as = "p",
  variant = "body",
  color,
  weight,
  align,
  truncate = false,
  numeric = false,
  className,
  ...props
}: TextProps) {
  const Tag = as as ElementType;
  return (
    <Tag
      className={cx(
        styles.text,
        variantClass[variant],
        color && colorClass[color],
        weight && weightClass[weight],
        align && alignClass[align],
        truncate && styles.truncate,
        numeric && styles.numeric,
        className,
      )}
      {...props}
    />
  );
}
