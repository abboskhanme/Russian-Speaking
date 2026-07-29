import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card, Input, Modal, Tabs, Text, cx } from "../../shared/ui";
import type { TabItem } from "../../shared/ui";
import { AppShell, Brand, NotificationsBell, teacherNavItems } from "../../widgets";
import type { NavItem } from "../../widgets";
import { mockClassGroups, mockClassRequests, mockClassStudents } from "./classes.mock";
import styles from "./ClassesScreen.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

export interface ClassGroup {
  id: string;
  /** Group name (e.g. "Kechki-3"). */
  name: string;
  /** CEFR badge derived from the group's average band (e.g. "B1"). */
  level?: string;
  memberCount: number;
  /** Group average band 0–100, shown as "O'rtacha 74". */
  avgScore?: number;
  /** Self-service join code students enter. */
  joinCode: string;
}

export interface ClassStudent {
  id: string;
  fullName: string;
  /** Avatar initials. Derived from the name when omitted. */
  initials?: string;
  /** Which of the teacher's groups this student belongs to. */
  groupName: string;
  /** CEFR level derived from the student's average band (e.g. "B1"). */
  level?: string;
  /** Average band 0–100; null/undefined when the student has no graded attempt. */
  score?: number;
}

/** One student waiting for the teacher's decision (A3 So'rovlar). */
export interface ClassJoinRequest {
  id: string;
  studentName: string;
  initials?: string;
  /** The code they used, shown as "Kod: KECHKI-3". */
  joinCode: string;
  /** Localized relative time ("2 soat oldin"). The caller formats it. */
  when: string;
}

export type ClassesTabKey = "groups" | "requests" | "students";

export interface ClassesScreenProps {
  groups: ClassGroup[];
  students: ClassStudent[];
  /** Pending join requests, oldest first. */
  requests: ClassJoinRequest[];
  activeTab?: ClassesTabKey;
  onTabChange?: (key: ClassesTabKey) => void;
  activeNavKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
  /** Pending-review count, for the Navbat FAB badge. */
  queuedCount?: number;
  /** Create a group from the "+ Yangi guruh" tile. Resolves when the server has it. */
  onCreateGroup?: (name: string) => Promise<void> | void;
  /** Decide a join request. Resolves once the server has accepted the decision. */
  onDecideRequest?: (id: string, approve: boolean) => Promise<void> | void;
  /** Open a group's detail (A5 — Phase 3). */
  onOpenGroup?: (id: string, group: ClassGroup) => void;
  /** Assign a task to a group (D3 — Phase 6). */
  onAssignGroup?: (id: string, group: ClassGroup) => void;
  /** Open a student's profile (A6 — Phase 3). */
  onOpenStudent?: (id: string, student: ClassStudent) => void;
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * ClassesScreen — the teacher's **Klasslar** (`Govorim - Teacher.dc.html`, A2 ·
 * A3 · A4). One screen, the mockup's three-tab segmented control on top:
 * `Guruhlar | So'rovlar · N | O'quvchilar`.
 *
 * So'rovlar carries a live count in its label because it is the only tab with
 * work waiting in it — the mockup draws the same "· 3".
 *
 * Presentational and prop-driven: it fetches nothing. Full-width (docs/04 §4.10)
 * at compact density (docs/03 §3.5). Teacher panel design — not a student screen
 * restyled.
 */
