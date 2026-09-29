import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Text, cx } from "../../shared/ui";
import styles from "./ChoiceChips.module.css";

/** One chip: the value it stands for and its visible label. */
export interface ChoiceChip<T> {
  value: T;
  label: string;
}

/**
 * A labelled row of single-choice chips — D3's «Urinish» control, generalised.
 *
 * Chips instead of a free field wherever the server only honours a small set of
 * values: an invalid choice becomes unexpressible rather than a 400 (or, worse, a
 * silent clamp) discovered after saving. Toggle semantics (`aria-pressed`), so a
 * screen reader hears which one is on without relying on the fill colour.
 */
export function ChoiceChips<T extends string | number>({
  label,
  hint,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  options: ChoiceChip<T>[];
  value: T | null;
  onChange: (next: T) => void;
  disabled?: boolean;
}) {
  const labelId = useId();
  return (
    <div className={styles.field}>
      <Text as="span" id={labelId} variant="body-s" weight="semibold">
        {label}
      </Text>
      <div className={styles.chips} role="group" aria-labelledby={labelId}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={String(o.value)}
              type="button"
              className={cx(styles.chip, on && styles.chipOn)}
              aria-pressed={on}
              disabled={disabled}
              onClick={() => onChange(o.value)}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {hint && (
        <Text as="p" variant="body-s" color="muted">
          {hint}
        </Text>
      )}
    </div>
  );
}

/** The CEFR levels a teacher can pick. C2 is left out on purpose: `CefrScale` on
 * the server buckets bands into A1…C1, so a "C2" task would name a level no
 * student can ever be placed at. */
export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1"] as const;

/**
 * Level picker for a module or a task: A1 · A2 · B1 · B2 · C1, plus "none".
 *
 * `stored` is the value the server holds. Before these chips the level was free
 * text, so real rows carry things like "A1–A2"; such a value is shown as its own
 * extra chip — still selected until the teacher picks something else, and still
 * re-selectable — so opening an old module never silently rewrites its level.
 *
 * `value` "" means no level (the PATCH sends "" and the server clears it).
 */
export function LevelChips({
  label,
  value,
  stored,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  stored?: string | null;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const legacy = stored?.trim() && !(CEFR_LEVELS as readonly string[]).includes(stored.trim())
    ? stored.trim()
    : null;

  const options: ChoiceChip<string>[] = [
    { value: "", label: t("teacher.task.levelNone") },
    ...CEFR_LEVELS.map((l) => ({ value: l as string, label: l as string })),
    ...(legacy ? [{ value: legacy, label: legacy }] : []),
  ];

  return (
    <ChoiceChips label={label} options={options} value={value} onChange={onChange} disabled={disabled} />
  );
}
