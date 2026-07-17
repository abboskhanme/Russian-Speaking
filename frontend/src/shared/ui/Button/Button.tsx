import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cx } from "../utils/cx";
import { Spinner } from "../Spinner/Spinner";
import styles from "./Button.module.css";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "success";

export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stretch to the full width of the parent. */
  fullWidth?: boolean;
  /** Show a centred spinner, hide the label, and mark the control busy. */
  loading?: boolean;
  /**
   * Render styles onto the single child element instead of a `<button>`
   * (Radix Slot). Use for links styled as buttons: `<Button asChild><a …/></Button>`.
   * `loading` is ignored in this mode.
   */
  asChild?: boolean;
  children?: ReactNode;
}

/**
 * Button — the primary action primitive (docs/03 §3.6).
 * Tokens only; tap-scale via `--tap-scale`; focus-visible ring from tokens.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "md",
      fullWidth = false,
      loading = false,
      asChild = false,
      disabled,
      className,
      children,
      type,
      ...props
    },
    ref,
  ) {
    const classes = cx(
      styles.button,
      styles[variant],
      styles[size],
      fullWidth && styles.full,
      !asChild && loading && styles.loading,
      className,
    );

    // Slot mode: pass styling through to the caller's element unchanged.
    if (asChild) {
      return (
        <Slot ref={ref} className={classes} {...props}>
          {children}
        </Slot>
      );
    }

    return (
      <button
        ref={ref}
        // A bare <button> defaults to type="submit"; force "button" unless asked.
        type={type ?? "button"}
        className={classes}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        <span className={styles.content}>{children}</span>
        {loading && (
          <span className={styles.spinner} aria-hidden>
            <Spinner size="sm" label="" />
          </span>
        )}
      </button>
    );
  },
);
