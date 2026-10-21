import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Card,
  DataTable,
  Input,
  Modal,
  Switch,
  Tabs,
  Text,
  WIDE_QUERY,
  cx,
  sortRows,
  useMediaQuery,
} from "../../shared/ui";
import type { DataTableColumn, SortState, TabItem } from "../../shared/ui";
import type { UserRole } from "../../shared/api";
import { Page } from "../../widgets";
import type { NavItem } from "../../widgets";
import { AddTeacherSheet } from "./AddTeacherSheet";
import { AdminAccountsList } from "./AdminAccountsList";
import type { AdminAccount } from "./AdminAccountsList";
import { RoleChangeDialog, roleName } from "./RoleChangeDialog";
import { GroupTransferDialog, TeacherGroupsSection } from "./GroupTransfer";
import type { AdminGroupTransferApi, AdminTeacherGroup, GroupTransferTarget } from "./GroupTransfer";
import { adminErrorCode } from "./adminErrors";
import type { RoleChangeTarget } from "./RoleChangeDialog";
import { formatPhone } from "./formatPhone";
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
  /** The sign-in phone (E.164; the screen groups it for reading). The email stands
   * in only for a legacy account that has no phone — for everyone else it is a
   * synthesised `{phone}@govori.uz` placeholder and would be noise in the row. */
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
  /* ---- Table columns (≥1080px). All optional: the cards need none of them. ---- */
  /** Students: their latest answer (ISO) — the sort key — and its label ("2 soat oldin"). */
  lastActiveAt?: string | null;
  lastActiveLabel?: string;
  /** Students: mean AI band, 0–100; null when nothing is graded. */
  avgBand?: number | null;
  /** Students: their groups, each with its teacher. */
  groups?: AdminPersonGroup[];
  /** Teachers: groups owned and distinct students across them. */
  groupCount?: number;
  studentCount?: number;
  /** When the account was created (ISO) and its label. */
  createdAt?: string;
  createdLabel?: string;
}

export interface AdminPersonGroup {
  id: string;
  name: string;
  teacherName: string;
}

/** The teachers screen's second segment. */
export type AdminStaffTab = "teachers" | "admins";

export interface AdminPeopleProps {
  kind: "teachers" | "students";
  /** Newest first — the caller sorts, since only it has the timestamps. */
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
  /** Teachers only: "O'qituvchi qo'shish". Rejects with the API error — the sheet
   * reads its `code` (`phone_taken_by_student` turns into the promotion offer). */
  onCreateTeacher?: (args: { phone: string; fullName: string }) => Promise<void>;
  /** Teachers only: the promotion the add sheet offers when the number is a student's. */
  onPromoteStudent?: (userId: string) => Promise<void>;
  /** Any direction. Rejects with the API error (`last_admin`, `teacher_owns_groups`,
   * `cannot_change_own_role`), which the confirm dialog turns into a sentence. Omit it
   * and the manage sheet has no role section. */
  onChangeRole?: (id: string, role: UserRole) => Promise<void>;
  /** Teachers only: the "Guruhlari" section of the manage sheet and the
   * "Guruhni o'tkazish" dialog (see ./GroupTransfer). Omit it and neither renders. */
  groupTransfer?: AdminGroupTransferApi;
  /** Teachers only: the `O'qituvchilar | Adminlar` segment. Omit and the screen is
   * the plain teacher list. */
  staff?: {
    tab: AdminStaffTab;
    onTabChange: (tab: AdminStaffTab) => void;
    /** Null while loading. */
    admins: AdminAccount[] | null;
    adminsFailed?: boolean;
    onRetryAdmins?: () => void;
  };
}

/** Rows rendered before "Yana ko'rsatish". The API returns every match in one list,
 * and a thousand cards on a phone is a scroll nobody finishes; fifty newest-first
 * answers "who just joined" and search answers everything else. */
