import { forwardRef } from "react";
import type { HTMLAttributes } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cx } from "../utils/cx";
import styles from "./Card.module.css";

export type CardVariant = "flat" | "raised" | "outline" | "tint";
export type CardPadding = "none" | "sm" | "md" | "lg";

const padClass: Record<CardPadding, string> = {
  none: styles["pad-none"],
  sm: styles["pad-sm"],
  md: styles["pad-md"],
  lg: styles["pad-lg"],
};

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  padding?: CardPadding;
  /**
   * Add hover/press affordances + a focus ring. Combine with `asChild` to make
   * the whole card a real `<button>`/`<a>` so it is keyboard-operable.
   */
  interactive?: boolean;
  /** Render onto the single child element (Radix Slot) instead of a `<div>`. */
  asChild?: boolean;
}

/**
 * Card — surface container (docs/03 §3.6 Containment).
 * Presentational; for a clickable card pass `interactive` + `asChild` wrapping
 * a `<button>`/`<a>` rather than putting onClick on a bare div (a11y).
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  {
    variant = "raised",
    padding = "md",
    interactive = false,
    asChild = false,
    className,
    ...props
  },
  ref,
) {
  const classes = cx(
    styles.card,
    styles[variant],
    padClass[padding],
    interactive && styles.interactive,
    className,
  );

  if (asChild) {
    return (
      <Slot ref={ref} className={classes} {...props} />
    );
  }

  return <div ref={ref} className={classes} {...props} />;
});
