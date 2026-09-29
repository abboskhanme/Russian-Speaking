import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Input, Modal, Text, cx } from "../../shared/ui";
import styles from "./GroupSettingsSheet.module.css";

/** One roster member, as the settings sheet lists them for removal. */
export interface GroupSettingsMember {
  id: string;
  fullName: string;
}

export interface GroupSettingsSheetProps {
  open: boolean;
  onClose: () => void;
  /** LIVE values from the host — re-read after every write, never a snapshot. */
  groupName: string;
  joinCode: string;
  members: GroupSettingsMember[];
  /** Each rejects on failure; the sheet shows a generic, localized line. */
  onRename?: (name: string) => Promise<void>;
  onRegenerateCode?: () => Promise<void>;
  onRemoveMember?: (studentId: string) => Promise<void>;
  onDelete?: () => Promise<void>;
}

/** `groups.name` is varchar(128); longer is a 400 `name_too_long`, so the field
 * simply stops there. */
const NAME_MAX = 128;

type Confirming = { kind: "code" } | { kind: "remove"; id: string } | { kind: "delete" } | null;

/**
 * GroupSettingsSheet — A5's **«Sozlama»** (`Govorim - Teacher.dc.html`: Guruh nomi ·
 * Qo'shilish kodini yangilash · Guruhni arxivlash), as a sheet off the group
 * detail. The mockup draws it as a fourth tab; our A5 is the static board's single
 * page (tiles → tasks → roster), where a tab row would hide the roster behind a
 * tap, so the same controls live one tap away in a sheet instead.
 *
 * **Level is not here on purpose.** `groups` has no level column — the CEFR badge on
 * a group is derived from its students' scores, and the server refuses a level
 * (`level_not_supported`) rather than accept a value that would vanish.
 *
 * Every destructive step confirms INSIDE the sheet (a dialog on a dialog fights it
 * for focus and Escape) and says what survives: students' answers and grades are
 * never touched by any of these. Deleting the whole group additionally stays
 * disarmed until the teacher TYPES its name — the admin panel's pattern for the
 * one mistake a reflexive "OK" must not be able to make.
 */
