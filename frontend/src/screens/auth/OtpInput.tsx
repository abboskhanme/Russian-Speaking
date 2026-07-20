/**
 * OtpInput — the mockup's segmented code entry (frame A5): `length` square
 * monospace boxes, each holding one digit, that light their border to
 * `--primary` when filled or focused. Fully keyboard/paste friendly: typing
 * advances, Backspace on an empty box steps back, and pasting a code fills
 * across the boxes. Emits the joined digit string via `onChange`.
 */
import { useRef } from "react";
import type { ClipboardEvent, KeyboardEvent } from "react";
import styles from "./Auth.module.css";

export interface OtpInputProps {
  value: string;
  onChange: (next: string) => void;
  /** Fired when the last box is filled (all `length` digits present). */
  onComplete?: (code: string) => void;
  length?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  "aria-label"?: string;
}

export function OtpInput({
  value,
  onChange,
  onComplete,
  length = 6,
  disabled,
  autoFocus,
  "aria-label": ariaLabel,
}: OtpInputProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = value.replace(/\D/g, "").slice(0, length);

  const focus = (i: number) => refs.current[Math.max(0, Math.min(length - 1, i))]?.focus();

  const emit = (next: string) => {
    const clean = next.replace(/\D/g, "").slice(0, length);
    onChange(clean);
    if (clean.length === length) onComplete?.(clean);
  };

  const handleInput = (i: number, raw: string) => {
    const typed = raw.replace(/\D/g, "");
    if (!typed) return;
    // Take the newest digit for this box, keep the rest of the code intact.
    const arr = digits.split("");
    arr[i] = typed[typed.length - 1];
    const next = arr.join("").slice(0, length);
    emit(next);
    focus(i + 1);
  };

  const handleKeyDown = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      const arr = digits.split("");
      if (arr[i]) {
        arr[i] = "";
        emit(arr.join(""));
      } else if (i > 0) {
        arr[i - 1] = "";
        emit(arr.join(""));
        focus(i - 1);
      }
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      focus(i - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      focus(i + 1);
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    if (!pasted) return;
    emit(pasted);
    focus(pasted.length);
  };

  return (
    <div className={styles.otp} role="group" aria-label={ariaLabel}>
      {Array.from({ length }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          className={styles.otpBox}
          data-filled={digits[i] ? true : undefined}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          value={digits[i] ?? ""}
          disabled={disabled}
          autoFocus={autoFocus && i === 0}
          aria-label={`${i + 1}`}
          onChange={(e) => handleInput(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
        />
      ))}
    </div>
  );
}
