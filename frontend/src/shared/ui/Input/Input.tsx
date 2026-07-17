import { forwardRef, useId, useState } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { cx } from "../utils/cx";
import styles from "./Input.module.css";

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** Visible field label, associated to the input via `htmlFor`. */
  label?: ReactNode;
  /** Helper text shown below the field (hidden while an error is shown). */
  hint?: ReactNode;
  /** Error message. Sets `aria-invalid` and recolours the field + message. */
  error?: ReactNode;
  /** Class for the outer wrapper (the input itself takes `className`). */
  containerClassName?: string;
  /**
   * Show a reveal (eye) toggle. Defaults to `true` when `type="password"`.
   * Set `false` to opt out.
   */
  revealToggle?: boolean;
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {off ? (
        <>
          <path d="M3 3l18 18" />
          <path d="M10.6 10.6a3 3 0 0 0 4.2 4.2" />
          <path d="M9.9 4.24A10.9 10.9 0 0 1 12 4c6.5 0 10 8 10 8a17.8 17.8 0 0 1-3.06 3.94" />
          <path d="M6.06 6.06A17.8 17.8 0 0 0 2 12s3.5 8 10 8a10.9 10.9 0 0 0 4.1-.8" />
        </>
      ) : (
        <>
          <path d="M2 12s3.5-8 10-8 10 8 10 8-3.5 8-10 8-10-8-10-8Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

/**
 * Input — labelled text field (docs/03 §3.6 Forms, §3.9 a11y).
 * Fully wired: label ↔ input, `aria-describedby` → hint/error, `aria-invalid`.
 * `type="password"` gets an accessible show/hide toggle.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    hint,
    error,
    containerClassName,
    className,
    revealToggle,
    id,
    type = "text",
    disabled,
    required,
    ...props
  },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const messageId = `${inputId}-msg`;

  const [revealed, setRevealed] = useState(false);
  const isPassword = type === "password";
  const showToggle = (revealToggle ?? isPassword) && isPassword;
  const resolvedType = isPassword && revealed ? "text" : type;

  const invalid = error != null && error !== false;
  const message = invalid ? error : hint;
  const hasMessage = message != null && message !== false;

  return (
    <div className={cx(styles.field, containerClassName)}>
      {label != null && (
        <label className={styles.label} htmlFor={inputId}>
          {label}
          {required && (
            <span className={styles.req} aria-hidden>
              *
            </span>
          )}
        </label>
      )}

      <div
        className={styles.control}
        data-invalid={invalid || undefined}
        data-disabled={disabled || undefined}
      >
        <input
          ref={ref}
          id={inputId}
          type={resolvedType}
          className={cx(styles.input, className)}
          disabled={disabled}
          required={required}
          aria-invalid={invalid || undefined}
          aria-describedby={hasMessage ? messageId : undefined}
          {...props}
        />
        {showToggle && (
          <button
            type="button"
            className={styles.toggle}
            onClick={() => setRevealed((v) => !v)}
            aria-label={revealed ? "Parolni yashirish" : "Parolni ko'rsatish"}
            aria-pressed={revealed}
            aria-controls={inputId}
            disabled={disabled}
            tabIndex={disabled ? -1 : 0}
          >
            <EyeIcon off={revealed} />
          </button>
        )}
      </div>

      {hasMessage && (
        <p className={styles.message} id={messageId} data-invalid={invalid || undefined}>
          {message}
        </p>
      )}
    </div>
  );
});
