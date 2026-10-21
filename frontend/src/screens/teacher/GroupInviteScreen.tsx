import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card, Text, copyText } from "../../shared/ui";
import { Page } from "../../widgets";
import type { NavItem } from "../../widgets";
import { mockGroupInvite } from "./classes.mock";
import { BackGlyph, initialsOf } from "./TeacherGroupDetailScreen";
import styles from "./GroupInviteScreen.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

/** A student waiting on this group specifically. */
export interface InvitePendingStudent {
  id: string;
  studentName: string;
  initials?: string;
  /** Localized relative time ("10 daqiqa oldin"), formatted by the caller. */
  when: string;
}

export interface GroupInviteProps {
  groupName: string;
  /** The self-service code students type. */
  joinCode: string;
  /** Full invite URL, e.g. `https://govorim.uz/j/SMPLA1`. */
  inviteLink: string;
  pending: InvitePendingStudent[];
  activeNavKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
  queuedCount?: number;
  onBack?: () => void;
  onDecideRequest?: (id: string, approve: boolean) => Promise<void> | void;
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * GroupInviteScreen — **A7 «A'zo qo'shish · havola + kod»**
 * (`docs/design/mockups/Govorim - Teacher.dc.html`).
 *
 * Invite link + join code, each with a copy button, then the students waiting on
 * THIS group with Tasdiqlash / Rad etish.
 *
 * **The mockup's `HAVOLA` / `KOD` source chips are omitted.** They imply we know
 * how each student arrived, and we do not: the invite link resolves to the same
 * join-by-code flow, so every request has exactly one provenance. A chip that
 * said `HAVOLA` would be a guess presented as a fact.
 *
 * Copying goes through {@link copyText}, which falls back to a hidden textarea —
 * `navigator.clipboard` is undefined over plain HTTP on a LAN address, which is
 * precisely how this screen gets used while testing on a phone.
 */
export function GroupInviteScreen({
  groupName,
  joinCode,
  inviteLink,
  pending,
  onBack,
  onDecideRequest,
}: GroupInviteProps) {
  const { t } = useTranslation();

  return (
    <Page title={t("nav.classes")}>
      <div className={styles.page} data-density="compact">
        <header className={styles.head}>
          <button
            type="button"
            className={styles.back}
            onClick={onBack}
            aria-label={t("common.back")}
          >
            <BackGlyph />
          </button>
          <Text as="span" variant="title-l" className={styles.title} truncate>
            {t("teacher.inviteTitle", { group: groupName })}
          </Text>
        </header>

        <section className={styles.section}>
          <Text as="h2" variant="label" color="muted">
            {t("teacher.inviteLink")}
          </Text>
          <CopyRow value={inviteLink} mono variant="plain" />
        </section>

        <section className={styles.section}>
          <CopyRow
            value={joinCode}
            label={t("teacher.joinCodeLabel")}
            mono
            variant="tint"
          />
          <Text as="p" variant="body-s" color="muted">
            {t("teacher.inviteHint")}
          </Text>
        </section>

        <section className={styles.section} aria-label={t("teacher.waiting")}>
          <div className={styles.sectionHead}>
            <Text as="h2" variant="label" color="muted">
              {t("teacher.waiting")}
            </Text>
            {pending.length > 0 && (
              <Badge variant="warn" size="sm">
                {pending.length}
              </Badge>
            )}
          </div>

          {pending.length === 0 ? (
            <Card variant="flat" padding="md" className={styles.empty}>
              <Text as="p" variant="body" color="muted">
                {t("teacher.noRequests")}
              </Text>
            </Card>
          ) : (
            <ul className={styles.list}>
              {pending.map((p) => (
                <li key={p.id}>
                  <PendingCard student={p} onDecideRequest={onDecideRequest} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Page>
  );
}

/* -------------------------------------------------------------------------- */
/* Parts                                                                      */
/* -------------------------------------------------------------------------- */

function CopyRow({
  value,
  label,
  mono,
  variant,
}: {
  value: string;
  label?: string;
  mono?: boolean;
  variant: "plain" | "tint";
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  const copy = async () => {
    const ok = await copyText(value);
    setCopied(ok);
    setFailed(!ok);
    // Reset so the button is reusable; the value stays selectable either way.
    window.setTimeout(() => {
      setCopied(false);
      setFailed(false);
    }, 2000);
  };

  return (
    <div className={variant === "tint" ? styles.copyRowTint : styles.copyRow}>
      <span className={styles.copyBody}>
        {label && (
          <Text as="span" variant="label" color="primary">
            {label}
          </Text>
        )}
        {/* user-select so the value is still obtainable if copying is blocked. */}
        <Text
          as="span"
          variant={mono ? "mono" : "body"}
          weight="semibold"
          className={styles.copyValue}
        >
          {value}
        </Text>
      </span>
      <Button
        variant={variant === "tint" ? "secondary" : "primary"}
        size="sm"
        onClick={() => void copy()}
      >
        {copied ? t("teacher.copied") : failed ? t("teacher.copyFailed") : t("teacher.copy")}
      </Button>
    </div>
  );
}

function PendingCard({
  student,
  onDecideRequest,
}: {
  student: InvitePendingStudent;
  onDecideRequest?: (id: string, approve: boolean) => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  const decide = async (approve: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      await onDecideRequest?.(student.id, approve);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card variant="outline" padding="md" className={styles.pendingCard}>
      <div className={styles.pendingTop}>
        <span className={styles.avatar} aria-hidden>
          <Text as="span" variant="body-s" weight="bold">
            {student.initials ?? initialsOf(student.studentName)}
          </Text>
        </span>
        <span className={styles.pendingBody}>
          <Text as="span" variant="body" weight="bold" truncate>
            {student.studentName}
          </Text>
          <Text as="span" variant="body-s" color="muted">
            {student.when}
          </Text>
        </span>
      </div>
      <div className={styles.pendingActions}>
        <Button
          variant="primary"
          size="sm"
          className={styles.approveBtn}
          disabled={busy}
          onClick={() => void decide(true)}
        >
          {t("teacher.approveToGroup")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={styles.rejectBtn}
          disabled={busy}
          onClick={() => void decide(false)}
        >
          {t("teacher.rejectFull")}
        </Button>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Default export — a self-wired demo.                                        */
/* -------------------------------------------------------------------------- */

export default function GroupInviteDemo() {
  return <GroupInviteScreen {...mockGroupInvite} />;
}
