import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import { cx } from "../utils/cx";
import styles from "./Switch.module.css";

type SwitchBaseProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onChange" | "children" | "type" | "role" | "aria-checked" | "value"
> & {
  /** Controlled on/off state. */
  checked: boolean;
  /** Called with the state the switch is moving TO. */
  onChange: (next: boolean) => void;
  disabled?: boolean;
};

/**
 * A switch has no visible text of its own, so a name is mandatory: pass either
 * `aria-label` or `aria-labelledby` (the id of the row label beside it).
 */
export type SwitchProps = SwitchBaseProps &
  (
    | { "aria-label": string; "aria-labelledby"?: never }
    | { "aria-labelledby": string; "aria-label"?: never }
  );

/**
 * Switch — iOS-style toggle (docs/03 §3.6 Actions).
 *
 * A real `<button role="switch" aria-checked>`, so Space/Enter operate it and
 * the focus ring is the same one every other control uses. Controlled only.
 * Use for settings that apply immediately (Bildirishnomalar); for a value that
 * is only committed on submit, use a checkbox instead.
 */
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(
  function Switch({ checked, onChange, disabled, className, ...props }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        data-state={checked ? "on" : "off"}
        className={cx(styles.track, checked && styles.on, className)}
        onClick={() => onChange(!checked)}
        {...props}
      >
        <span className={styles.knob} aria-hidden />
      </button>
    );
  },
);
