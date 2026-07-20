/**
 * SelectField — the mockup's labelled dropdown (frame A6 "Viloyat" / "Tuman"):
 * an uppercase label over a rounded box with an optional leading icon, a native
 * `<select>` (accessible + mobile-friendly), and a trailing chevron. Mirrors
 * {@link IconInput}'s look; all colour / radius come from Ovoz DS tokens via
 * `Auth.module.css`. Empty value → the placeholder shows greyed.
 */
import { forwardRef, useId } from "react";
import type { ReactNode, SelectHTMLAttributes } from "react";
import { cx } from "../../shared/ui";
import { ChevronDownIcon } from "./icons";
import styles from "./Auth.module.css";

export interface SelectFieldProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "value"> {
  label: ReactNode;
  /** Optional leading line-icon (e.g. the pin on the region field). */
  icon?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  /** Shown as a disabled first option when `value` is empty. */
  placeholder: string;
  options: readonly string[];
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(
  function SelectField(
    { label, icon, value, onChange, placeholder, options, id, className, disabled, ...props },
    ref,
  ) {
    const autoId = useId();
    const selectId = id ?? autoId;
    return (
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor={selectId}>
          {label}
        </label>
        <div className={cx(styles.fieldControl, styles.selectControl, disabled && styles.controlDisabled)}>
          {icon != null && (
            <span className={styles.fieldIcon} aria-hidden>
              {icon}
            </span>
          )}
          <select
            ref={ref}
            id={selectId}
            className={cx(styles.selectInput, className)}
            value={value}
            onChange={(ev) => onChange(ev.target.value)}
            disabled={disabled}
            data-empty={value === "" || undefined}
            {...props}
          >
            <option value="" disabled>
              {placeholder}
            </option>
            {options.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
          <span className={styles.selectChevron} aria-hidden>
            <ChevronDownIcon />
          </span>
        </div>
      </div>
    );
  },
);
