import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cx } from "../utils/cx";
import { isoDateToDisplay, maskDate, maskTime, parseDisplayDate, parseTime } from "./dateMask";
import styles from "./DateField.module.css";

/**
 * DateField / DateTimeField — a date typed as `dd.MM.yyyy` (and a 24-hour `HH:mm`),
 * in every UI language, with the platform's own calendar one tap away.
 *
 * Why not a bare `<input type="date">`: its DISPLAY follows the browser's locale,
 * not ours — an Uzbek teacher on an en-US Chrome sees `mm/dd/yyyy, --:-- --` with
 * AM/PM, and it cannot be restyled. Why not a home-made calendar grid: a correct,
 * accessible date-grid dialog (focus trap, arrow-key grid navigation, announcements)
 * is a lot of code to get right, and the native pickers are already excellent on
 * iOS/Android. So:
 *
 *  - the visible control is a plain text input with a numeric keyboard
 *    (`inputMode="numeric"`) and a typing mask — it is the labelled, focusable
 *    control screen readers and keyboards use, and typing "21102026" just works;
 *  - a real `<button>` beside it opens the NATIVE picker of a visually-hidden
 *    `<input type="date">` via `showPicker()` (Chrome/Edge 99+, Safari 16+,
 *    Firefox 101+). The hidden input is out of the tab order and the a11y tree —
 *    the text field already offers everything it does.
 *
 * Values use the native formats so a screen can swap its old input in place:
 * `yyyy-MM-dd` (DateField) and local `yyyy-MM-ddTHH:mm` (DateTimeField). An
 * empty or not-yet-valid entry reports `""`; `onValidityChange` tells the caller
 * whether the current text is acceptable (empty counts as valid).
 */

export interface DateFieldProps {
  /** `yyyy-MM-dd` or "". */
  value: string;
  onChange: (value: string) => void;
  onValidityChange?: (valid: boolean) => void;
  label?: ReactNode;
  hint?: ReactNode;
  /** External error (takes precedence over the field's own). */
  error?: ReactNode;
  /** Inclusive bounds, `yyyy-MM-dd`. */
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  /** Accessible name when there is no visible `label`. */
  "aria-label"?: string;
  containerClassName?: string;
}

function CalendarIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** Open the platform picker of a (visually hidden) native input. */
function openNativePicker(input: HTMLInputElement | null) {
  if (!input) return;
  try {
    if (typeof input.showPicker === "function") {
      input.showPicker();
      return;
    }
  } catch {
    /* fall through — e.g. a browser that refuses without its own gesture */
  }
  input.focus();
  input.click();
}

/**
 * Follow the value only when the CALLER changes it (reset, prefill) — never on the
 * echo of our own `onChange`, and never while a half-typed entry reports "".
 */
