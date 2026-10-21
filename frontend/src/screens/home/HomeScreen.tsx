import { useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, Mascot, Text, cx } from "../../shared/ui";
import { AppShell, NotificationsBell, studentNavItems } from "../../widgets";
import type { NavItem } from "../../widgets";
import {
  mockHomeGroup,
  mockHomeStats,
  mockHomeToday,
  mockHomeUser,
} from "./home.mock";
import styles from "./HomeScreen.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

export interface HomeUser {
  /** First name shown in the greeting (e.g. "Aziz"). */
  name: string;
}

/** Today's practice session — the hero card. */
export interface HomeToday {
  /** Daily goal in minutes (e.g. 5). */
  goalMinutes: number;
  /**
   * Practice seconds done TODAY — fills the segmented progress.
   *
   * `null` means UNKNOWN (the stats read failed), not zero. The bar is then left
   * out entirely rather than drawn empty: an empty bar is a claim that nothing was
   * practised today, and that claim is exactly what the app cannot make when it
   * could not reach the endpoint that knows.
   */
  doneSeconds: number | null;
}

/**
 * F3 · today's daily session, when the deployment has `daily_five_enabled` on.
 *
 * Null is the FLAG-OFF answer as well as the "not loaded" one, and both mean the
 * same thing to this screen: draw the card exactly as it was drawn before F3
 * existed. A flagged-off feature must leave no trace on Home — not a greyed
 * entry, not an empty rail — because a person who can never switch it on should
 * never learn it exists.
 */
export interface HomeDaily {
  /** How many steps today's session has (2 or 3 — the drill is skipped when the
   * SRS queue is clear). */
  total: number;
  /** How many of them are finished. */
  done: number;
  /** Every observable step is done. The card says so and stops nagging. */
  completed: boolean;
  /** Today's session has a correction step. The tagline promises "kechagi xatoni
   * tuzatish" ONLY then — on a day with nothing due it is a promise of a step
   * that does not exist. */
  hasDrill: boolean;
}

/** The next incomplete assignment, or null when there is none. */
export interface HomeAssignment {
  /** The assignment's TASK (`question_id`) — what tapping the row opens. */
  taskId: string;
  title: string;
  /** ISO-8601 deadline, or null for no deadline. */
  dueAt: string | null;
}

/** The student's group + teacher — null when they learn independently. */
export interface HomeGroup {
  teacherName: string | null;
  /** Group display name (e.g. "B1 · Kechki-3"). */
  name: string;
  memberCount: number;
  nextAssignment: HomeAssignment | null;
}

/** The three "QISQACHA" cells. */
export interface HomeStats {
  /** CEFR level (e.g. "A2"), or null before the first graded attempt. */
  level: string | null;
  /** Practice minutes this week. */
  weekMinutes: number;
  currentStreak: number;
}