export function ClassesScreen({
  groups,
  students,
  requests,
  activeTab = "groups",
  onTabChange,
  activeNavKey = "classes",
  onNavigate,
  queuedCount = 0,
  onCreateGroup,
  onDecideRequest,
  onOpenGroup,
  onAssignGroup,
  onOpenStudent,
}: ClassesScreenProps) {
  const { t } = useTranslation();

  const tabs: TabItem[] = [
    { key: "groups", label: t("teacher.tabGroups") },
    {
      key: "requests",
      label: requests.length
        ? `${t("teacher.tabRequests")} · ${requests.length}`
        : t("teacher.tabRequests"),
    },
    { key: "students", label: t("teacher.tabStudents") },
  ];

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
        <Tabs
          items={tabs}
          activeKey={activeTab}
          onChange={(k) => onTabChange?.(k as ClassesTabKey)}
          aria-label={t("nav.classes")}
        />

        {activeTab === "groups" && (
          <GroupsTab
            groups={groups}
            onCreateGroup={onCreateGroup}
            onOpenGroup={onOpenGroup}
            onAssignGroup={onAssignGroup}
          />
        )}
        {activeTab === "requests" && (
          <RequestsTab requests={requests} onDecideRequest={onDecideRequest} />
        )}
        {activeTab === "students" && (
          <StudentsTab students={students} onOpenStudent={onOpenStudent} />
        )}
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* A2 — Guruhlar                                                              */
/* -------------------------------------------------------------------------- */

function GroupsTab({
  groups,
  onCreateGroup,
  onOpenGroup,
  onAssignGroup,
}: {
  groups: ClassGroup[];
  onCreateGroup?: (name: string) => Promise<void> | void;
  onOpenGroup?: (id: string, group: ClassGroup) => void;
  onAssignGroup?: (id: string, group: ClassGroup) => void;
}) {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCreateGroup?.(trimmed);
      setCreating(false);
      setName("");
    } catch {
      setError(t("teacher.createGroupError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ul className={styles.groupList}>
        {groups.map((g) => (
          <li key={g.id}>
            <GroupCard group={g} onOpenGroup={onOpenGroup} onAssignGroup={onAssignGroup} />
          </li>
        ))}

        <li>
          {/* The mockup's dashed "+ Yangi guruh" tile, as the last item in the list. */}
          <button type="button" className={styles.newGroup} onClick={() => setCreating(true)}>
            <Text as="span" variant="body" weight="bold">
              {t("teacher.newGroup")}
            </Text>
          </button>
        </li>
      </ul>

      <Modal
        open={creating}
        onClose={() => !busy && setCreating(false)}
        title={t("teacher.createGroupTitle")}
        closeLabel={t("common.close")}
      >
        <div className={styles.form}>
          <Input
            label={t("teacher.groupNameLabel")}
            placeholder={t("teacher.groupNamePlaceholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
            autoFocus
            error={error ?? undefined}
          />
          <Text as="p" variant="body-s" color="muted">
            {t("teacher.joinCodeHint")}
          </Text>
          <div className={styles.formActions}>
            <Button variant="ghost" onClick={() => setCreating(false)} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" onClick={() => void submit()} disabled={!name.trim() || busy}>
              {t("teacher.createGroupSubmit")}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function GroupCard({
  group,
  onOpenGroup,
  onAssignGroup,
}: {
  group: ClassGroup;
  onOpenGroup?: (id: string, group: ClassGroup) => void;
  onAssignGroup?: (id: string, group: ClassGroup) => void;
}) {
  const { t } = useTranslation();

  return (
    <Card variant="outline" padding="md" className={styles.groupCard}>
      <div className={styles.groupTop}>
        <Text as="span" variant="title-s" className={styles.groupName} truncate>
          {group.level ? `${group.level} · ${group.name}` : group.name}
        </Text>
        <Badge variant="primary" size="sm">
          {t("teacher.members", { count: group.memberCount })}
        </Badge>
      </div>

      <Text as="p" variant="body-s" color="muted">
        {[
          group.avgScore != null ? t("teacher.avgScore", { score: group.avgScore }) : null,
          t("teacher.joinCodeInline", { code: group.joinCode }),
        ]
          .filter(Boolean)
          .join(" · ")}
      </Text>

      <div className={styles.groupActions}>
        <Button
          variant="primary"
          size="sm"
          className={styles.assignBtn}
          onClick={() => onAssignGroup?.(group.id, group)}
        >
          {t("teacher.assign")}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => onOpenGroup?.(group.id, group)}>
          {t("teacher.openGroup")}
        </Button>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* A3 — So'rovlar (join requests)                                             */
/* -------------------------------------------------------------------------- */

function RequestsTab({
  requests,
  onDecideRequest,
}: {
  requests: ClassJoinRequest[];
  onDecideRequest?: (id: string, approve: boolean) => Promise<void> | void;
}) {
  const { t } = useTranslation();
  /** Ids currently being decided — the row's buttons disable so a double-tap
   * cannot fire approve twice (the second would 404 once the first lands). */
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const decide = async (id: string, approve: boolean) => {
    if (busy.has(id)) return;
    setBusy((s) => new Set(s).add(id));
    try {
      await onDecideRequest?.(id, approve);
    } finally {
      setBusy((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }
  };

  if (requests.length === 0) {
    return (
      <Card variant="flat" padding="md" className={styles.empty}>
        <Text as="p" variant="body" color="muted">
          {t("teacher.noRequests")}
        </Text>
      </Card>
    );
  }

  return (
    <>
      <Text as="p" variant="body-s" color="muted">
        {t("teacher.requestsIntro")}
      </Text>

      <ul className={styles.requestList}>
        {requests.map((r) => (
          <li key={r.id}>
            <Card variant="outline" padding="md" className={styles.requestCard}>
              <div className={styles.requestTop}>
                <span className={styles.avatar} aria-hidden>
                  <Text as="span" variant="body-s" weight="bold">
                    {r.initials ?? deriveInitials(r.studentName)}
                  </Text>
                </span>
                <span className={styles.studentBody}>
                  <Text as="span" variant="body" weight="bold" truncate>
                    {r.studentName}
                  </Text>
                  <Text as="span" variant="body-s" color="muted" truncate>
                    {t("teacher.requestMeta", { code: r.joinCode, when: r.when })}
                  </Text>
                </span>
              </div>

              <div className={styles.requestActions}>
                <Button
                  variant="primary"
                  size="sm"
                  className={styles.approveBtn}
                  disabled={busy.has(r.id)}
                  onClick={() => void decide(r.id, true)}
                >
                  {t("teacher.approve")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className={styles.rejectBtn}
                  disabled={busy.has(r.id)}
                  onClick={() => void decide(r.id, false)}
                >
                  {t("teacher.reject")}
                </Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* A4 — O'quvchilar                                                           */
/* -------------------------------------------------------------------------- */

function StudentsTab({
  students,
  onOpenStudent,
}: {
  students: ClassStudent[];
  onOpenStudent?: (id: string, student: ClassStudent) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    if (!q) return students;
    return students.filter(
      (s) =>
        s.fullName.toLocaleLowerCase().includes(q) ||
        s.groupName.toLocaleLowerCase().includes(q),
    );
  }, [students, query]);

  return (
    <>
      <Input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("teacher.searchStudent")}
        aria-label={t("teacher.searchStudent")}
      />

      {filtered.length === 0 ? (
        <Card variant="flat" padding="md" className={styles.empty}>
          <Text as="p" variant="body" color="muted">
            {students.length === 0 ? t("teacher.noStudents") : t("teacher.noMatches")}
          </Text>
        </Card>
      ) : (
        <ul className={styles.studentList}>
          {filtered.map((s) => (
            <li key={s.id}>
              <StudentRow student={s} onOpenStudent={onOpenStudent} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function StudentRow({
  student,
  onOpenStudent,
}: {
  student: ClassStudent;
  onOpenStudent?: (id: string, student: ClassStudent) => void;
}) {
  const { t } = useTranslation();
  const initials = student.initials ?? deriveInitials(student.fullName);
  const sub = [student.groupName, student.level].filter(Boolean).join(" · ");

  return (
    <button
      type="button"
      className={styles.studentRow}
      onClick={() => onOpenStudent?.(student.id, student)}
    >
      <span className={styles.avatar} aria-hidden>
        <Text as="span" variant="body-s" weight="bold">
          {initials}
        </Text>
      </span>

      <span className={styles.studentBody}>
        <Text as="span" variant="body" weight="bold" truncate>
          {student.fullName}
        </Text>
        <Text as="span" variant="body-s" color="muted" truncate>
          {sub}
        </Text>
      </span>

      {student.score != null ? (
        <Text
          as="span"
          variant="body"
          weight="black"
          numeric
          className={cx(styles.score, styles[`score-${scoreTone(student.score)}` as const])}
        >
          {student.score}
        </Text>
      ) : (
        // No graded attempt yet — say so rather than showing a 0 that reads as a
        // bad score. The gradebook simply has no row for this student.
        <Text as="span" variant="body-s" color="faint" className={styles.score}>
          {t("teacher.notScored")}
        </Text>
      )}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Local helpers                                                              */
/* -------------------------------------------------------------------------- */

type ScoreTone = "success" | "warn" | "danger";

function scoreTone(score: number): ScoreTone {
  if (score >= 75) return "success";
  if (score >= 60) return "warn";
  return "danger";
}

function deriveInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/* -------------------------------------------------------------------------- */
/* Default export — a self-wired demo, renderable in isolation.               */
/* -------------------------------------------------------------------------- */

export default function ClassesDemo() {
  const [tab, setTab] = useState<ClassesTabKey>("groups");
  return (
    <ClassesScreen
      groups={mockClassGroups}
      students={mockClassStudents}
      requests={mockClassRequests}
      activeTab={tab}
      onTabChange={setTab}
      queuedCount={23}
    />
  );
}
