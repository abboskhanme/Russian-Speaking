import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card, Mascot, Text, cx } from "../../shared/ui";
import { AppShell, Brand, ThemeToggle, teacherNavItems } from "../../widgets";
import type { NavItem, ThemeMode } from "../../widgets";
import {
  mockTeacher,
  mockTeacherActivity,
  mockTeacherGroups,
  mockTeacherStats,
} from "./teacher.mock";
import styles from "./TeacherDashboardScreen.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

export interface TeacherProfile {
  /** The teacher's display name shown in the greeting. */
  name: string;
  /**
   * Localized, time-of-day greeting line above the name (e.g. "Xayrli tong,").
   * The caller localizes; the screen just renders it.
   */
  greeting: string;
  /** Role chip next to the name (default localized "O'qituvchi"). */
  role?: string;
}

export interface TeacherStats {
  /** Students active this week — the headline reach number. */
  activeStudents: number;
  /** Number of groups the teacher runs. */
  groups: number;
  /** Submissions waiting in the review queue (the actionable count). */
  pendingReviews: number;
}

export interface TeacherGroup {
  id: string;
  /** Group name (e.g. "Kechki-3"). */
  name: string;
  /** CEFR band badge for the group (e.g. "B1"). */
  level?: string;
  /** How many students belong to the group. */
  memberCount: number;
  /** Group average CEFR band (e.g. "B1"). */
  avgBand?: string;
  /** Self-service join code students enter (e.g. "KECHKI-3"). */
  joinCode: string;
  /** Optional schedule caption (e.g. "Du·Chor·Ju 18:00"). */
  schedule?: string;
}

/** review = submission awaiting grading; score = a recently graded result. */
export type TeacherActivityKind = "review" | "score";

/** Flag on a review item → tone + badge (why it needs a human). */
export type TeacherReviewFlag = "low-confidence" | "flagged";

export interface TeacherActivity {
  id: string;
  kind: TeacherActivityKind;
  /** Student who submitted (full name). */
  studentName: string;
  /** Avatar initials (e.g. "DR"). Derived from the name when omitted. */
  initials?: string;
  /** Task / assignment title (e.g. "Do'konda xarid"). */
  task?: string;
  /** CEFR band of the attempt (e.g. "A2"). */
  band?: string;
  /** Score 0..100 — the coloured chip. */
  score?: number;
  /** review only: why it surfaced (default "low-confidence"). */
  flag?: TeacherReviewFlag;
  /** Relative-time caption (e.g. "2 soat oldin", "Bugun"). */
  when?: string;
}

export interface TeacherDashboardProps {
  teacher: TeacherProfile;
  stats: TeacherStats;
  groups: TeacherGroup[];
  /** Needs-review queue + recent scores, most urgent first. */
  activity: TeacherActivity[];
  /** Active nav key (defaults to "dashboard"). */
  activeNavKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
  onToggleTheme?: (mode: ThemeMode) => void;
  /** Quick action — start a new group. */
  onCreateGroup?: () => void;
  /** Quick action — assign a task (bulk). */
  onCreateAssignment?: () => void;
  /** Open a group's detail. */
  onOpenGroup?: (id: string, group: TeacherGroup) => void;
  /** Assign a task to a specific group from its card. */
  onAssignGroup?: (id: string, group: TeacherGroup) => void;
  /** Open a submission to grade / view it. */
  onReview?: (id: string, activity: TeacherActivity) => void;
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * TeacherDashboardScreen — the teacher's "Boshqaruv paneli" (docs/04 teacher
 * flows, Faza 4.9). Composed entirely from `shared/ui` + `widgets` + tokens.
 * Presentational and prop-driven: it fetches nothing and owns no state.
 *
 * Layout is full-width (docs/04 §4.10): AppShell frame (teacher nav) → header
 * (greeting + quick-action buttons) → a quick-stats row (active students /
 * groups / pending reviews) → the groups grid (name · members · avg band · join
 * code) → a needs-review / recent-activity list (submissions to grade or recent
 * scores). Runs at **compact density** (docs/03 §3.5 `--density-scale` ×0.75) —
 * teacher tooling is denser than the student screens. Every colour / space /
 * radius / motion value is a token.
 */
