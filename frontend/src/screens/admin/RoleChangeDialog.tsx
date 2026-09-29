import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Button, Card, Modal, Text } from "../../shared/ui";
import type { UserRole } from "../../shared/api";
import { roleChangeError } from "./adminErrors";
import styles from "./AdminPeopleScreen.module.css";

/** One pending role change: who, and from what to what. A SNAPSHOT on purpose —
 * unlike the manage sheet, which reads the live row by id, this dialog outlives its
 * row: a successful change moves the person to another list, and the dialog still
 * has to be able to say who it just changed. */
export interface RoleChangeTarget {
  id: string;
  fullName: string;
  from: UserRole;
  to: UserRole;
}

/** The role's display name. */
export function roleName(role: UserRole, t: TFunction): string {
  switch (role) {
    case "student":
      return t("admin.role.names.student");
    case "teacher":
      return t("admin.role.names.teacher");
    case "admin":
      return t("admin.role.names.admin");
  }
}

/**
 * What the change DOES, in one sentence. Every direction has its own, because the
 * consequences are not symmetrical: making a teacher an admin hands over every key
 * and every account, while making a student a teacher changes nothing they own.
 * A generic "are you sure?" treats those as the same click.
 */
function consequence(from: UserRole, to: UserRole, t: TFunction): string {
  if (from === "student" && to === "teacher") return t("admin.role.consequence.studentToTeacher");
  if (from === "teacher" && to === "student") return t("admin.role.consequence.teacherToStudent");
  if (from === "teacher" && to === "admin") return t("admin.role.consequence.teacherToAdmin");
  if (from === "admin" && to === "teacher") return t("admin.role.consequence.adminToTeacher");
  return t("admin.role.consequence.generic");
}

/**
 * The confirmation for a role change. It states the person, the direction and the
 * consequence, and it reports a refusal INLINE and stays open — `teacher_owns_groups`
 * and `last_admin` are not failures to retry, they are instructions, and a dialog that
 * closed on them would hide the one thing the admin needs to read.
 */
export function RoleChangeDialog({
  target,
  onClose,
  onConfirm,
  onDone,
}: {
  target: RoleChangeTarget;
  onClose: () => void;
  /** Rejects with the API error, which is mapped to a sentence here. */
  onConfirm: (id: string, role: UserRole) => Promise<void>;
  /** After a successful change — the host says so where the list is. */
  onDone?: (target: RoleChangeTarget) => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(target.id, target.to);
      onDone?.(target);
      onClose();
    } catch (e) {
      setError(roleChangeError(e, t));
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={t("admin.role.confirmTitle")} closeLabel={t("common.close")}>
      <div className={styles.sheet}>
        <Card variant="outline" padding="md">
          <Text as="p" variant="body" weight="semibold">
            {target.fullName}
          </Text>
          <Text as="p" variant="body-s" color="muted">
            {t("admin.role.fromTo", {
              from: roleName(target.from, t),
              to: roleName(target.to, t),
            })}
          </Text>
        </Card>

        <Text as="p" variant="body">
          {consequence(target.from, target.to, t)}
        </Text>

        {error && (
          <Text as="p" variant="body-s" color="danger" role="alert">
            {error}
          </Text>
        )}

        <div className={styles.sheetActions}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void confirm()}>
            {t("admin.role.confirm")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
