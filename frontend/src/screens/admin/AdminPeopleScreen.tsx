import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card, Input, Modal, Switch, Text, cx } from "../../shared/ui";
import { AppShell, Brand, NotificationsBell, adminNavItems } from "../../widgets";
import type { NavItem } from "../../widgets";
import { mockAdminStudents, mockAdminTeachers } from "./admin.mock";
import styles from "./AdminPeopleScreen.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

/** One managed account. `premium` is present only for students — teachers have no
 * learner subscription, so the control is absent rather than disabled. */
export interface AdminPerson {
  id: string;
  fullName: string;
  /** Phone for students; for teachers the account's email stands in. */
  contact: string;
  /** "Farg'ona · O'zbekiston tumani" or "12 vazifa" — assembled by the caller. */
  meta?: string;
  active: boolean;
  premium?: boolean;
  /**
   * What a DELETE would destroy: a teacher's authored tasks, a student's answers.
   * Shown inside the delete confirmation, because "this cascades" is abstract and
   * "this also deletes 770 answers" is not.
   */
  ownedCount: number;
}

export interface AdminPeopleProps {
  kind: "teachers" | "students";
  people: AdminPerson[];
  /** True while a search request is in flight. */
  searching?: boolean;
  activeNavKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
  /** Debounced by the caller; the server does the filtering. */
  onSearch?: (term: string) => void;
  /** Rename. Rejects to report failure so the sheet can stay open and say so. */
  onRename?: (id: string, fullName: string) => Promise<void>;
  /** Reversible account suspension — the answer to "make this stop working". */
  onSetActive?: (id: string, active: boolean) => Promise<void>;
  /** Students only: grant or revoke premium. */
  onSetPremium?: (id: string, premium: boolean) => Promise<void>;
  /** PERMANENT, CASCADING removal. Omit it and the delete control is not rendered
   * at all — a host that should not be able to destroy accounts simply does not
   * pass it. */
  onDelete?: (id: string) => Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The admin's account-management list, used for both **O'qituvchilar** and
 * **O'quvchilar**. One screen because the two genuinely share a shape — search,
 * rows, an edit sheet, a suspension toggle and a guarded delete — and differ only
 * in which fields a row carries.
 *
 * ## Deactivate is the primary action; delete is not
 *
 * `DELETE /api/admin/{teachers,students}/{id}` is `Users.Remove`, and every
 * foreign key into `users` is `ON DELETE CASCADE`. Deleting a teacher therefore
 * also destroys their groups, modules, tasks, topics and assignments; deleting a
 * student destroys every answer, evaluation, transcript, XP event and review item
 * they ever produced. There is no soft-delete column and no undo.
 *
 * So the row offers **Faolsizlantirish** — reversible, one tap, and what "make
 * this account stop working" almost always means. Deletion lives behind a separate
 * dialog that names the account, states the count it is about to destroy, and
 * requires the operator to TYPE that name before the button enables. That is
 * deliberate friction: the cost of an accidental click here is unrecoverable user
 * data, and a confirm dialog people dismiss by reflex would not prevent it.
 */
export function AdminPeopleScreen({
  kind,
  people,
  searching,
  activeNavKey,
  onNavigate,
  onSearch,
  onRename,
  onSetActive,
  onSetPremium,
  onDelete,
}: AdminPeopleProps) {
  const { t } = useTranslation();
  const [term, setTerm] = useState("");
  // Ids, not snapshots. Holding the AdminPerson object meant that after a write
  // refetched the list, the open sheet still showed the value from BEFORE the
  // write — flip premium on, the row updates, the switch under your finger does
  // not, and the obvious next move is to flip it back off.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const editing = useMemo(() => people.find((p) => p.id === editingId) ?? null, [people, editingId]);
  const deleting = useMemo(() => people.find((p) => p.id === deletingId) ?? null, [people, deletingId]);

  const navKey = activeNavKey ?? kind;
  const title = kind === "teachers" ? t("admin.teachers") : t("admin.students");

  return (
    <AppShell
      brand={<Brand />}
      nav={{
        items: adminNavItems(t),
        activeKey: navKey,
        onNavigate,
        label: t("nav.landmark"),
      }}
      headerStart={
        <Text as="h1" variant="title-m">
          {title}
        </Text>
      }
      headerEnd={<NotificationsBell />}
    >
      <div className={styles.page} data-density="compact">
        <div className={styles.head}>
          <Text as="h2" variant="title-l" className={styles.title} truncate>
            {title}
          </Text>
          <Badge variant="neutral" size="md">
            {people.length}
          </Badge>
        </div>

        <Input
          type="search"
          value={term}
          onChange={(e) => {
            setTerm(e.currentTarget.value);
            onSearch?.(e.currentTarget.value);
          }}
          placeholder={t("admin.searchPlaceholder")}
          aria-label={t("admin.searchPlaceholder")}
        />

        {people.length === 0 ? (
          <Card variant="flat" padding="lg" className={styles.empty}>
            <Text as="p" variant="body" color="muted">
              {searching ? t("admin.searching") : t("admin.noPeople")}
            </Text>
          </Card>
        ) : (
          <ul className={styles.list}>
            {people.map((p) => (
              <li key={p.id}>
                <Card variant="outline" padding="md" className={styles.row}>
                  <span className={styles.rowBody}>
                    <span className={styles.nameLine}>
                      <Text as="span" variant="body" weight="bold" truncate>
                        {p.fullName}
                      </Text>
                      {/* Status is carried by a labelled badge, never by colour
                          alone (docs/03 §3.3). */}
                      {!p.active && (
                        <Badge variant="danger" size="sm">
                          {t("admin.suspended")}
                        </Badge>
                      )}
                      {p.premium && (
                        <Badge variant="accent" size="sm">
                          {t("admin.premium")}
                        </Badge>
                      )}
                    </span>
                    <Text as="span" variant="body-s" color="muted" truncate>
                      {[p.contact, p.meta].filter(Boolean).join(" · ")}
                    </Text>
                  </span>

                  <span className={styles.rowActions}>
                    <Button variant="ghost" size="sm" onClick={() => setEditingId(p.id)}>
                      {t("admin.manage")}
                    </Button>
                  </span>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing && (
        <ManageSheet
          person={editing}
          kind={kind}
          onClose={() => setEditingId(null)}
          onRename={onRename}
          onSetActive={onSetActive}
          onSetPremium={onSetPremium}
          onRequestDelete={onDelete ? (p) => { setEditingId(null); setDeletingId(p.id); } : undefined}
        />
      )}

      {deleting && onDelete && (
        <DeleteDialog
          person={deleting}
          kind={kind}
          onClose={() => setDeletingId(null)}
          onDelete={onDelete}
        />
      )}
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Parts                                                                      */
/* -------------------------------------------------------------------------- */

/** Rename · suspend · premium, plus the entry point to deletion. Each control
 * writes on its own, so a failed premium grant never silently reverts a rename
 * the operator already made. */
function ManageSheet({
  person,
  kind,
  onClose,
  onRename,
  onSetActive,
  onSetPremium,
  onRequestDelete,
}: {
  person: AdminPerson;
  kind: "teachers" | "students";
  onClose: () => void;
  onRename?: (id: string, fullName: string) => Promise<void>;
  onSetActive?: (id: string, active: boolean) => Promise<void>;
  onSetPremium?: (id: string, premium: boolean) => Promise<void>;
  onRequestDelete?: (person: AdminPerson) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(person.fullName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed when the list refreshes underneath an open sheet.
  useEffect(() => setName(person.fullName), [person.fullName]);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch {
      setError(t("admin.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const renamed = name.trim() !== person.fullName && name.trim().length > 0;

  return (
    <Modal open onClose={onClose} title={person.fullName} closeLabel={t("common.close")}>
      <div className={styles.sheet}>
        <Input
          label={t("admin.fullName")}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={!renamed || busy || !onRename}
          onClick={() => void run(async () => { await onRename?.(person.id, name.trim()); })}
        >
          {t("admin.saveName")}
        </Button>

        <div className={styles.switchRow}>
          <span className={styles.switchText}>
            <Text as="span" variant="body" weight="semibold">
              {t("admin.activeLabel")}
            </Text>
            <Text as="span" variant="body-s" color="muted">
              {t("admin.activeHint")}
            </Text>
          </span>
          <Switch
            checked={person.active}
            disabled={busy || !onSetActive}
            onChange={(next) => void run(async () => { await onSetActive?.(person.id, next); })}
            aria-label={t("admin.activeLabel")}
          />
        </div>

        {/* Students only — a teacher has no learner subscription, so the control
            is absent rather than present-but-disabled. */}
        {kind === "students" && (
          <div className={styles.switchRow}>
            <span className={styles.switchText}>
              <Text as="span" variant="body" weight="semibold">
                {t("admin.premiumLabel")}
              </Text>
              <Text as="span" variant="body-s" color="muted">
                {t("admin.premiumHint")}
              </Text>
            </span>
            <Switch
              checked={Boolean(person.premium)}
              disabled={busy || !onSetPremium}
              onChange={(next) => void run(async () => { await onSetPremium?.(person.id, next); })}
              aria-label={t("admin.premiumLabel")}
            />
          </div>
        )}

        {error && (
          <Text as="p" variant="body-s" color="danger" role="alert">
            {error}
          </Text>
        )}

        {onRequestDelete && (
          <div className={styles.dangerZone}>
            <Text as="h3" variant="label" color="danger" className={styles.legend}>
              {t("admin.dangerZone")}
            </Text>
            <Text as="p" variant="body-s" color="muted">
              {kind === "teachers"
                ? t("admin.deleteTeacherWarning", { count: person.ownedCount })
                : t("admin.deleteStudentWarning", { count: person.ownedCount })}
            </Text>
            <Button variant="ghost" size="sm" className={styles.dangerBtn} onClick={() => onRequestDelete(person)}>
              {t("admin.deleteAccount")}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

/**
 * The delete confirmation. The button stays disabled until the operator types the
 * account's exact name.
 *
 * This is not ceremony. The action is `Users.Remove` with cascading foreign keys:
 * it is irreversible, it takes content and history with it, and there is no backup
 * step between the click and the loss. A dialog that can be cleared with a reflexive
 * "OK" would not stop the one mistake that actually matters here.
 */
function DeleteDialog({
  person,
  kind,
  onClose,
  onDelete,
}: {
  person: AdminPerson;
  kind: "teachers" | "students";
  onClose: () => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = useMemo(
    () => typed.trim().toLowerCase() === person.fullName.trim().toLowerCase(),
    [typed, person.fullName],
  );

  const confirm = async () => {
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete(person.id);
      onClose();
    } catch {
      setError(t("admin.deleteFailed"));
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={t("admin.deleteTitle")} closeLabel={t("common.close")}>
      <div className={styles.sheet}>
        <Card variant="outline" padding="md" className={styles.dangerCard}>
          <Text as="p" variant="body" weight="semibold">
            {person.fullName}
          </Text>
          <Text as="p" variant="body-s" color="muted">
            {person.contact}
          </Text>
        </Card>

        <Text as="p" variant="body">
          {kind === "teachers"
            ? t("admin.deleteTeacherWarning", { count: person.ownedCount })
            : t("admin.deleteStudentWarning", { count: person.ownedCount })}
        </Text>
        <Text as="p" variant="body-s" color="danger">
          {t("admin.deleteIrreversible")}
        </Text>

        <Input
          label={t("admin.deleteTypeName", { name: person.fullName })}
          value={typed}
          onChange={(e) => setTyped(e.currentTarget.value)}
          autoFocus
        />

        {error && (
          <Text as="p" variant="body-s" color="danger" role="alert">
            {error}
          </Text>
        )}

        <div className={styles.sheetActions}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            className={cx(styles.confirmDelete, matches && styles.confirmDeleteArmed)}
            disabled={!matches || busy}
            onClick={() => void confirm()}
          >
            {t("admin.deleteConfirm")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Default exports — self-wired demos.                                        */
/* -------------------------------------------------------------------------- */

export default function AdminPeopleDemo() {
  return <AdminPeopleScreen kind="teachers" people={mockAdminTeachers} />;
}

export function AdminStudentsDemo() {
  return <AdminPeopleScreen kind="students" people={mockAdminStudents} />;
}
