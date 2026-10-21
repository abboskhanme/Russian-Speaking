import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card, Text, cx } from "../../shared/ui";
import { Page } from "../../widgets";
import type { NavItem } from "../../widgets";
import { mockGroupDetail } from "./classes.mock";
import { ErrorsSection } from "./AnalyticsScreen";
import type { AnalyticsErrorRow, AnalyticsRemediation } from "./AnalyticsScreen";
import { AssignmentActionsSheet } from "./AssignmentActionsSheet";
import type { DueChangeResult } from "./AssignmentActionsSheet";
import { GroupSettingsSheet } from "./GroupSettingsSheet";
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
  /** The deadline itself (ISO), to prefill the "Muddatni o'zgartirish" input. */
  dueAt?: string | null;
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

  /* ---- "Faol topshiriqlar" row menu ---- */
  /** Move one task's deadline across the group (`null` = none). */
  onChangeDue?: (questionId: string, dueAt: string | null) => Promise<DueChangeResult>;
  /** Take one task back from the group; resolves with the rows removed. */
  onCancelAssignment?: (questionId: string) => Promise<number>;

  /* ---- "Guruh xatolari" ---- */
  /** The group's error patterns — D1's rows, filtered to this group. `null` hides
   * the card (the insights read failed; an empty list is a real "no errors"). */
  groupErrors?: AnalyticsErrorRow[] | null;
  errorsMinStudents?: number;
  /** F6 "Mashq ber" for a group error — same plan and endpoint as D1. */
  onAssignRemediation?: (row: AnalyticsErrorRow, plan: AnalyticsRemediation) => Promise<number>;

  /* ---- «Sozlama» ---- */
  /** The live join code (re-read after a regenerate). */
  joinCode?: string;
  onRename?: (name: string) => Promise<void>;
  onRegenerateCode?: () => Promise<void>;
  onRemoveMember?: (studentId: string) => Promise<void>;
  onDeleteGroup?: () => Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * TeacherGroupDetailScreen — **A5 «Guruh detali»**
 * (`docs/design/mockups/Govorim - Teacher.dc.html`).
 *
 * Mockup order: back + name + CEFR badge → stat tiles → "+ Topshiriq berish" →
 * "Faol topshiriqlar" progress rows → "Guruh xatolari" → the roster.
 *
 * **One mockup element is deliberately absent**: the **Davomat 92%** stat tile —
 * there is no attendance model at all (nothing records lesson presence), so the
 * tile row is two-up, not three-up. A fabricated number on a teacher's screen is
 * worse than a gap.
 *
 * **"Guruh xatolari"** is D1's "Ko'p uchragan xatolar" section fed by
 * `insights?group_id=` — the same rows, numbers and F6 "Mashq ber" as Analitika
 * filtered to this group, so the two can never disagree.
 *
 * Each "Faol topshiriqlar" row has a menu (⋯): move its deadline across the group
 * or take it back. The row is a Card with no press-scale, so the edge button stays
 * under the pointer.
 *
 * **«Sozlama»** (the mockup's fourth tab) is a sheet off the header — see
 * {@link GroupSettingsSheet} for why.
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
  onBack,
  onAssign,
  onInvite,
  onOpenStudent,
  onChangeDue,
  onCancelAssignment,
  groupErrors = null,
  errorsMinStudents = 0,
  onAssignRemediation,
  joinCode = "",
  onRename,
  onRegenerateCode,
  onRemoveMember,
  onDeleteGroup,
}: TeacherGroupDetailProps) {
  const { t } = useTranslation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  // An id, never a copy — the sheet reads the live row after the host refetches.
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const actionsRow = useMemo(
    () => assignments.find((a) => a.id === actionsFor) ?? null,
    [assignments, actionsFor],
  );
  const hasRowMenu = Boolean(onChangeDue || onCancelAssignment);
  const hasSettings = Boolean(onRename || onRegenerateCode || onRemoveMember || onDeleteGroup);

  return (
    <Page title={t("nav.classes")} width="wide">
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
          {hasSettings && (
            <Button
              variant="ghost"
              size="sm"
              className={styles.settingsBtn}
              onClick={() => setSettingsOpen(true)}
            >
              <GearGlyph />
              {t("teacher.groupSettings.open")}
            </Button>
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
          <Text as="h2" variant="label" color="muted">
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
                  <AssignmentRow
                    assignment={a}
                    onOpenMenu={hasRowMenu ? () => setActionsFor(a.id) : undefined}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        {groupErrors && (
          <ErrorsSection
            title={t("teacher.groupErrors")}
            errors={groupErrors}
            minStudents={errorsMinStudents}
            onAssignRemediation={onAssignRemediation}
          />
        )}

        <section className={styles.section} aria-label={t("teacher.tabStudents")}>
          <Text as="h2" variant="label" color="muted">
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

      {hasRowMenu && (
        <AssignmentActionsSheet
          open={actionsRow !== null}
          onClose={() => setActionsFor(null)}
          title={actionsRow?.title ?? ""}
          dueAt={actionsRow?.dueAt ?? null}
          onChangeDue={
            onChangeDue && actionsRow ? (due) => onChangeDue(actionsRow.id, due) : undefined
          }
          onCancel={
            onCancelAssignment && actionsRow ? () => onCancelAssignment(actionsRow.id) : undefined
          }
        />
      )}

      {hasSettings && (
        <GroupSettingsSheet
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          groupName={groupName}
          joinCode={joinCode}
          members={roster.map((s) => ({ id: s.id, fullName: s.fullName }))}
          onRename={onRename}
          onRegenerateCode={onRegenerateCode}
          onRemoveMember={onRemoveMember}
          onDelete={onDeleteGroup}
        />
      )}
    </Page>
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

function AssignmentRow({
  assignment,
  onOpenMenu,
}: {
  assignment: GroupActiveAssignment;
  onOpenMenu?: () => void;
}) {
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
        {onOpenMenu && (
          <button
            type="button"
            className={styles.menuBtn}
            onClick={onOpenMenu}
            aria-label={t("teacher.assignmentActions.menuAria", { task: assignment.title })}
          >
            <MoreGlyph />
          </button>
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
        <Text as="span" variant="body-s" color="muted" className={styles.score}>
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

function MoreGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

function GearGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
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