export interface HomeScreenProps {
  user: HomeUser;
  today: HomeToday;
  /** Null → the "O'QITUVCHINGIZ" block is replaced by a quiet independent state. */
  group: HomeGroup | null;
  /**
   * The QISQACHA figures, or `null` when they could not be loaded.
   *
   * Null is a THIRD state, and it exists because the second-worst thing this
   * screen can do is show zeros. A student with a 40-day streak who opens Home
   * during a stats outage reads "0" as "I lost it" — the number is not merely
   * stale, it is the specific wrong number that describes the thing they are
   * afraid of. A gap says "I don't know"; a zero says "you have none".
   *
   * There is no loading value here on purpose: the page holds its own spinner
   * until the first round of fetches settles, so this screen only ever renders a
   * settled outcome.
   */
  stats: HomeStats | null;
  /** Today's F3 session, or null when the flag is off (see {@link HomeDaily}). */
  daily?: HomeDaily | null;
  /** Re-fetch the QISQACHA figures after a failure. Without it the only way out
   * of the failed state is a full page reload, which costs the student everything
   * else on the screen to recover one card. */
  onRetryStats?: () => void;
  /** Start today's practice (the "Boshlash" CTA). */
  onStart?: () => void;
  /** Message the teacher (the "Yozish" action). Hidden when absent. */
  onMessageTeacher?: () => void;
  /** Join a group by code — wired only for a group-less student (NoGroupCard).
   * Rejects on a bad code so the card can surface the error. */
  onJoinGroup?: (code: string) => Promise<void>;
  /**
   * The group name the student is WAITING to be approved into, if any.
   *
   * Joining files a request the teacher must approve, so between asking and
   * being admitted the student is in neither state: not a member, but not
   * group-less either. Without this the join form would simply re-render and the
   * request would look like it had silently failed.
   */
  pendingGroupName?: string | null;
  /** Open the group screen (classmates + group leaderboard) from the group row. */
  onOpenGroup?: () => void;
  /** Open the next assignment's task (the "Keyingi topshiriq" row). The row is a
   * plain line when absent. */
  onOpenAssignment?: (taskId: string) => void;
  /**
   * What became of an invite link (`/j/:code`) this visit, already localized —
   * shown only when it needs saying: a bad code or a failed request. A request
   * that WAS filed needs no banner: the waiting card below already says so.
   */
  joinNotice?: string | null;
  /** Dismiss {@link joinNotice}. */
  onDismissJoinNotice?: () => void;
  activeNavKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * HomeScreen — the student's "Bosh" place, rebuilt to the owner's mockup: a
 * hero "today's practice" card (with Govo), the teacher + group block (only when
 * the student belongs to a group), and a three-cell "QISQACHA" summary. A
 * group-less student gets the same interactive layout minus the group block.
 *
 * Presentational + prop-driven: it fetches nothing. Full-width (docs/04 §4.10);
 * every colour / space / radius / motion value is a token.
 */
export function HomeScreen({
  user,
  today,
  group,
  stats,
  onRetryStats,
  daily = null,
  onStart,
  onMessageTeacher,
  onJoinGroup,
  pendingGroupName,
  onOpenGroup,
  onOpenAssignment,
  joinNotice,
  onDismissJoinNotice,
  activeNavKey = "home",
  onNavigate,
}: HomeScreenProps) {
  const { t } = useTranslation();

  return (
    <AppShell
      nav={{
        items: studentNavItems(t),
        activeKey: activeNavKey,
        onNavigate,
        label: t("nav.landmark"),
      }}
      headerStart={
        <Text as="h1" variant="title-l" truncate className={styles.greeting}>
          {t("home.greetHi", { name: user.name })}
        </Text>
      }
      headerEnd={<NotificationsBell />}
    >
      <div className={styles.page}>
        <TodayCard today={today} daily={daily} onStart={onStart} />

        {joinNotice && (
          <Card variant="outline" padding="md" className={styles.joinNotice} role="alert">
            <Text as="p" variant="body-s" color="danger" className={styles.joinNoticeText}>
              {joinNotice}
            </Text>
            {onDismissJoinNotice && (
              <Button variant="ghost" size="sm" onClick={onDismissJoinNotice}>
                {t("common.close")}
              </Button>
            )}
          </Card>
        )}

        {group ? (
          <TeacherSection
            group={group}
            onMessageTeacher={onMessageTeacher}
            onOpenGroup={onOpenGroup}
            onOpenAssignment={onOpenAssignment}
          />
        ) : pendingGroupName ? (
          <PendingGroupCard groupName={pendingGroupName} />
        ) : (
          <NoGroupCard onJoin={onJoinGroup} />
        )}

        <section className={styles.section} aria-label={t("home.summary")}>
          <Text as="h2" variant="label" color="muted" className={styles.sectionLabel}>
            {t("home.summary")}
          </Text>
          <div className={styles.statGrid}>
            {/* An em dash in every cell, not a zero. The three cells keep their
                labels so the layout does not jump when the retry succeeds. */}
            <StatCell value={stats ? (stats.level ?? "—") : "—"} label={t("home.statLevel")} />
            <StatCell
              value={stats ? String(stats.weekMinutes) : "—"}
              unit={stats ? t("home.statWeekUnit") : undefined}
              label={t("home.statWeek")}
            />
            <StatCell
              value={stats ? String(stats.currentStreak) : "—"}
              label={t("home.statStreak")}
            />
          </div>
          {!stats && (
            <div className={styles.statsError} role="status">
              <Text as="span" variant="body-s" color="muted">
                {t("home.statsFailed")}
              </Text>
              {onRetryStats && (
                <Button variant="ghost" size="sm" onClick={onRetryStats}>
                  {t("common.retry")}
                </Button>
              )}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Today's practice — the hero card                                           */
/* -------------------------------------------------------------------------- */

function TodayCard({
  today,
  daily,
  onStart,
}: {
  today: HomeToday;
  daily: HomeDaily | null;
  onStart?: () => void;
}) {
  const { t } = useTranslation();
  const goalSec = Math.max(today.goalMinutes, 1) * 60;
  // Unknown stays unknown: with no figure there is no bar, rather than a bar
  // drawn at zero that reads as "you have done nothing today".
  const fraction = today.doneSeconds === null ? null : Math.min(today.doneSeconds / goalSec, 1);

  return (
    <Card variant="raised" padding="lg" className={styles.todayCard}>
      <span className={styles.todayMascot} aria-hidden>
        <Mascot mood={daily?.completed ? "proud" : "idle"} size={72} label="Govo" />
      </span>

      <div className={styles.todayBody}>
        <Text as="p" variant="label" className={styles.todayKicker}>
          {t("home.todayLabel")}
        </Text>
        <Text as="p" variant="title-l" className={styles.todayTitle}>
          {t("home.todayTitle", { count: today.goalMinutes, min: today.goalMinutes })}
        </Text>
        <Text as="p" variant="body" color="muted">
          {daily?.completed
            ? t("home.dailyDone")
            : daily?.hasDrill
              ? t("home.todayTagline")
              : t("home.todayTaglineNoDrill")}
        </Text>

        {/* With F3 on, the session IS today's practice, so the card counts steps
            rather than seconds-toward-a-goal — a truer number, and the only one
            the student can act on. With it off the seconds bar stays exactly as
            it was: the flag must leave no trace on this card. */}
        {daily ? (
          <StepDots done={daily.done} total={daily.total} />
        ) : fraction !== null ? (
          <SegmentBar fraction={fraction} />
        ) : null}

        <div className={styles.todayActions}>
          <Button variant="primary" size="lg" onClick={onStart}>
            {daily
              ? daily.completed
                ? t("home.dailyReview")
                : daily.done > 0
                  ? t("common.continue")
                  : t("home.start")
              : t("home.start")}
            <ArrowGlyph />
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** The session's steps as ● ○ ○ plus the count in words (docs/04 §4.5). The dots
 * are decorative — the text beside them carries the same fact, so the progress is
 * never colour-or-shape only. */
function StepDots({ done, total }: { done: number; total: number }) {
  const { t } = useTranslation();
  return (
    <div className={styles.stepRow}>
      <span className={styles.stepDots} aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={cx(styles.stepDot, i < done && styles.stepDotOn)} />
        ))}
      </span>
      <Text as="span" variant="body-s" color="muted">
        {t("home.stepsValueText", { done, total })}
      </Text>
    </div>
  );
}

/** Three segments filling continuously with the day's progress. */
function SegmentBar({ fraction }: { fraction: number }) {
  const segments = [0, 1, 2].map((i) => {
    // Each segment covers a third; spread the total fill across them.
    const fill = Math.max(0, Math.min((fraction - i / 3) / (1 / 3), 1));
    return fill;
  });
  return (
    <div className={styles.segments} aria-hidden>
      {segments.map((fill, i) => (
        <span key={i} className={styles.segment}>
          <span className={styles.segmentFill} style={{ width: `${fill * 100}%` }} />
        </span>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Teacher + group                                                            */
/* -------------------------------------------------------------------------- */

function TeacherSection({
  group,
  onMessageTeacher,
  onOpenGroup,
  onOpenAssignment,
}: {
  group: HomeGroup;
  onMessageTeacher?: () => void;
  onOpenGroup?: () => void;
  onOpenAssignment?: (taskId: string) => void;
}) {
  const { t } = useTranslation();
  const teacher = group.teacherName ?? t("home.teacherRole");

  const groupInner = (
    <>
      <span className={styles.groupLineStart}>
        <PeopleGlyph />
        <Text as="span" variant="body" weight="semibold">
          {t("home.groupLine", { name: group.name })}
        </Text>
      </span>
      <span className={styles.groupLineEnd}>
        <Text as="span" variant="body-s" color="muted">
          {t("home.students", { count: group.memberCount })}
        </Text>
        {onOpenGroup && (
          <span className={styles.groupChevron} aria-hidden>
            <ChevronGlyph />
          </span>
        )}
      </span>
    </>
  );

  return (
    <section className={styles.section} aria-label={t("home.teacherSection")}>
      <Text as="h2" variant="label" color="muted" className={styles.sectionLabel}>
        {t("home.teacherSection")}
      </Text>

      <Card variant="raised" padding="lg" className={styles.teacherCard}>
        <div className={styles.teacherRow}>
          <span className={styles.avatar} aria-hidden>
            {initials(group.teacherName ?? "")}
          </span>
          <div className={styles.teacherMeta}>
            <Text as="p" variant="title-s" truncate>
              {teacher}
            </Text>
            <Text as="p" variant="body-s" color="muted">
              {t("home.teacherRole")}
            </Text>
          </div>
          {onMessageTeacher && (
            <Button variant="secondary" size="sm" onClick={onMessageTeacher}>
              {t("home.message")}
            </Button>
          )}
        </div>

        {onOpenGroup ? (
          <button
            type="button"
            className={cx(styles.groupLine, styles.groupLineBtn)}
            onClick={onOpenGroup}
            aria-label={t("groupBoard.open", { name: group.name })}
          >
            {groupInner}
          </button>
        ) : (
          <div className={styles.groupLine}>{groupInner}</div>
        )}

        {group.nextAssignment && (
          <NextAssignmentRow assignment={group.nextAssignment} onOpen={onOpenAssignment} />
        )}
      </Card>
    </section>
  );
}

/**
 * "Keyingi topshiriq · ertaga 21:00" + the task's name — and the way INTO it.
 *
 * It used to be a plain div: the student could read what was due and then had to
 * go and find it. It is now a button onto the task (the assignment's `question_id`,
 * never the assignment row's id). An undated assignment reads "Keyingi topshiriq"
 * alone — the dated key with an empty `when` left a dangling "Keyingi topshiriq ·".
 * No press-scale: the row is wide, and shrinking it under the pointer is exactly
 * how a click gets lost.
 */
function NextAssignmentRow({
  assignment,
  onOpen,
}: {
  assignment: HomeAssignment;
  onOpen?: (taskId: string) => void;
}) {
  const { t } = useTranslation();
  const when = formatWhen(t, assignment.dueAt);
  const heading = when ? t("home.nextAssignment", { when }) : t("home.nextAssignmentUndated");

  const inner = (
    <>
      <span className={styles.assignmentIcon} aria-hidden>
        <ClockGlyph />
      </span>
      <span className={styles.assignmentBody}>
        <Text as="span" variant="body" weight="bold" className={styles.assignmentTitle}>
          {heading}
        </Text>
        <Text as="span" variant="body-s" color="ink-soft">
          {assignment.title}
        </Text>
      </span>
      {onOpen && (
        <span className={styles.groupChevron} aria-hidden>
          <ChevronGlyph />
        </span>
      )}
    </>
  );

  if (!onOpen) return <div className={styles.assignment}>{inner}</div>;
  return (
    <button
      type="button"
      className={cx(styles.assignment, styles.assignmentBtn)}
      onClick={() => onOpen(assignment.taskId)}
      aria-label={t("home.openAssignment", { title: assignment.title })}
    >
      {inner}
    </button>
  );
}

/**
 * PendingGroupCard — "so'rov yuborildi, o'qituvchi tasdiqlashini kuting".
 *
 * The third state between {@link TeacherSection} (a member) and
 * {@link NoGroupCard} (in no group and not waiting). It exists because joining
 * only files a request: showing the join form again here would read as "that
 * didn't work, try once more" and produce duplicate asks.
 */
function PendingGroupCard({ groupName }: { groupName: string }) {
  const { t } = useTranslation();
  return (
    <Card variant="tint" padding="lg" className={styles.noGroup}>
      <span className={styles.noGroupIcon} aria-hidden>
        <PeopleGlyph />
      </span>
      <div className={styles.noGroupBody}>
        <Text as="p" variant="title-s">
          {t("home.joinPending")}
        </Text>
        <Text as="p" variant="body-s" color="ink-soft">
          {groupName} · {t("home.joinPendingHint")}
        </Text>
      </div>
    </Card>
  );
}

/**
 * NoGroupCard — the group-less state, now an actionable join form: the student
 * enters the teacher's join code and taps to join. On success the parent refetch
 * swaps this card for the group block; a bad code surfaces an inline error.
 * `onJoin` is optional so the card still renders (input disabled) if unwired.
 */
function NoGroupCard({ onJoin }: { onJoin?: (code: string) => Promise<void> }) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (!c || busy || !onJoin) return;
    setBusy(true);
    setError(null);
    try {
      await onJoin(c);
      // Success → the parent refetch unmounts this card (group block appears),
      // so there is nothing to reset here.
    } catch {
      setError(t("home.joinError"));
      setBusy(false);
    }
  };

  return (
    <Card variant="tint" padding="lg" className={styles.noGroup}>
      <span className={styles.noGroupIcon} aria-hidden>
        <PeopleGlyph />
      </span>
      <div className={styles.noGroupBody}>
        <Text as="p" variant="title-s">
          {t("home.noGroup")}
        </Text>
        <Text as="p" variant="body-s" color="ink-soft">
          {t("home.noGroupHint")}
        </Text>

        <form className={styles.joinForm} onSubmit={submit}>
          <input
            className={styles.joinInput}
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={12}
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              if (error) setError(null);
            }}
            placeholder={t("home.joinPlaceholder")}
            aria-label={t("home.joinPlaceholder")}
            aria-invalid={error ? true : undefined}
            disabled={busy || !onJoin}
          />
          <Button
            type="submit"
            variant="primary"
            size="md"
            loading={busy}
            disabled={!code.trim() || busy || !onJoin}
          >
            {t("home.joinCta")}
          </Button>
        </form>

        {error && (
          <Text as="p" variant="body-s" color="danger" role="alert">
            {error}
          </Text>
        )}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Summary cell                                                               */
/* -------------------------------------------------------------------------- */

function StatCell({
  value,
  unit,
  label,
}: {
  value: string;
  unit?: string;
  label: string;
}) {
  return (
    <Card variant="outline" padding="md" className={styles.statCell}>
      <span className={styles.statValueRow}>
        <Text as="span" variant="title-l" numeric className={styles.statValue}>
          {value}
        </Text>
        {unit && (
          <Text as="span" variant="body-s" color="muted" className={styles.statUnit}>
            {unit}
          </Text>
        )}
      </span>
      <Text as="span" variant="body-s" color="muted">
        {label}
      </Text>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Local helpers + glyphs                                                     */
/* -------------------------------------------------------------------------- */

/** First letters of up to two name words, uppercased (avatar fallback). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const chars = [parts[0], parts[parts.length - 1]]
    .slice(0, parts.length === 1 ? 1 : 2)
    .map((p) => p.charAt(0).toUpperCase());
  return chars.join("");
}

/** Format an assignment deadline relative to now, localised. */
function formatWhen(
  t: (key: string, opts?: Record<string, unknown>) => string,
  iso: string | null,
): string {
  if (!iso) return "";
  const due = new Date(iso);
  if (Number.isNaN(due.getTime())) return "";
  const now = new Date();
  // 24-hour ("21:00"), matching the mockup — never the runtime's 12-hour default.
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(due);

  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayDiff = Math.round(
    (startOfDay(due).getTime() - startOfDay(now).getTime()) / 86_400_000,
  );

  if (due.getTime() < now.getTime() && dayDiff < 0) return t("home.when.overdue");
  if (dayDiff <= 0) return t("home.when.today", { time });
  if (dayDiff === 1) return t("home.when.tomorrow", { time });
  const date = new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "2-digit" }).format(due);
  return t("home.when.date", { date, time });
}

function ArrowGlyph() {
  return (
    <svg className={styles.glyph} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 12h13m0 0-5-5m5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PeopleGlyph() {
  return (
    <svg className={styles.glyph} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="9" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M16 6.2a3 3 0 0 1 0 5.6M17.5 19a5.5 5.5 0 0 0-3-4.9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ClockGlyph() {
  return (
    <svg className={styles.glyph} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="13" r="8" stroke="currentColor" strokeWidth="1.9" />
      <path d="M12 9v4l2.5 2M9 3h6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

function ChevronGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="m9 6 6 6-6 6"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Default export — a self-wired demo.                                        */
/* -------------------------------------------------------------------------- */

export default function HomeScreenDemo() {
  return (
    <HomeScreen
      user={mockHomeUser}
      today={mockHomeToday}
      group={mockHomeGroup}
      stats={mockHomeStats}
      onStart={() => undefined}
      onMessageTeacher={() => undefined}
      onNavigate={() => undefined}
    />
  );
}
