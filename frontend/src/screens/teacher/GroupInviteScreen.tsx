import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card, Text, copyText } from "../../shared/ui";
import { AppShell, Brand, NotificationsBell, teacherNavItems } from "../../widgets";
import type { NavItem } from "../../widgets";
import { mockGroupInvite } from "./classes.mock";
import { BackGlyph, initialsOf } from "./TeacherGroupDetailScreen";
import styles from "./GroupInviteScreen.module.css";

/** The QR encoder is only needed here — split it out of the route chunk too. */
const QrCode = lazy(() => import("../../shared/ui/Qr/QrCode").then((m) => ({ default: m.QrCode })));

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
  activeNavKey = "classes",
  onNavigate,
  queuedCount = 0,
  onBack,
  onDecideRequest,
}: GroupInviteProps) {
  const { t } = useTranslation();

  return (
    <AppShell
      brand={<Brand />}
      nav={{
        items: teacherNavItems(t, queuedCount),
        activeKey: activeNavKey,
        onNavigate,
        label: t("nav.landmark"),
      }}
      headerStart={
        <Text as="h1" variant="title-m">
          {t("nav.classes")}
        </Text>
      }
      headerEnd={<NotificationsBell />}
    >
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

        <JoinPanel joinCode={joinCode} inviteLink={inviteLink} groupName={groupName} />

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
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Parts                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The hand-off: the join code BIG (students copy it off a projector or a phone
 * held up across a room), a QR of the invite link beside it, and copy buttons
 * that say what happened. "Sinfga ko'rsatish" opens the same code + QR full
 * screen for projecting.
 */
function JoinPanel({
  joinCode,
  inviteLink,
  groupName,
}: {
  joinCode: string;
  inviteLink: string;
  groupName: string;
}) {
  const { t } = useTranslation();
  const [presenting, setPresenting] = useState(false);

  return (
    <section className={styles.joinPanel} aria-label={t("teacher.joinCodeLabel")}>
      <div className={styles.joinMain}>
        <Text as="h2" variant="label" color="primary">
          {t("teacher.joinCodeLabel")}
        </Text>
        <p className={styles.bigCode} aria-label={spelled(joinCode)}>
          {joinCode}
        </p>
        <div className={styles.joinActions}>
          <CopyButton value={joinCode} label={t("uiDash.invite.copyCode")} primary />
          <CopyButton value={inviteLink} label={t("uiDash.invite.copyLink")} />
          <Button variant="ghost" size="sm" className={styles.actionBtn} onClick={() => setPresenting(true)}>
            <PresentGlyph />
            {t("uiDash.invite.present")}
          </Button>
        </div>
        <Text as="p" variant="body-s" color="muted" className={styles.linkLine}>
          {inviteLink}
        </Text>
        <Text as="p" variant="body-s" color="muted">
          {t("teacher.inviteHint")}
        </Text>
      </div>
      <figure className={styles.qrBox}>
        <Suspense fallback={<span className={styles.qrPlaceholder} />}>
          <QrCode value={inviteLink} label={t("uiDash.invite.qrAria", { group: groupName })} />
        </Suspense>
        <figcaption className={styles.qrCaption}>
          {t("uiDash.invite.qrCaption")}
        </figcaption>
      </figure>
      {presenting && (
        <PresentOverlay
          joinCode={joinCode}
          inviteLink={inviteLink}
          groupName={groupName}
          onClose={() => setPresenting(false)}
        />
      )}
    </section>
  );
}

/** "PFDHMP" → "P F D H M P", so a screen reader spells the code. */
function spelled(code: string): string {
  return code.split("").join(" ");
}

function PresentOverlay({
  joinCode,
  inviteLink,
  groupName,
  onClose,
}: {
  joinCode: string;
  inviteLink: string;
  groupName: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className={styles.present} role="dialog" aria-modal="true" aria-label={t("uiDash.invite.present")}>
      <Button ref={closeRef} variant="secondary" size="sm" className={styles.presentClose} onClick={onClose}>
        {t("uiDash.invite.close")}
      </Button>
      <Text as="p" variant="title-m" align="center">
        {t("uiDash.invite.presentTitle", { group: groupName })}
      </Text>
      <div className={styles.presentBody}>
        <div className={styles.presentQr}>
          <Suspense fallback={<span className={styles.qrPlaceholder} />}>
            <QrCode value={inviteLink} label={t("uiDash.invite.qrAria", { group: groupName })} />
          </Suspense>
        </div>
        <div className={styles.presentCodeCol}>
          <Text as="p" variant="label" color="muted">
            {t("teacher.joinCodeLabel")}
          </Text>
          <p className={styles.presentCode} aria-label={spelled(joinCode)}>
            {joinCode}
          </p>
          <Text as="p" variant="body" color="muted" className={styles.linkLine}>
            {inviteLink}
          </Text>
        </div>
      </div>
    </div>
  );
}

/** Copy with visible feedback — the label turns into "✓ Nusxa olindi" for 2 s and
 * is announced (aria-live) — or into a failure note when the clipboard refused. */
function CopyButton({ value, label, primary = false }: { value: string; label: string; primary?: boolean }) {
  const { t } = useTranslation();
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");

  const copy = async () => {
    const ok = await copyText(value);
    setState(ok ? "done" : "failed");
    window.setTimeout(() => setState("idle"), 2000);
  };

  return (
    <Button
      variant={primary ? "primary" : "secondary"}
      size="sm"
      className={styles.actionBtn}
      onClick={() => void copy()}
    >
      <span aria-live="polite" className={styles.copyLabel}>
        {state === "done" ? (
          <>
            <CheckGlyph />
            {t("teacher.copied")}
          </>
        ) : state === "failed" ? (
          t("teacher.copyFailed")
        ) : (
          <>
            <CopyGlyph />
            {label}
          </>
        )}
      </span>
    </Button>
  );
}

function CopyGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="9" y="9" width="11" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.9" />
      <path d="M15 9V6.5A2.5 2.5 0 0 0 12.5 4h-6A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 6.5 15H9" stroke="currentColor" strokeWidth="1.9" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PresentGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="4" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.9" />
      <path d="M12 16v4M8 20h8" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
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
