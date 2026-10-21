import { useTranslation } from "react-i18next";
import { Button, Card, ProgressRing, Text, VisuallyHidden, cx } from "../../shared/ui";

import styles from "./MotivationPanel.module.css";

/** Lifetime XP placed on the shared level curve (`/api/profile/stats`). */
export interface HomeXp {
  total: number;
  level: number;
  /** XP at which the current level began. */
  levelStart: number;
  /** XP at which the next level begins. */
  nextLevelAt: number;
}

export interface MotivationPanelProps {
  /** Null → the figures could not be loaded: every value reads "—", never 0. */
  stats: {
    level: string | null;
    weekMinutes: number;
    currentStreak: number;
    /** Seven days, oldest first, today last. Null/absent → the strip is left out. */
    activeDays?: boolean[] | null;
    xp?: HomeXp | null;
  } | null;
  goalMinutes: number;
  /** Practice seconds today; null = unknown. */
  doneSeconds: number | null;
  onRetry?: () => void;
  /** "Today" for the weekday letters — injectable for tests. */
  now?: Date;
}

/**
 * MotivationPanel — the Home "how am I doing" block: the streak with a flame and
 * the week's practice dots, the daily-goal ring, the CEFR level + week minutes,
 * and the XP level bar. Restraint over clutter: one warm accent (the brand
 * orange) carries every "you did it" mark; everything else is ink and lines.
 *
 * Unknown is never drawn as zero: a failed read shows "—" in every slot, and a
 * missing week strip / XP block is simply left out.
 */