export function TeacherDashboardScreen({
  teacher,
  stats,
  groups,
  activity,
  activeNavKey = "dashboard",
  onNavigate,
  onToggleTheme,
  onCreateGroup,
  onCreateAssignment,
  onOpenGroup,
  onAssignGroup,
  onReview,
}: TeacherDashboardProps) {
  const { t } = useTranslation();
  return (
    <AppShell
      brand={<Brand />}
      nav={{
        items: teacherNavItems(t),
        activeKey: activeNavKey,
        onNavigate,
        label: t("nav.landmark"),
      }}
      headerStart={
        <Text as="h1" variant="title-m">
          {t("nav.dashboard")}
        </Text>
      }
      headerEnd={<ThemeToggle onChange={onToggleTheme} />}
    >
      {/* data-density mirrors the DS compact contract; the scale is also set on
          .page so it stays scoped to this screen (docs/03 §3.5). */}
      <div className={styles.page} data-density="compact">
        <DashboardHeader
          teacher={teacher}
          onCreateGroup={onCreateGroup}
          onCreateAssignment={onCreateAssignment}
        />

        <StatsRow stats={stats} />

        <GroupsSection
          groups={groups}
          onOpenGroup={onOpenGroup}
          onAssignGroup={onAssignGroup}
          onCreateGroup={onCreateGroup}
        />

        <ActivitySection activity={activity} onReview={onReview} />
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Header (greeting + quick actions)                                          */
/* -------------------------------------------------------------------------- */

function DashboardHeader({
  teacher,
  onCreateGroup,
  onCreateAssignment,
}: {
  teacher: TeacherProfile;
  onCreateGroup?: () => void;
  onCreateAssignment?: () => void;
}) {
  const { t } = useTranslation();
  const role = teacher.role ?? t("teacher.role");
  return (
    <header className={styles.head}>
      <div className={styles.headMain}>
        <Mascot mood="idle" size={56} label="Govo" />
        <div className={styles.headText}>
          <Text as="p" variant="body-s" color="muted" weight="semibold">
            {teacher.greeting}
          </Text>
          <div className={styles.headName}>
            <Text as="span" variant="title-l">
              {teacher.name}
            </Text>
            <Badge variant="neutral" size="md">
              {role}
            </Badge>
          </div>
        </div>
      </div>

      <div className={styles.headActions}>
        <Button variant="secondary" size="sm" onClick={onCreateGroup}>
          {t("teacher.createGroup")}
        </Button>
        <Button variant="primary" size="sm" onClick={onCreateAssignment}>
          {t("teacher.createAssignment")}
        </Button>
      </div>
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/* Quick stats                                                                */
/* -------------------------------------------------------------------------- */

type Tone = "primary" | "info" | "warn";

function StatsRow({ stats }: { stats: TeacherStats }) {
  const { t } = useTranslation();
  return (
    <section className={styles.stats} aria-label={t("teacher.statsAria")}>
      <StatTile
        tone="primary"
        value={stats.activeStudents}
        label={t("teacher.activeStudents")}
        icon={<UsersGlyph />}
      />
      <StatTile
        tone="info"
        value={stats.groups}
        label={t("teacher.groupsStat")}
        icon={<GroupsGlyph />}
      />
      <StatTile
        tone="warn"
        value={stats.pendingReviews}
        label={t("teacher.pendingReviews")}
        icon={<InboxGlyph />}
      />
    </section>
  );
}

function StatTile({
  tone,
  value,
  label,
  icon,
}: {
  tone: Tone;
  value: number;
  label: string;
  icon: ReactNode;
}) {
  return (
    <Card variant="outline" padding="sm" className={styles.statTile}>
      <span
        className={cx(styles.statIcon, styles[`tone-${tone}` as const])}
        aria-hidden
      >
        {icon}
      </span>
      <span className={styles.statMeta}>
        <Text as="span" variant="title-l" weight="black" numeric>
          {value}
        </Text>
        <Text as="span" variant="body-s" color="muted">
          {label}
        </Text>
      </span>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Groups grid                                                                */
/* -------------------------------------------------------------------------- */

function GroupsSection({
  groups,
  onOpenGroup,
  onAssignGroup,
  onCreateGroup,
}: {
  groups: TeacherGroup[];
  onOpenGroup?: (id: string, group: TeacherGroup) => void;
  onAssignGroup?: (id: string, group: TeacherGroup) => void;
  onCreateGroup?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <section className={styles.section} aria-label={t("teacher.groups")}>
      <div className={styles.sectionHead}>
        <Text as="h2" variant="label" color="faint">
          {t("teacher.groups")}
        </Text>
        <Button variant="ghost" size="sm" onClick={onCreateGroup}>
          {t("teacher.newGroup")}
        </Button>
      </div>

      <ul className={styles.groupGrid}>
        {groups.map((g) => (
          <li key={g.id}>
            <GroupCard
              group={g}
              onOpenGroup={onOpenGroup}
              onAssignGroup={onAssignGroup}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function GroupCard({
  group,
  onOpenGroup,
  onAssignGroup,
}: {
  group: TeacherGroup;
  onOpenGroup?: (id: string, group: TeacherGroup) => void;
  onAssignGroup?: (id: string, group: TeacherGroup) => void;
}) {
  const { t } = useTranslation();
  const members = t("teacher.members", { count: group.memberCount });
  const sub = [members, group.schedule].filter(Boolean).join(" · ");

  return (
    <Card variant="outline" padding="sm" className={styles.groupCard}>
      <div className={styles.groupTop}>
        {group.level && (
          <Badge variant="primary" size="md">
            {group.level}
          </Badge>
        )}
        <div className={styles.groupTitle}>
          <Text as="span" variant="title-s" truncate>
            {group.name}
          </Text>
          <Text as="span" variant="body-s" color="muted" truncate>
            {sub}
          </Text>
        </div>
      </div>

      <div className={styles.groupChips}>
        {group.avgBand && (
          <span className={styles.chip}>
            <Text as="span" variant="body-s" color="muted">
              {t("teacher.avgBand")}
            </Text>
            <Text as="span" variant="body-s" weight="bold">
              {group.avgBand}
            </Text>
          </span>
        )}
        <span className={cx(styles.chip, styles.chipCode)}>
          <Text as="span" variant="body-s" color="faint">
            {t("teacher.joinCode")}
          </Text>
          <Text as="span" variant="mono" weight="bold">
            {group.joinCode}
          </Text>
        </span>
      </div>

      <div className={styles.groupActions}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onAssignGroup?.(group.id, group)}
        >
          {t("teacher.assign")}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onOpenGroup?.(group.id, group)}
        >
          {t("teacher.openGroup")}
        </Button>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Needs-review / recent activity                                             */
/* -------------------------------------------------------------------------- */

function ActivitySection({
  activity,
  onReview,
}: {
  activity: TeacherActivity[];
  onReview?: (id: string, activity: TeacherActivity) => void;
}) {
  const { t } = useTranslation();
  const pending = activity.filter((a) => a.kind === "review").length;

  return (
    <section className={styles.section} aria-label={t("teacher.reviewQueue")}>
      <div className={styles.sectionHead}>
        <Text as="h2" variant="label" color="faint">
          {t("teacher.reviewQueue")}
        </Text>
        {pending > 0 && (
          <Text as="span" variant="body-s" color="warn" weight="bold" numeric>
            {t("teacher.pendingCount", { count: pending })}
          </Text>
        )}
      </div>

      {activity.length === 0 ? (
        <Card variant="flat" padding="md" className={styles.empty}>
          <Text as="p" variant="body" color="muted">
            {t("teacher.noReviews")}
          </Text>
        </Card>
      ) : (
        <ul className={styles.activityList}>
          {activity.map((a) => (
            <li key={a.id}>
              <ActivityRow activity={a} onReview={onReview} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ActivityRow({
  activity,
  onReview,
}: {
  activity: TeacherActivity;
  onReview?: (id: string, activity: TeacherActivity) => void;
}) {
  const { t } = useTranslation();
  const isReview = activity.kind === "review";
  const initials = activity.initials ?? deriveInitials(activity.studentName);
  const sub = [activity.task, activity.when].filter(Boolean).join(" · ");
  const flag = activity.flag ?? "low-confidence";

  return (
    <Card variant="outline" padding="sm" className={styles.activityRow}>
      <span className={styles.avatar} aria-hidden>
        <Text as="span" variant="body-s" weight="bold">
          {initials}
        </Text>
      </span>

      <span className={styles.activityBody}>
        <span className={styles.activityTitleRow}>
          <Text as="span" variant="title-s" truncate>
            {activity.studentName}
          </Text>
          {activity.band && (
            <Badge variant="neutral" size="sm">
              {activity.band}
            </Badge>
          )}
        </span>
        {sub && (
          <Text as="span" variant="body-s" color="muted" truncate>
            {sub}
          </Text>
        )}
      </span>

      {activity.score !== undefined && (
        <span
          className={cx(styles.score, styles[`score-${scoreTone(activity.score)}` as const])}
          aria-label={t("teacher.scoreAria", { score: activity.score })}
        >
          <Text as="span" variant="title-s" weight="black" numeric>
            {activity.score}
          </Text>
        </span>
      )}

      {isReview ? (
        <Badge
          variant={flag === "flagged" ? "danger" : "warn"}
          size="sm"
          className={styles.activityTag}
        >
          {t(flag === "flagged" ? "teacher.status.flagged" : "teacher.status.lowConfidence")}
        </Badge>
      ) : (
        <Badge variant="success" size="sm" className={styles.activityTag}>
          {t("teacher.status.graded")}
        </Badge>
      )}

      {isReview && (
        <Button
          variant="secondary"
          size="sm"
          className={styles.activityAction}
          onClick={() => onReview?.(activity.id, activity)}
        >
          {t("teacher.grade")}
        </Button>
      )}
    </Card>
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

function UsersGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="9" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M3.5 20a5.5 5.5 0 0 1 11 0M16 5.2a3.2 3.2 0 0 1 0 5.6M17 14.6A5.5 5.5 0 0 1 20.5 20"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function GroupsGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="4" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <rect x="13" y="4" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <rect x="4" y="13" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <rect x="13" y="13" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function InboxGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 13 6 5h12l2 8v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M4 13h4l1.5 2.5h5L16 13h4" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Default export — a self-wired demo, renderable in isolation.               */
/* -------------------------------------------------------------------------- */

/**
 * TeacherDashboardDemo — drop-in standalone preview wired to the mock fixture,
 * so the teacher dashboard renders end-to-end with no backend.
 */
export default function TeacherDashboardDemo() {
  return (
    <TeacherDashboardScreen
      teacher={mockTeacher}
      stats={mockTeacherStats}
      groups={mockTeacherGroups}
      activity={mockTeacherActivity}
      onNavigate={() => undefined}
      onCreateGroup={() => undefined}
      onCreateAssignment={() => undefined}
      onOpenGroup={() => undefined}
      onAssignGroup={() => undefined}
      onReview={() => undefined}
    />
  );
}
