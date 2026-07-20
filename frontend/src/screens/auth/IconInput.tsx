/**
 * IconInput — the mockup's labelled field: an uppercase label over a rounded
 * box with a leading line-icon and a native input (frames A4/A5). The DS `Input`
 * has no leading-icon slot, so this is the auth-local field primitive; all
 * colour / radius come from tokens via `Auth.module.css`. The box lights its
 * border to `--primary` on focus (mockup's active phone field).
 */
import { forwardRef, useId } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { cx } from "../../shared/ui";
import styles from "./Auth.module.css";

export interface IconInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "prefix"> {
  label: ReactNode;
  icon: ReactNode;
  /** Render the value in the monospace token (phone numbers). */
  mono?: boolean;
  /** A `+998 ` style fixed prefix rendered before the input, non-editable. */
  prefix?: ReactNode;
}

export const IconInput = forwardRef<HTMLInputElement, IconInputProps>(
  function IconInput({ label, icon, mono, prefix, id, className, ...props }, ref) {
    const autoId = useId();
    const inputId = id ?? autoId;
    return (
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor={inputId}>
          {label}
        </label>
        <div className={styles.fieldControl}>
          <span className={styles.fieldIcon} aria-hidden>
            {icon}
          </span>
          {prefix != null && <span className={styles.fieldPrefix}>{prefix}</span>}
          <input
            ref={ref}
            id={inputId}
            className={cx(styles.fieldInput, mono && styles.mono, className)}
            {...props}
          />
        </div>
      </div>
    );
  },
);