export function MotivationPanel({ stats, goalMinutes, doneSeconds, onRetry, now }: MotivationPanelProps) {
  const { t } = useTranslation();
  const goalSec = Math.max(goalMinutes, 1) * 60;
  const doneMin = doneSeconds === null ? null : Math.floor(doneSeconds / 60);
  const fraction = doneSeconds === null ? 0 : Math.min(doneSeconds / goalSec, 1);
  const goalMet = doneSeconds !== null && doneSeconds >= goalSec;
  const streak = stats?.currentStreak ?? null;
  const days = stats?.activeDays && stats.activeDays.length === 7 ? stats.activeDays : null;

  return (
    <section className={styles.section} aria-label={t("home.summary")}>
      <Text as="h2" variant="label" color="muted" className={styles.sectionLabel}>
        {t("home.summary")}
      </Text>

      <div className={styles.grid}>
        {/* ---- Streak + week strip ---- */}
        <Card variant="raised" padding="md" className={cx(styles.cell, styles.streak)}>
          <div className={styles.streakHead}>
            <Flame lit={!!streak} />
            <div className={styles.streakText}>
              <Text as="p" variant="title-l" numeric className={styles.bigNum}>
                {streak === null ? "—" : streak}
              </Text>
              <Text as="p" variant="body-s" color="muted">
                {streak === null
                  ? t("home.statStreak")
                  : streak > 0
                    ? t("motivation.streakDays", { count: streak })
                    : t("motivation.streakZero")}
              </Text>
            </div>
          </div>
          {days && <WeekStrip days={days} now={now ?? new Date()} />}
        </Card>

        {/* ---- Daily goal ring ---- */}
        <Card variant="outline" padding="md" className={cx(styles.cell, styles.goal)}>
          <ProgressRing
            value={fraction}
            size={76}
            stroke={8}
            tone={goalMet ? "success" : "primary"}
            label={
              doneMin === null
                ? t("motivation.goalLabel")
                : t("motivation.goalAria", { done: Math.min(doneMin, goalMinutes), goal: goalMinutes })
            }
          >
            {goalMet ? (
              <CheckGlyph />
            ) : (
              <Text as="span" variant="title-m" numeric className={styles.ringNum}>
                {doneMin === null ? "—" : doneMin}
              </Text>
            )}
          </ProgressRing>
          <div className={styles.goalText}>
            <Text as="p" variant="body" weight="bold">
              {t("motivation.goalLabel")}
            </Text>
            <Text as="p" variant="body-s" color={goalMet ? "success" : "muted"} className={goalMet ? styles.successInk : undefined}>
              {goalMet ? t("motivation.goalDone") : t("motivation.goalOf", { goal: goalMinutes })}
            </Text>
          </div>
        </Card>

        {/* ---- CEFR level + week minutes ---- */}
        <Card variant="outline" padding="md" className={cx(styles.cell, styles.level)}>
          <div className={styles.miniStat}>
            <Text as="span" variant="title-l" numeric className={styles.bigNum}>
              {stats?.level ?? "—"}
            </Text>
            <Text as="span" variant="body-s" color="muted">
              {t("home.statLevel")}
            </Text>
          </div>
          <div className={styles.miniStat}>
            <span className={styles.valueRow}>
              <Text as="span" variant="title-m" numeric className={styles.bigNum}>
                {stats ? stats.weekMinutes : "—"}
              </Text>
              {stats && (
                <Text as="span" variant="body-s" color="muted">
                  {t("home.statWeekUnit")}
                </Text>
              )}
            </span>
            <Text as="span" variant="body-s" color="muted">
              {t("home.statWeek")}
            </Text>
          </div>
        </Card>

        {/* ---- XP level bar ---- */}
        {stats?.xp && <XpBar xp={stats.xp} />}
      </div>

      {!stats && (
        <div className={styles.error} role="status">
          <Text as="span" variant="body-s" color="muted">
            {t("home.statsFailed")}
          </Text>
          {onRetry && (
            <Button variant="ghost" size="sm" onClick={onRetry}>
              {t("common.retry")}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function WeekStrip({ days, now }: { days: boolean[]; now: Date }) {
  const { t } = useTranslation();
  const count = days.filter(Boolean).length;
  const todayDow = now.getDay();
  return (
    <div className={styles.week}>
      <VisuallyHidden>{t("motivation.weekAria", { count })}</VisuallyHidden>
      <ol className={styles.weekList} aria-hidden>
        {days.map((on, i) => {
          const dow = (todayDow - (6 - i) + 7) % 7;
          const isToday = i === 6;
          return (
            <li key={i} className={styles.day} data-testid="week-day" data-on={on || undefined}>
              <span className={cx(styles.dot, on && styles.dotOn, isToday && !on && styles.dotToday)}>
                {on && <SmallCheck />}
              </span>
              <span className={cx(styles.dayLetter, isToday && styles.dayLetterToday)}>
                {t(`motivation.weekday.${dow}`)}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function XpBar({ xp }: { xp: HomeXp }) {
  const { t } = useTranslation();
  const span = Math.max(xp.nextLevelAt - xp.levelStart, 1);
  const into = Math.min(Math.max(xp.total - xp.levelStart, 0), span);
  const pct = (into / span) * 100;
  return (
    <Card variant="outline" padding="md" className={cx(styles.cell, styles.xp)}>
      <div className={styles.xpHead}>
        <span className={styles.xpBadge}>
          <StarGlyph />
          <Text as="span" variant="body-s" weight="bold" className={styles.xpBadgeText}>
            {t("motivation.xpLevel", { level: xp.level })}
          </Text>
        </span>
        <Text as="span" variant="body-s" weight="bold" numeric>
          {t("motivation.xpTotal", { xp: xp.total })}
        </Text>
      </div>
      <span
        className={styles.xpTrack}
        role="progressbar"
        aria-label={t("motivation.xpLevel", { level: xp.level })}
        aria-valuemin={xp.levelStart}
        aria-valuemax={xp.nextLevelAt}
        aria-valuenow={Math.min(xp.total, xp.nextLevelAt)}
      >
        <span className={styles.xpFill} style={{ width: `${pct}%` }} />
      </span>
      <Text as="p" variant="body-s" color="muted">
        {t("motivation.xpToNext", { xp: xp.nextLevelAt - Math.max(xp.total, xp.levelStart), next: xp.level + 1 })}
      </Text>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Glyphs (decorative)                                                        */
/* -------------------------------------------------------------------------- */

/** The streak flame — brand orange with a warm core when the streak is alive,
 * a quiet outline when it is not (never a "lost" red). */
function Flame({ lit }: { lit: boolean }) {
  return (
    <span className={cx(styles.flame, lit && styles.flameLit)} aria-hidden>
      <svg width="44" height="52" viewBox="0 0 44 52" fill="none">
        <path
          className={styles.flameOuter}
          d="M22 2c2 8 10 12 13 20 4 10-1 26-13 26S5 38 8 26c1.5-6 6-9 7-15 4 3 5 8 5 11 3-5 3-13 2-20z"
        />
        <path
          className={styles.flameInner}
          d="M22 26c1 4 6 6 6 12a6 6 0 0 1-12 0c0-4 3-5 4-9 1 1 2 2 2 3z"
        />
      </svg>
    </span>
  );
}

function CheckGlyph() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden className={styles.ringCheck}>
      <path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SmallCheck() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StarGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
      <path d="M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 16.5 7.1 18.2l.9-5.5-4-3.9 5.5-.8z" fill="currentColor" />
    </svg>
  );
}