function useExternalValue(value: string, onExternal: (v: string) => void) {
  const lastEmitted = useRef(value);
  useEffect(() => {
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    onExternal(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return lastEmitted;
}

function dateError(
  text: string,
  min: string | undefined,
  max: string | undefined,
  t: (k: string, o?: Record<string, unknown>) => string,
): string | null {
  if (!text) return null;
  const iso = parseDisplayDate(text);
  if (!iso) return t("dateField.invalid");
  if (min && iso < min) return t("dateField.tooEarly", { date: isoDateToDisplay(min) });
  if (max && iso > max) return t("dateField.tooLate", { date: isoDateToDisplay(max) });
  return null;
}

export function DateField({
  value,
  onChange,
  onValidityChange,
  label,
  hint,
  error,
  min,
  max,
  disabled,
  required,
  id,
  "aria-label": ariaLabel,
  containerClassName,
}: DateFieldProps) {
  const { t } = useTranslation();
  const autoId = useId();
  const inputId = id ?? autoId;
  const msgId = `${inputId}-msg`;
  const nativeRef = useRef<HTMLInputElement | null>(null);
  const [text, setText] = useState(() => isoDateToDisplay(value));
  const [touched, setTouched] = useState(false);
  const lastEmitted = useExternalValue(value, (v) => setText(isoDateToDisplay(v)));

  const ownError = dateError(text, min, max, t);
  useEffect(() => onValidityChange?.(ownError === null), [ownError, onValidityChange]);

  // Only nag once the person has left the field or typed a whole date.
  const shownError = error ?? (ownError && (touched || text.length === 10) ? ownError : null);
  const message = shownError ?? hint;

  const commit = (next: string) => {
    setText(next);
    const iso = parseDisplayDate(next);
    const ok = iso && dateError(next, min, max, t) === null;
    lastEmitted.current = ok ? iso : "";
    onChange(lastEmitted.current);
  };

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
      <div className={styles.control} data-invalid={shownError ? true : undefined} data-disabled={disabled || undefined}>
        <input
          id={inputId}
          className={styles.input}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder={t("dateField.placeholder")}
          value={text}
          maxLength={10}
          disabled={disabled}
          required={required}
          aria-label={label == null ? ariaLabel : undefined}
          aria-invalid={shownError ? true : undefined}
          aria-describedby={message ? msgId : undefined}
          onChange={(e) => commit(maskDate(e.currentTarget.value))}
          onBlur={() => setTouched(true)}
        />
        <span className={styles.pickerWrap}>
          <button
            type="button"
            className={styles.pickerButton}
            aria-label={t("dateField.openCalendar")}
            disabled={disabled}
            onClick={() => openNativePicker(nativeRef.current)}
          >
            <CalendarIcon />
          </button>
          <input
            ref={nativeRef}
            type="date"
            className={styles.native}
            tabIndex={-1}
            aria-hidden
            value={parseDisplayDate(text) ?? ""}
            min={min}
            max={max}
            disabled={disabled}
            onChange={(e) => {
              setTouched(true);
              commit(isoDateToDisplay(e.currentTarget.value));
            }}
          />
        </span>
      </div>
      {message != null && message !== false && (
        <p className={styles.message} id={msgId} data-invalid={shownError ? true : undefined}>
          {message}
        </p>
      )}
    </div>
  );
}

export interface DateTimeFieldProps extends Omit<DateFieldProps, "value" | "onChange" | "min" | "max"> {
  /** Local `yyyy-MM-ddTHH:mm` (the `datetime-local` format) or "". */
  value: string;
  onChange: (value: string) => void;
  /** Used when a date is given but the time is left blank. Shown as the time
   * field's placeholder so the effective value is never a surprise. */
  defaultTime?: string;
  /** Inclusive date bounds, `yyyy-MM-dd`. */
  minDate?: string;
  maxDate?: string;
}

/** A date plus a 24-hour time (deadlines). */
export function DateTimeField({
  value,
  onChange,
  onValidityChange,
  label,
  hint,
  error,
  minDate,
  maxDate,
  disabled,
  required,
  id,
  "aria-label": ariaLabel,
  containerClassName,
  defaultTime = "23:59",
}: DateTimeFieldProps) {
  const { t } = useTranslation();
  const autoId = useId();
  const groupId = id ?? autoId;
  const dateId = `${groupId}-date`;
  const timeId = `${groupId}-time`;
  const labelId = `${groupId}-label`;
  const msgId = `${groupId}-msg`;
  const nativeRef = useRef<HTMLInputElement | null>(null);

  const [text, setText] = useState(() => isoDateToDisplay(value.split("T")[0] ?? ""));
  const [timeText, setTimeText] = useState(() => (value.split("T")[1] ?? "").slice(0, 5));
  const [touched, setTouched] = useState(false);
  const lastEmitted = useExternalValue(value, (v) => {
    const [d, tm] = v ? v.split("T") : ["", ""];
    setText(isoDateToDisplay(d ?? ""));
    setTimeText((tm ?? "").slice(0, 5));
  });

  const dErr = dateError(text, minDate, maxDate, t);
  const tErr = timeText && !parseTime(timeText) ? t("dateField.timeInvalid") : null;
  // A time without a date is incomplete.
  const missingDate = !text && timeText ? t("dateField.invalid") : null;
  const ownError = dErr ?? tErr ?? missingDate;
  useEffect(() => onValidityChange?.(ownError === null), [ownError, onValidityChange]);

  const shownError = error ?? (ownError && (touched || text.length === 10) ? ownError : null);
  const message = shownError ?? hint;

  const emit = (dText: string, tText: string) => {
    const iso = parseDisplayDate(dText);
    const time = tText ? parseTime(tText) : defaultTime;
    const ok = iso && time && dateError(dText, minDate, maxDate, t) === null;
    lastEmitted.current = ok ? `${iso}T${time}` : "";
    onChange(lastEmitted.current);
  };

  return (
    <div className={cx(styles.field, containerClassName)}>
      {label != null && (
        <span className={styles.label} id={labelId}>
          {label}
          {required && (
            <span className={styles.req} aria-hidden>
              *
            </span>
          )}
        </span>
      )}
      <div
        className={styles.row}
        role="group"
        aria-labelledby={label != null ? labelId : undefined}
        aria-label={label == null ? ariaLabel : undefined}
      >
        <div
          className={cx(styles.control, styles.grow)}
          data-invalid={shownError && (dErr || missingDate) ? true : undefined}
          data-disabled={disabled || undefined}
        >
          <input
            id={dateId}
            className={styles.input}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder={t("dateField.placeholder")}
            value={text}
            maxLength={10}
            disabled={disabled}
            aria-label={t("dateField.date")}
            aria-invalid={shownError && (dErr || missingDate) ? true : undefined}
            aria-describedby={message ? msgId : undefined}
            onChange={(e) => {
              const next = maskDate(e.currentTarget.value);
              setText(next);
              emit(next, timeText);
            }}
            onBlur={() => setTouched(true)}
          />
          <span className={styles.pickerWrap}>
            <button
              type="button"
              className={styles.pickerButton}
              aria-label={t("dateField.openCalendar")}
              disabled={disabled}
              onClick={() => openNativePicker(nativeRef.current)}
            >
              <CalendarIcon />
            </button>
            <input
              ref={nativeRef}
              type="date"
              className={styles.native}
              tabIndex={-1}
              aria-hidden
              value={parseDisplayDate(text) ?? ""}
              min={minDate}
              max={maxDate}
              disabled={disabled}
              onChange={(e) => {
                const next = isoDateToDisplay(e.currentTarget.value);
                setTouched(true);
                setText(next);
                emit(next, timeText);
              }}
            />
          </span>
        </div>
        <div
          className={cx(styles.control, styles.time)}
          data-invalid={shownError && tErr ? true : undefined}
          data-disabled={disabled || undefined}
        >
          <input
            id={timeId}
            className={styles.input}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder={text ? defaultTime : t("dateField.timePlaceholder")}
            value={timeText}
            maxLength={5}
            disabled={disabled}
            aria-label={t("dateField.time")}
            aria-invalid={shownError && tErr ? true : undefined}
            aria-describedby={message ? msgId : undefined}
            onChange={(e) => {
              const next = maskTime(e.currentTarget.value);
              setTimeText(next);
              emit(text, next);
            }}
            onBlur={() => setTouched(true)}
          />
        </div>
      </div>
      {message != null && message !== false && (
        <p className={styles.message} id={msgId} data-invalid={shownError ? true : undefined}>
          {message}
        </p>
      )}
    </div>
  );
}