export const PEOPLE_PAGE_SIZE = 50;

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The admin's account-management list, used for both **O'qituvchilar** and
 * **O'quvchilar**. One screen because the two genuinely share a shape — search,
 * rows, an edit sheet, a suspension toggle, a role change and a guarded delete — and
 * differ only in which fields a row carries. The teachers configuration adds the
 * mockup's "O'qituvchi qo'shish" button and an **Adminlar** segment.
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
 *
 * ## A role change is a confirm, not a switch
 *
 * It moves the person to another list and changes which app they open next, so it
 * is never a one-tap control: each direction opens a dialog that states its own
 * consequence, and a refusal (`teacher_owns_groups`, `last_admin`) is read there.
 *
 * ## A teacher's groups can be handed over
 *
 * The teacher sheet lists their groups, each with "O'tkazish" (./GroupTransfer).
 * It is what `teacher_owns_groups` asks for before a demotion, and the answer to
 * "the teacher left" that deleting the class is not.
 */
export function AdminPeopleScreen({
  kind,
  people,
  searching,
  onSearch,
  onRename,
  onSetActive,
  onSetPremium,
  onDelete,
  onCreateTeacher,
  onPromoteStudent,
  onChangeRole,
  groupTransfer,
  staff,
}: AdminPeopleProps) {
  const { t } = useTranslation();
  const [term, setTerm] = useState("");
  // Ids, not snapshots. Holding the AdminPerson object meant that after a write
  // refetched the list, the open sheet still showed the value from BEFORE the
  // write — flip premium on, the row updates, the switch under your finger does
  // not, and the obvious next move is to flip it back off.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [roleChange, setRoleChange] = useState<RoleChangeTarget | null>(null);
  const [groupMove, setGroupMove] = useState<GroupTransferTarget | null>(null);
  const [adding, setAdding] = useState(false);
  const [shown, setShown] = useState(PEOPLE_PAGE_SIZE);
  // The outcome of the last write that moved someone out of sight (a role change) or
  // into it (a new teacher). Without it a promoted student simply vanishes from the
  // list, which reads as "deleted" rather than "moved".
  const [notice, setNotice] = useState<string | null>(null);

  const editing = useMemo(() => people.find((p) => p.id === editingId) ?? null, [people, editingId]);
  const deleting = useMemo(() => people.find((p) => p.id === deletingId) ?? null, [people, deletingId]);

  const wide = useMediaQuery(WIDE_QUERY);
  const [filters, setFilters] = useState<PeopleFilters>(NO_FILTERS);
  const [sort, setSort] = useState<SortState | null>(null);

  const title = kind === "teachers" ? t("admin.teachers") : t("admin.students");
  const personRole: UserRole = kind === "teachers" ? "teacher" : "student";
  const onAdmins = kind === "teachers" && staff?.tab === "admins";

  // Every group any listed student is in, for the group filter. Built from the rows
  // themselves, so it offers only groups that can match.
  const groupOptions = useMemo(() => {
    const byId = new Map<string, AdminPersonGroup>();
    for (const p of people) for (const g of p.groups ?? []) byId.set(g.id, g);
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [people]);

  const columns = useMemo(
    () => (kind === "teachers" ? teacherColumns(t, setEditingId) : studentColumns(t, setEditingId)),
    [kind, t],
  );

  // Filter → sort → page. Sorting happens BEFORE the page is cut, so "Javoblar ↓"
  // ranks everyone, not just the 50 rows already on screen.
  const filtered = useMemo(() => applyFilters(people, filters), [people, filters]);
  const ordered = useMemo(() => {
    const col = sort && columns.find((c) => c.key === sort.key);
    return col?.sortValue && sort ? sortRows(filtered, col.sortValue, sort.dir) : filtered;
  }, [filtered, sort, columns]);
  const visible = ordered.slice(0, shown);
  const count = onAdmins ? (staff?.admins?.length ?? 0) : people.length;

  const staffTabs: TabItem[] = [
    { key: "teachers", label: t("admin.teachers") },
    { key: "admins", label: t("admin.admins") },
  ];

  const openRoleChange = (person: { id: string; fullName: string }, from: UserRole, to: UserRole) => {
    setEditingId(null);
    setNotice(null);
    setRoleChange({ id: person.id, fullName: person.fullName, from, to });
  };

  return (
    <Page title={onAdmins ? t("admin.admins") : title} width="wide">
      <div className={styles.page} data-density="compact">
        <div className={styles.head}>
          {/* The title lives in the top bar (it follows the Adminlar tab); this row
              keeps only the count and the action. */}
          <Badge variant="neutral" size="md">
            {count}
          </Badge>
          {kind === "teachers" && onCreateTeacher && !onAdmins && (
            <Button
              variant="primary"
              size="sm"
              className={styles.addBtn}
              onClick={() => {
                setNotice(null);
                setAdding(true);
              }}
            >
              {t("admin.addTeacher")}
            </Button>
          )}
        </div>

        {kind === "teachers" && staff && (
          <Tabs
            items={staffTabs}
            activeKey={staff.tab}
            onChange={(k) => {
              setNotice(null);
              staff.onTabChange(k as AdminStaffTab);
            }}
            aria-label={t("admin.teachers")}
          />
        )}

        {notice && (
          <Text as="p" variant="body-s" color="success" role="status">
            {notice}
          </Text>
        )}

        {onAdmins && staff ? (
          <AdminAccountsList
            admins={staff.admins}
            failed={staff.adminsFailed}
            onRetry={staff.onRetryAdmins}
            onDemote={onChangeRole ? (a) => openRoleChange(a, "admin", "teacher") : undefined}
          />
        ) : (
          <>
            <Input
              type="search"
              value={term}
              onChange={(e) => {
                setTerm(e.currentTarget.value);
                setShown(PEOPLE_PAGE_SIZE);
                onSearch?.(e.currentTarget.value);
              }}
              placeholder={t("admin.searchPlaceholder")}
              aria-label={t("admin.searchPlaceholder")}
            />

            <FilterBar
              kind={kind}
              filters={filters}
              groups={groupOptions}
              onChange={(next) => {
                setFilters(next);
                setShown(PEOPLE_PAGE_SIZE);
              }}
            />

            {people.length === 0 ? (
              <EmptyState
                kind={kind}
                searching={Boolean(searching)}
                filtered={term.trim().length > 0}
                onAdd={kind === "teachers" && onCreateTeacher ? () => setAdding(true) : undefined}
              />
            ) : filtered.length === 0 ? (
              <Card variant="flat" padding="lg" className={styles.empty}>
                <Text as="p" variant="body" color="muted">
                  {t("admin.table.noMatch")}
                </Text>
                <Button variant="secondary" size="sm" onClick={() => setFilters(NO_FILTERS)}>
                  {t("admin.table.clearFilters")}
                </Button>
              </Card>
            ) : (
              <>
                {wide ? (
                  <DataTable
                    columns={columns}
                    rows={visible}
                    rowKey={(p) => p.id}
                    caption={
                      kind === "teachers"
                        ? t("admin.table.captionTeachers")
                        : t("admin.table.captionStudents")
                    }
                    sort={sort}
                    onSortChange={setSort}
                    sortLabel={(h) => t("admin.table.sortBy", { column: String(h) })}
                    rowClassName={(p) => (p.active ? undefined : styles.rowSuspended)}
                  />
                ) : (
                <ul className={styles.list}>
                  {visible.map((p) => (
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
                            {[formatPhone(p.contact), p.meta].filter(Boolean).join(" · ")}
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
                {ordered.length > visible.length && (
                  <div className={styles.more}>
                    <Text as="span" variant="body-s" color="muted">
                      {t("admin.shownOf", { shown: visible.length, total: ordered.length })}
                    </Text>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setShown((n) => n + PEOPLE_PAGE_SIZE)}
                    >
                      {t("admin.showMore")}
                    </Button>
                  </div>
                )}
              </>
            )}
          </>
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
          onRequestRoleChange={
            onChangeRole ? (p, to) => openRoleChange(p, personRole, to) : undefined
          }
          onRequestDelete={onDelete ? (p) => { setEditingId(null); setDeletingId(p.id); } : undefined}
          loadGroups={kind === "teachers" ? groupTransfer?.loadGroups : undefined}
          onRequestGroupTransfer={(p, group) => {
            setEditingId(null);
            setNotice(null);
            setGroupMove({ group, fromTeacher: { id: p.id, fullName: p.fullName } });
          }}
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

      {roleChange && onChangeRole && (
        <RoleChangeDialog
          target={roleChange}
          onClose={() => setRoleChange(null)}
          onConfirm={onChangeRole}
          onDone={(done) =>
            setNotice(t("admin.role.done", { name: done.fullName, role: roleName(done.to, t) }))
          }
        />
      )}

      {groupMove && groupTransfer && (
        <GroupTransferDialog
          target={groupMove}
          loadTargets={groupTransfer.loadTargets}
          onConfirm={groupTransfer.transfer}
          onClose={() => setGroupMove(null)}
          onDone={(group, name) => setNotice(t("admin.groups.done", { group, name }))}
        />
      )}

      {adding && onCreateTeacher && (
        <AddTeacherSheet
          onClose={() => setAdding(false)}
          onCreate={onCreateTeacher}
          onPromote={onPromoteStudent}
          onDone={(name) => setNotice(t("admin.teacherAdded", { name }))}
        />
      )}
    </Page>
  );
}

/* -------------------------------------------------------------------------- */
/* Parts                                                                      */
/* -------------------------------------------------------------------------- */

/** The chips above the list. Applied to the rows the server returned for the current
 * search — the API has no paging, so the full match set is already here. */
interface PeopleFilters {
  status: "all" | "active" | "suspended";
  premium: boolean;
  noGroup: boolean;
  /** "" = every group. */
  groupId: string;
}

const NO_FILTERS: PeopleFilters = { status: "all", premium: false, noGroup: false, groupId: "" };

function hasGroups(p: AdminPerson): boolean {
  return p.groups ? p.groups.length > 0 : (p.groupCount ?? 0) > 0;
}

export function applyFilters(people: AdminPerson[], f: PeopleFilters): AdminPerson[] {
  if (f === NO_FILTERS) return people;
  return people.filter(
    (p) =>
      (f.status === "all" || (f.status === "active") === p.active) &&
      (!f.premium || Boolean(p.premium)) &&
      (!f.noGroup || !hasGroups(p)) &&
      (!f.groupId || Boolean(p.groups?.some((g) => g.id === f.groupId))),
  );
}

/** Toggle chips (`aria-pressed`) plus, for students, a group picker. 44px tall on a
 * phone — they are tap targets first. */
function FilterBar({
  kind,
  filters,
  groups,
  onChange,
}: {
  kind: "teachers" | "students";
  filters: PeopleFilters;
  groups: AdminPersonGroup[];
  onChange: (next: PeopleFilters) => void;
}) {
  const { t } = useTranslation();
  const set = (patch: Partial<PeopleFilters>) => {
    const next = { ...filters, ...patch };
    const empty =
      next.status === "all" && !next.premium && !next.noGroup && next.groupId === "";
    onChange(empty ? NO_FILTERS : next);
  };
  const chip = (pressed: boolean, label: string, onClick: () => void) => (
    <button
      type="button"
      className={cx(styles.chip, pressed && styles.chipOn)}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {label}
    </button>
  );

  return (
    <div className={styles.filters} role="group" aria-label={t("admin.table.filters")}>
      {chip(filters.status === "active", t("admin.table.filterActive"), () =>
        set({ status: filters.status === "active" ? "all" : "active" }),
      )}
      {chip(filters.status === "suspended", t("admin.table.filterSuspended"), () =>
        set({ status: filters.status === "suspended" ? "all" : "suspended" }),
      )}
      {kind === "students" &&
        chip(filters.premium, t("admin.table.filterPremium"), () => set({ premium: !filters.premium }))}
      {chip(filters.noGroup, t("admin.table.filterNoGroup"), () =>
        set({ noGroup: !filters.noGroup, groupId: "" }),
      )}
      {kind === "students" && groups.length > 0 && (
        <select
          className={cx(styles.chip, styles.groupSelect, filters.groupId && styles.chipOn)}
          value={filters.groupId}
          onChange={(e) => set({ groupId: e.currentTarget.value, noGroup: false })}
          aria-label={t("admin.table.groupFilter")}
        >
          <option value="">{t("admin.table.allGroups")}</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name} · {g.teacherName}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

const ms = (iso?: string | null) => {
  if (!iso) return null;
  const v = Date.parse(iso);
  return Number.isNaN(v) ? null : v;
};

function NameCell({ p }: { p: AdminPerson }) {
  const { t } = useTranslation();
  return (
    <span className={styles.cellName}>
      <span className={styles.cellNameText}>{p.fullName}</span>
      {p.premium && (
        <Badge variant="accent" size="sm">
          {t("admin.premium")}
        </Badge>
      )}
    </span>
  );
}

function StatusCell({ p }: { p: AdminPerson }) {
  const { t } = useTranslation();
  return p.active ? (
    <Badge variant="success" size="sm">
      {t("admin.table.active")}
    </Badge>
  ) : (
    <Badge variant="danger" size="sm">
      {t("admin.suspended")}
    </Badge>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <span className={styles.cellMuted}>{children}</span>;
}

function sharedHead(t: TFunction): DataTableColumn<AdminPerson>[] {
  return [
    {
      key: "name",
      header: t("admin.table.name"),
      rowHeader: true,
      width: "20%",
      cell: (p) => <NameCell p={p} />,
      sortValue: (p) => p.fullName,
    },
    {
      key: "phone",
      header: t("admin.table.phone"),
      nowrap: true,
      cell: (p) => <span className={styles.mono}>{formatPhone(p.contact)}</span>,
    },
  ];
}

function tailColumns(t: TFunction, onManage: (id: string) => void): DataTableColumn<AdminPerson>[] {
  return [
    {
      key: "status",
      header: t("admin.table.status"),
      nowrap: true,
      cell: (p) => <StatusCell p={p} />,
      sortValue: (p) => (p.active ? 0 : 1),
    },
    {
      key: "actions",
      header: t("admin.table.actions"),
      hideHeader: true,
      align: "end",
      nowrap: true,
      cell: (p) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onManage(p.id)}
          aria-label={t("admin.table.manageName", { name: p.fullName })}
        >
          {t("admin.manage")}
        </Button>
      ),
    },
  ];
}

function studentColumns(t: TFunction, onManage: (id: string) => void): DataTableColumn<AdminPerson>[] {
  return [
    ...sharedHead(t),
    {
      key: "groups",
      header: t("admin.table.groupTeacher"),
      cell: (p) => {
        const gs = p.groups ?? [];
        if (gs.length === 0) return <Muted>{t("admin.table.noGroup")}</Muted>;
        const [first, ...rest] = gs;
        return (
          <span className={styles.cellStack}>
            <span>{first.name}</span>
            <Muted>
              {first.teacherName}
              {rest.length > 0 && ` · ${t("admin.table.moreGroups", { count: rest.length })}`}
            </Muted>
          </span>
        );
      },
      sortValue: (p) => p.groups?.[0]?.name ?? null,
    },
    {
      key: "answers",
      header: t("admin.table.answers"),
      align: "end",
      nowrap: true,
      cell: (p) => p.ownedCount,
      sortValue: (p) => p.ownedCount,
      firstDir: "desc",
    },
    {
      key: "avg",
      header: t("admin.table.avgScore"),
      align: "end",
      nowrap: true,
      cell: (p) => (p.avgBand == null ? <Muted>—</Muted> : Math.round(p.avgBand)),
      sortValue: (p) => p.avgBand ?? null,
      firstDir: "desc",
    },
    {
      key: "lastActive",
      header: t("admin.table.lastActive"),
      nowrap: true,
      cell: (p) => (p.lastActiveAt ? p.lastActiveLabel : <Muted>{t("admin.table.never")}</Muted>),
      sortValue: (p) => ms(p.lastActiveAt),
      firstDir: "desc",
    },
    ...tailColumns(t, onManage),
  ];
}

function teacherColumns(t: TFunction, onManage: (id: string) => void): DataTableColumn<AdminPerson>[] {
  return [
    ...sharedHead(t),
    {
      key: "groups",
      header: t("admin.table.groups"),
      align: "end",
      nowrap: true,
      cell: (p) => p.groupCount ?? 0,
      sortValue: (p) => p.groupCount ?? 0,
      firstDir: "desc",
    },
    {
      key: "students",
      header: t("admin.table.students"),
      align: "end",
      nowrap: true,
      cell: (p) => p.studentCount ?? 0,
      sortValue: (p) => p.studentCount ?? 0,
      firstDir: "desc",
    },
    {
      key: "tasks",
      header: t("admin.table.tasks"),
      align: "end",
      nowrap: true,
      cell: (p) => p.ownedCount,
      sortValue: (p) => p.ownedCount,
      firstDir: "desc",
    },
    {
      key: "joined",
      header: t("admin.table.joined"),
      nowrap: true,
      cell: (p) => p.createdLabel ?? "",
      sortValue: (p) => ms(p.createdAt),
      firstDir: "desc",
    },
    ...tailColumns(t, onManage),
  ];
}

/** Three different empties, three different sentences. "Nobody found" after a search
 * is a result; "nobody yet" on a fresh install is an instruction — and for teachers
 * it carries the one button that fixes it, since nothing else creates a teacher. */
function EmptyState({
  kind,
  searching,
  filtered,
  onAdd,
}: {
  kind: "teachers" | "students";
  searching: boolean;
  filtered: boolean;
  onAdd?: () => void;
}) {
  const { t } = useTranslation();
  const text = searching
    ? t("admin.searching")
    : filtered
      ? t("admin.noPeople")
      : kind === "teachers"
        ? t("admin.noTeachersYet")
        : t("admin.noStudentsYet");

  return (
    <Card variant="flat" padding="lg" className={styles.empty}>
      <Text as="p" variant="body" color="muted">
        {text}
      </Text>
      {!searching && !filtered && onAdd && (
        <Button variant="primary" size="sm" onClick={onAdd}>
          {t("admin.addTeacher")}
        </Button>
      )}
    </Card>
  );
}

/** Rename · suspend · premium · role, plus the entry point to deletion. Each control
 * writes on its own, so a failed premium grant never silently reverts a rename the
 * operator already made. */
function ManageSheet({
  person,
  kind,
  onClose,
  onRename,
  onSetActive,
  onSetPremium,
  onRequestRoleChange,
  onRequestDelete,
  loadGroups,
  onRequestGroupTransfer,
}: {
  person: AdminPerson;
  kind: "teachers" | "students";
  onClose: () => void;
  onRename?: (id: string, fullName: string) => Promise<void>;
  onSetActive?: (id: string, active: boolean) => Promise<void>;
  onSetPremium?: (id: string, premium: boolean) => Promise<void>;
  onRequestRoleChange?: (person: AdminPerson, to: UserRole) => void;
  onRequestDelete?: (person: AdminPerson) => void;
  /** Teachers only: present ⇒ the "Guruhlari" section renders. */
  loadGroups?: AdminGroupTransferApi["loadGroups"];
  onRequestGroupTransfer?: (person: AdminPerson, group: AdminTeacherGroup) => void;
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
    } catch (e) {
      // A refused rename says why; everything else is the generic line.
      setError(
        adminErrorCode(e) === "invalid_full_name" ? t("admin.errInvalidName") : t("admin.saveFailed"),
      );
    } finally {
      setBusy(false);
    }
  };

  const renamed = name.trim() !== person.fullName && name.trim().length > 0;
  const current: UserRole = kind === "teachers" ? "teacher" : "student";

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

        {/* Rolni o'zgartirish. Each button names its destination rather than opening
            a role picker: there are only three moves an admin makes from here, and a
            picker would offer "student → admin", which no real decision looks like. */}
        {onRequestRoleChange && (
          <section className={styles.roleZone} aria-label={t("admin.role.change")}>
            <Text as="h3" variant="label" color="muted" className={styles.legend}>
              {t("admin.role.change")}
            </Text>
            <Text as="p" variant="body-s" color="muted">
              {t("admin.role.current", { role: roleName(current, t) })}
            </Text>
            <div className={styles.roleActions}>
              {kind === "students" ? (
                <Button variant="secondary" size="sm" onClick={() => onRequestRoleChange(person, "teacher")}>
                  {t("admin.role.toTeacher")}
                </Button>
              ) : (
                <>
                  <Button variant="secondary" size="sm" onClick={() => onRequestRoleChange(person, "student")}>
                    {t("admin.role.toStudent")}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => onRequestRoleChange(person, "admin")}>
                    {t("admin.role.toAdmin")}
                  </Button>
                </>
              )}
            </div>
          </section>
        )}

        {/* Guruhlari — between the role section and the danger zone: handing a
            group over is the step that has to come BEFORE a demotion (which
            `teacher_owns_groups` refuses) and is the alternative to deleting. */}
        {loadGroups && onRequestGroupTransfer && (
          <TeacherGroupsSection
            teacherId={person.id}
            loadGroups={loadGroups}
            onTransfer={(group) => onRequestGroupTransfer(person, group)}
          />
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
