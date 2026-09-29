import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Input, Modal, Text, cx } from "../../shared/ui";
import styles from "./AssignmentActionsSheet.module.css";

/** Why a deadline change did not happen. `due_in_past` is the server's own 400
 * code; it gets its own sentence because the fix (pick a later time) is obvious
 * once said and invisible otherwise. */
export type DueChangeResult =
  | { ok: true; updated: number }
  | { ok: false; reason: "due_in_past" | "failed" };

export interface AssignmentActionsSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Current deadline (ISO), or null for none. */
  dueAt: string | null;
  /** `null` = "muddatsiz" (remove the deadline). */
  onChangeDue?: (dueAt: string | null) => Promise<DueChangeResult>;
  /** Resolves with how many rows were removed; rejects on failure. */
  onCancel?: () => Promise<number>;
}

/**
 * The "Faol topshiriqlar" row menu on A5: move one task's deadline across the
 * group, or take the task back. Both act on the rows assigned THROUGH this group
 * (`PATCH /api/assignments/group`, `POST /api/assignments/cancel`), and both leave
 * every answer and grade already given exactly where it is.
 *
 * The date is a native `datetime-local` input — it renders in the OS locale with
 * no Intl call of ours, which matters because Chromium's reduced ICU has no
 * Uzbek calendar data.
 */
export function AssignmentActionsSheet({
  open,
  onClose,
  title,
  dueAt,
  onChangeDue,
  onCancel,
}: AssignmentActionsSheetProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [noDue, setNoDue] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setValue(dueAt ? toLocalInput(dueAt) : "");
    setNoDue(dueAt === null);
    setConfirmingCancel(false);
    setError(null);
    setNotice(null);
  }, [open, dueAt]);

  const close = () => {
    if (busy) return;
    onClose();
  };

  const saveDue = async () => {
    if (!onChangeDue || busy) return;
    if (!noDue && !value) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await onChangeDue(noDue ? null : new Date(value).toISOString());
    setBusy(false);
    if (result.ok) {
      onClose();
      return;
    }
    setError(result.reason === "due_in_past" ? t("teacher.assignmentActions.dueInPast") : t("teacher.saveFailed"));
  };

  const cancel = async () => {
    if (!onCancel || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const n = await onCancel();
      setConfirmingCancel(false);
      if (n > 0) {
        onClose();
      } else {
        // Nothing went through the group: the task reached these students one by
        // one (A6), so there is nothing here to take back. Say it, don't pretend.
        setNotice(t("teacher.assignmentActions.nothingToCancel"));
      }
    } catch {
      setError(t("teacher.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const canSave = noDue ? dueAt !== null : Boolean(value) && value !== (dueAt ? toLocalInput(dueAt) : "");

  return (
    <Modal open={open} onClose={close} title={title} closeLabel={t("common.close")}>
      <div className={styles.sheet}>
        {onChangeDue && (
          <section className={styles.section}>
            <Text as="h3" variant="label" color="muted">
              {t("teacher.assignmentActions.changeDue")}
            </Text>
            <Input
              type="datetime-local"
              value={value}
              disabled={noDue || busy}
              onChange={(e) => {
                setValue(e.currentTarget.value);
                setNoDue(false);
              }}
              aria-label={t("teacher.assignTask.due")}
            />
            <button
              type="button"
              className={cx(styles.chip, noDue && styles.chipOn)}
              aria-pressed={noDue}
              disabled={busy}
              onClick={() => setNoDue((v) => !v)}
            >
              {t("teacher.assignmentActions.noDue")}
            </button>
            <Button
              variant="primary"
              size="sm"
              className={styles.start}
              disabled={!canSave || busy}
              loading={busy && !confirmingCancel}
              onClick={() => void saveDue()}
            >
              {t("teacher.saveReview")}
            </Button>
          </section>
        )}

        {error && (
          <Text as="p" variant="body-s" color="danger" role="alert">
            {error}
          </Text>
        )}
        {notice && (
          <Text as="p" variant="body-s" color="warn" role="status">
            {notice}
          </Text>
        )}

        {onCancel && (
          <section className={cx(styles.section, styles.danger)}>
            {confirmingCancel ? (
              <div
                className={styles.confirm}
                role="alertdialog"
                aria-label={t("teacher.assignmentActions.cancel")}
              >
                <Text as="p" variant="body-s" weight="semibold">
                  {t("teacher.assignmentActions.cancelConfirm", { task: title })}
                </Text>
                <Text as="p" variant="body-s" color="ink-soft">
                  {t("teacher.assignmentActions.cancelKeeps")}
                </Text>
                <div className={styles.confirmActions}>
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => setConfirmingCancel(false)}>
                    {t("common.back")}
                  </Button>
                  <Button variant="danger" size="sm" loading={busy} onClick={() => void cancel()}>
                    {t("teacher.assignmentActions.cancelCta")}
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className={cx(styles.start, styles.dangerText)}
                disabled={busy}
                onClick={() => setConfirmingCancel(true)}
              >
                {t("teacher.assignmentActions.cancel")}
              </Button>
            )}
          </section>
        )}
      </div>
    </Modal>
  );
}

/** ISO instant → the `YYYY-MM-DDTHH:mm` a datetime-local input takes, in LOCAL
 * time. Built by hand: no Intl, for the reduced-ICU reason above. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
