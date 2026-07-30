import { useTranslation } from "react-i18next";
import { Badge, Button, Card, Text, cx } from "../../shared/ui";
import { AppShell, Brand, NotificationsBell, teacherNavItems } from "../../widgets";
import type { NavItem } from "../../widgets";
import { mockGroupDetail } from "./classes.mock";
import styles from "./TeacherGroupDetailScreen.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

/** One assignment as the group sees it: N of M students have completed it. */
export interface GroupActiveAssignment {
  /** Stable key — the question id (assignments are grouped by question). */
  id: string;
  title: string;
  /** Localized due caption ("Bugun 21:00"), already formatted. Null = no deadline. */
  due?: string | null;
  /** True when the deadline has passed or is today — the caption turns urgent. */
  dueUrgent?: boolean;
  completed: number;
  total: number;
}

/** A roster row on the group detail. */
export interface GroupRosterStudent {
  id: string;
  fullName: string;
  initials?: string;
  /** CEFR from their average band. Absent when they have no graded attempt. */
  level?: string;
  /** Average band 0–100. Absent when not yet scored. */
  score?: number;
}

export interface TeacherGroupDetailProps {
  groupName: string;
  /** CEFR badge from the group average. Absent when nobody is scored yet. */
  level?: string;
  memberCount: number;
  /** Group average band 0–100. Absent when nobody is scored yet. */
  avgScore?: number;
  assignments: GroupActiveAssignment[];
  roster: GroupRosterStudent[];
  /** How many students are waiting for approval — badges the invite action. */
  pendingCount?: number;
  activeNavKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
  queuedCount?: number;
  onBack?: () => void;
  /** "+ Topshiriq berish" (D3 — Phase 6). */
  onAssign?: () => void;
  /** "A'zo qo'shish" → the A7 invite screen. */
  onInvite?: () => void;
  onOpenStudent?: (id: string, student: GroupRosterStudent) => void;
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * TeacherGroupDetailScreen — **A5 «Guruh detali»**
 * (`RussianDesign/Govori/Govorim - Teacher.dc.html`).
 *
 * Mockup order: back + name + CEFR badge → stat tiles → "+ Topshiriq berish" →
 * "Faol topshiriqlar" progress rows → the roster.
 *
 * **Two mockup elements are deliberately absent**, because nothing behind them
 * exists and a fabricated number on a teacher's screen is worse than a gap:
 *   • the **Davomat 92%** stat tile — there is no attendance model at all
 *     (nothing records lesson presence), so the tile row is two-up not three-up;
 *   • the **"Guruh xatolari"** card (`родительный падеж · 7 o'quvchi`) — no
 *     error-pattern aggregation exists (plan Phase 6/D1).
 *
 * Presentational and prop-driven. Full-width (docs/04 §4.10), compact density
 * (docs/03 §3.5). Teacher panel design — not a student screen restyled.
 */
export function TeacherGroupDetailScreen({
  groupName,
  level,
  memberCount,
  avgScore,
  assignments,
  roster,
  pendingCount = 0,
  activeNavKey = "classes",
  onNavigate,
  queuedCount = 0,
  onBack,
  onAssign,
  onInvite,
  onOpenStudent,
}: TeacherGroupDetailProps) {
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
            {groupName}
          </Text>
          {level && (
            <Badge variant="primary" size="md">
              {level}
            </Badge>
          )}
        </header>

        {/* Two tiles, not the mockup's three — Davomat has no data source. */}
        <section className={styles.stats} aria-label={t("teacher.statsAria")}>
          <StatTile value={memberCount} label={t("teacher.statStudents")} />
          <StatTile
            value={avgScore ?? "—"}
            label={t("teacher.statAvg")}
          />
        </section>

        <div className={styles.actions}>
          <Button variant="primary" className={styles.assignBtn} onClick={onAssign}>
            {t("teacher.assignToGroup")}
          </Button>
          <Button variant="secondary" onClick={onInvite}>
            {pendingCount > 0
              ? `${t("teacher.addMember")} · ${pendingCount}`
              : t("teacher.addMember")}
          </Button>
        </div>

        <section className={styles.section} aria-label={t("teacher.activeAssignments")}>
          <Text as="h2" variant="label" color="faint">
            {t("teacher.activeAssignments")}
          </Text>
          {assignments.length === 0 ? (
            <Card variant="flat" padding="md" className={styles.empty}>
              <Text as="p" variant="body" color="muted">
                {t("teacher.noAssignments")}
              </Text>
            </Card>
          ) : (
            <ul className={styles.list}>
              {assignments.map((a) => (
                <li key={a.id}>
                  <AssignmentRow assignment={a} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={styles.section} aria-label={t("teacher.tabStudents")}>
          <Text as="h2" variant="label" color="faint">
            {t("teacher.tabStudents")}
          </Text>
          {roster.length === 0 ? (
            <Card variant="flat" padding="md" className={styles.empty}>
              <Text as="p" variant="body" color="muted">
                {t("teacher.noStudents")}
              </Text>
            </Card>
          ) : (
            <ul className={styles.list}>
              {roster.map((s) => (
                <li key={s.id}>
                  <RosterRow student={s} onOpenStudent={onOpenStudent} />
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

function StatTile({ value, label }: { value: number | string; label: string }) {
  return (
    <Card variant="outline" padding="sm" className={styles.statTile}>
      <Text as="span" variant="title-l" weight="black" numeric>
        {value}
      </Text>
      <Text as="span" variant="body-s" color="muted" weight="semibold">
        {label}
      </Text>
    </Card>
  );
}

function AssignmentRow({ assignment }: { assignment: GroupActiveAssignment }) {
  const { t } = useTranslation();
  const pct = assignment.total > 0 ? Math.round((assignment.completed / assignment.total) * 100) : 0;

  return (
    <Card variant="outline" padding="sm" className={styles.assignmentCard}>
      <div className={styles.assignmentTop}>
        <Text as="span" variant="body" weight="bold" className={styles.grow} truncate>
          {assignment.title}
        </Text>
        {assignment.due && (
          <Text
            as="span"
            variant="body-s"
            weight="bold"
            color={assignment.dueUrgent ? "danger" : "muted"}
          >
            {assignment.due}
          </Text>
        )}
      </div>

      <div className={styles.progressRow}>
        <div
          className={styles.track}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={t("teacher.completionAria", {
            completed: assignment.completed,
            total: assignment.total,
          })}
        >
          <div className={styles.fill} style={{ width: `${pct}%` }} />
        </div>
        <Text as="span" variant="body-s" weight="bold" color="ink-soft" numeric>
          {assignment.completed}/{assignment.total}
        </Text>
      </div>
    </Card>
  );
}

function RosterRow({
  student,
  onOpenStudent,
}: {
  student: GroupRosterStudent;
  onOpenStudent?: (id: string, student: GroupRosterStudent) => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className={styles.row}
      onClick={() => onOpenStudent?.(student.id, student)}
    >
      <span className={styles.avatar} aria-hidden>
        <Text as="span" variant="body-s" weight="bold">
          {student.initials ?? initialsOf(student.fullName)}
        </Text>
      </span>
      <span className={styles.rowBody}>
        <Text as="span" variant="body" weight="bold" truncate>
          {student.fullName}
        </Text>
        {student.level && (
          <Text as="span" variant="body-s" color="muted">
            {student.level}
          </Text>
        )}
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

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function BackGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M15 5l-7 7 7 7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Default export — a self-wired demo.                                        */
/* -------------------------------------------------------------------------- */

export default function TeacherGroupDetailDemo() {
  return <TeacherGroupDetailScreen {...mockGroupDetail} />;
}