export function GroupSettingsSheet({
  open,
  onClose,
  groupName,
  joinCode,
  members,
  onRename,
  onRegenerateCode,
  onRemoveMember,
  onDelete,
}: GroupSettingsSheetProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(groupName);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Fresh each time it opens; re-seed the name after a rename lands.
  useEffect(() => {
    if (!open) return;
    setConfirming(null);
    setTyped("");
    setError(null);
    setNotice(null);
  }, [open]);
  useEffect(() => setName(groupName), [groupName]);

  const renamed = name.trim().length > 0 && name.trim() !== groupName.trim();
  const nameMatches = useMemo(
    () => typed.trim().toLowerCase() === groupName.trim().toLowerCase(),
    [typed, groupName],
  );

  const run = async (fn: () => Promise<void>, done?: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setConfirming(null);
      setTyped("");
      if (done) setNotice(done);
    } catch {
      setError(t("teacher.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (busy) return;
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={t("teacher.groupSettings.title")}
      closeLabel={t("common.close")}
      size="full"
    >
      <div className={styles.sheet}>
        {/* ---- Guruh nomi ---- */}
        <section className={styles.section}>
          <Input
            label={t("teacher.groupNameLabel")}
            value={name}
            maxLength={NAME_MAX}
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <Button
            variant="secondary"
            size="sm"
            className={styles.start}
            disabled={!renamed || busy || !onRename}
            onClick={() => void run(() => onRename!(name.trim()), t("teacher.groupSettings.renamed"))}
          >
            {t("teacher.groupSettings.rename")}
          </Button>
        </section>

        {/* ---- Qo'shilish kodi ---- */}
        {onRegenerateCode && (
          <section className={styles.section}>
            <Text as="h3" variant="label" color="muted">
              {t("teacher.joinCodeLabel")}
            </Text>
            <Text as="p" variant="title-s" className={styles.code} data-testid="join-code">
              {joinCode}
            </Text>
            {confirming?.kind === "code" ? (
              <div className={styles.confirm} role="alertdialog" aria-label={t("teacher.groupSettings.regenerate")}>
                <Text as="p" variant="body-s" weight="semibold">
                  {t("teacher.groupSettings.regenerateWarn")}
                </Text>
                <div className={styles.confirmActions}>
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => setConfirming(null)}>
                    {t("common.cancel")}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={busy}
                    onClick={() => void run(onRegenerateCode, t("teacher.groupSettings.regenerated"))}
                  >
                    {t("teacher.groupSettings.regenerateCta")}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <Text as="p" variant="body-s" color="muted">
                  {t("teacher.groupSettings.regenerateHint")}
                </Text>
                <Button
                  variant="secondary"
                  size="sm"
                  className={styles.start}
                  disabled={busy}
                  onClick={() => setConfirming({ kind: "code" })}
                >
                  {t("teacher.groupSettings.regenerate")}
                </Button>
              </>
            )}
          </section>
        )}

        {/* ---- O'quvchilar ---- */}
        {onRemoveMember && (
          <section className={styles.section}>
            <Text as="h3" variant="label" color="muted">
              {t("teacher.tabStudents")}
            </Text>
            {members.length === 0 ? (
              <Text as="p" variant="body-s" color="muted">
                {t("teacher.noStudents")}
              </Text>
            ) : (
              <ul className={styles.members}>
                {members.map((m) => (
                  <li key={m.id} className={styles.member}>
                    <div className={styles.memberRow}>
                      <Text as="span" variant="body" weight="semibold" className={styles.grow} truncate>
                        {m.fullName}
                      </Text>
                      {!(confirming?.kind === "remove" && confirming.id === m.id) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className={styles.dangerText}
                          disabled={busy}
                          onClick={() => setConfirming({ kind: "remove", id: m.id })}
                          aria-label={t("teacher.groupSettings.removeAria", { name: m.fullName })}
                        >
                          {t("teacher.groupSettings.remove")}
                        </Button>
                      )}
                    </div>
                    {confirming?.kind === "remove" && confirming.id === m.id && (
                      <div
                        className={styles.confirm}
                        role="alertdialog"
                        aria-label={t("teacher.groupSettings.removeAria", { name: m.fullName })}
                      >
                        <Text as="p" variant="body-s" weight="semibold">
                          {t("teacher.groupSettings.removeConfirm", { name: m.fullName })}
                        </Text>
                        <Text as="p" variant="body-s" color="ink-soft">
                          {t("teacher.groupSettings.removeKeeps")}
                        </Text>
                        <div className={styles.confirmActions}>
                          <Button variant="secondary" size="sm" disabled={busy} onClick={() => setConfirming(null)}>
                            {t("common.cancel")}
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            loading={busy}
                            onClick={() =>
                              void run(() => onRemoveMember(m.id), t("teacher.groupSettings.removed", { name: m.fullName }))
                            }
                          >
                            {t("teacher.groupSettings.remove")}
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {notice && (
          <Text as="p" variant="body-s" color="success" role="status">
            {notice}
          </Text>
        )}
        {error && (
          <Text as="p" variant="body-s" color="danger" role="alert">
            {error}
          </Text>
        )}

        {/* ---- Xavfli zona ---- */}
        {onDelete && (
          <section className={cx(styles.section, styles.danger)}>
            <Text as="h3" variant="label" color="danger">
              {t("teacher.groupSettings.dangerZone")}
            </Text>
            {confirming?.kind === "delete" ? (
              <div className={styles.confirm} role="alertdialog" aria-label={t("teacher.groupSettings.delete")}>
                <Text as="p" variant="body-s" weight="semibold">
                  {t("teacher.groupSettings.deleteWarn")}
                </Text>
                <Text as="p" variant="body-s" color="danger">
                  {t("teacher.groupSettings.deleteIrreversible")}
                </Text>
                <Input
                  label={t("teacher.groupSettings.deleteTypeName", { name: groupName })}
                  value={typed}
                  onChange={(e) => setTyped(e.currentTarget.value)}
                  autoFocus
                />
                <div className={styles.confirmActions}>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setConfirming(null);
                      setTyped("");
                    }}
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    className={cx(styles.confirmDelete, nameMatches && styles.confirmDeleteArmed)}
                    disabled={!nameMatches || busy}
                    loading={busy}
                    onClick={() => void run(onDelete)}
                  >
                    {t("teacher.groupSettings.deleteCta")}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <Text as="p" variant="body-s" color="muted">
                  {t("teacher.groupSettings.deleteWarn")}
                </Text>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cx(styles.start, styles.dangerText)}
                  disabled={busy}
                  onClick={() => setConfirming({ kind: "delete" })}
                >
                  {t("teacher.groupSettings.delete")}
                </Button>
              </>
            )}
          </section>
        )}
      </div>
    </Modal>
  );
}
