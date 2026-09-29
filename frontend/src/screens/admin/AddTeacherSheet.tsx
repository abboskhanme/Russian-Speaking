import { useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, Modal, Text } from "../../shared/ui";
import { IconInput } from "../auth/IconInput";
import { PhoneIcon, UserIcon } from "../auth/icons";
import { groupNational, isValidUz, nationalDigits, toE164 } from "../auth/phone";
import { adminErrorBody, isNetworkError, roleChangeError } from "./adminErrors";
import styles from "./AdminPeopleScreen.module.css";

/** The student who already holds the typed number — the 409 that turns "add" into
 * "promote". */
interface ExistingStudent {
  userId: string;
  fullName: string;
}

/**
 * "O'qituvchi qo'shish" — the sheet that makes a teacher account.
 *
 * On a fresh install this is the ONLY way a teacher comes to exist: sign-up makes
 * students, and nothing else makes teachers. So the sheet has to finish the job in
 * every branch rather than dead-end on a 409:
 *
 *  • The number belongs to a STUDENT → the sheet turns into the promotion question,
 *    naming them, because "this number is taken" would leave the admin nowhere —
 *    the obvious next move (make that person a teacher) is one confirm away.
 *  • The number belongs to a teacher/admin, or is malformed → an inline line on the
 *    field, and the typed values stay.
 *
 * The phone field is the login screen's own: the same `+998` prefix, the same
 * grouping mask and the same normaliser, so what the admin types here is exactly
 * what the teacher will type there.
 */
export function AddTeacherSheet({
  onClose,
  onCreate,
  onPromote,
  onDone,
}: {
  onClose: () => void;
  /** Rejects with the API error; the codes are read here. */
  onCreate: (args: { phone: string; fullName: string }) => Promise<void>;
  /** The promotion branch. Omit it and a student's number is reported, not offered. */
  onPromote?: (userId: string) => Promise<void>;
  /** After a teacher exists — by either branch — with their name. */
  onDone?: (fullName: string) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [nat, setNat] = useState(""); // national digits, max 9
  const [busy, setBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<ExistingStudent | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setNameError(null);
    setPhoneError(null);
    setError(null);

    const fullName = name.trim();
    let invalid = false;
    if (!fullName) {
      setNameError(t("admin.errNameRequired"));
      invalid = true;
    }
    if (!isValidUz(nat)) {
      setPhoneError(t("admin.errInvalidPhone"));
      invalid = true;
    }
    if (invalid) return;

    setBusy(true);
    try {
      await onCreate({ phone: toE164(nat), fullName });
      onDone?.(fullName);
      onClose();
    } catch (err) {
      const body = adminErrorBody(err);
      if (body?.code === "phone_taken_by_student" && body.user_id && onPromote) {
        setExisting({ userId: body.user_id, fullName: body.full_name?.trim() || fullName });
      } else if (body?.code === "phone_taken_by_student" || body?.code === "phone_taken") {
        setPhoneError(t("admin.errPhoneTaken"));
      } else if (body?.code === "invalid_phone") {
        setPhoneError(t("admin.errInvalidPhone"));
      } else if (isNetworkError(err)) {
        setError(t("auth.errors.network"));
      } else {
        setError(t("admin.saveFailed"));
      }
    } finally {
      setBusy(false);
    }
  };

  const promote = async () => {
    if (!existing || !onPromote || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onPromote(existing.userId);
      onDone?.(existing.fullName);
      onClose();
    } catch (err) {
      setError(roleChangeError(err, t));
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={t("admin.addTeacherTitle")} closeLabel={t("common.close")}>
      {existing ? (
        <div className={styles.sheet}>
          <Card variant="outline" padding="md">
            <Text as="p" variant="body" weight="semibold">
              {t("admin.promoteQuestion", { name: existing.fullName })}
            </Text>
          </Card>
          <Text as="p" variant="body-s" color="muted">
            {t("admin.role.consequence.studentToTeacher")}
          </Text>
          {error && (
            <Text as="p" variant="body-s" color="danger" role="alert">
              {error}
            </Text>
          )}
          <div className={styles.sheetActions}>
            <Button variant="ghost" onClick={() => setExisting(null)} disabled={busy}>
              {t("common.back")}
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void promote()}>
              {t("admin.role.toTeacher")}
            </Button>
          </div>
        </div>
      ) : (
        <form className={styles.sheet} onSubmit={(e) => void submit(e)} noValidate>
          <Text as="p" variant="body-s" color="muted">
            {t("admin.addTeacherHint")}
          </Text>

          <div className={styles.field}>
            <IconInput
              label={t("admin.fullName")}
              icon={<UserIcon />}
              name="full_name"
              autoComplete="off"
              value={name}
              onChange={(ev) => setName(ev.target.value)}
              aria-invalid={nameError ? true : undefined}
              autoFocus
            />
            {nameError && (
              <Text as="span" variant="body-s" color="danger" role="alert">
                {nameError}
              </Text>
            )}
          </div>

          <div className={styles.field}>
            <IconInput
              label={t("admin.phone")}
              icon={<PhoneIcon />}
              type="tel"
              name="phone"
              inputMode="tel"
              autoComplete="off"
              mono
              prefix="+998"
              value={groupNational(nat)}
              onChange={(ev) => setNat(nationalDigits(ev.target.value))}
              placeholder="90 123 45 67"
              aria-invalid={phoneError ? true : undefined}
            />
            {phoneError && (
              <Text as="span" variant="body-s" color="danger" role="alert">
                {phoneError}
              </Text>
            )}
          </div>

          {error && (
            <Text as="p" variant="body-s" color="danger" role="alert">
              {error}
            </Text>
          )}

          <div className={styles.sheetActions}>
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" loading={busy}>
              {t("admin.addTeacherSubmit")}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
