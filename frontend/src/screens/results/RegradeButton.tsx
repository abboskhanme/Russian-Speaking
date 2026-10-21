import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Text } from "../../shared/ui";
import styles from "./RegradeButton.module.css";

export interface RegradeButtonProps {
  /** Ask the server to grade the same recording again. Rejects with an Error whose
   * message is ALREADY localized (see app/regrade.ts) — it is shown as-is. */
  onRegrade: () => Promise<void>;
  /** Accessible name suffix, e.g. the task title, so a list of retry buttons can be
   * told apart by a screen reader. */
  label?: string;
  /** Drop the "no attempt is spent" hint (a dense admin list). */
  compact?: boolean;
}

/**
 * RegradeButton — the retry for an attempt whose GRADING failed ("Not graded ·
 * Grading took too long", or the AI budget was closed). It re-submits nothing:
 * the same recording goes back through grading and no attempt is spent, which is
 * what the hint under the button says, so a student is not afraid to press it.
 *
 * Owns only its own pending / error state; the caller decides what the row turns
 * into on success (it becomes "grading…").
 */
export function RegradeButton({ onRegrade, label, compact = false }: RegradeButtonProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onRegrade();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("uiDash.regrade.error.generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.row}>
        <Button
          variant="secondary"
          size="sm"
          className={styles.btn}
          loading={busy}
          onClick={() => void run()}
          aria-label={label ? `${t("uiDash.regrade.action")} — ${label}` : undefined}
        >
          <RetryGlyph />
          {t("uiDash.regrade.action")}
        </Button>
        {!compact && (
          <Text as="span" variant="body-s" color="muted">
            {t("uiDash.regrade.hint")}
          </Text>
        )}
      </div>
      {error && (
        <Text as="p" variant="body-s" color="danger" role="alert">
          {error}
        </Text>
      )}
    </div>
  );
}

function RetryGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
