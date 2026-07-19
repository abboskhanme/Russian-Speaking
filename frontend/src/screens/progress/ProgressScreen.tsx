import { useTranslation } from "react-i18next";
import { Badge, Card, Text, cx } from "../../shared/ui";
import type { TextColor } from "../../shared/ui";
import { AppShell, Brand, ThemeToggle, studentNavItems } from "../../widgets";
import type { NavItem, ThemeMode } from "../../widgets";
import {
  mockAchievements,
  mockBandTrend,
  mockLevel,
  mockStreak,
} from "./progress.mock";
import styles from "./ProgressScreen.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

/** One measured moment on the band trend (oldest → newest). */
export interface ProgressBandPoint {
  id: string;
  /** Short axis label under the bar (e.g. "1-h", "Mar", a date). */
  label: string;
  /** Level score 0..100 — positions the bar's height. */
  score: number;
  /** CEFR band reached at that point (e.g. "A2"). Optional caption. */
  band?: string;
}

export type TrendDirection = "up" | "down" | "flat";

export interface ProgressBandTrend {
  /** Ordered oldest → newest. Rendered as token-styled column bars. */
  points: ProgressBandPoint[];
  /** Current CEFR band headline (e.g. "A2"). */
  currentBand: string;
  /** Short kicker over the headline (default "Hozirgi daraja"). */
  kicker?: string;
  /** Optional delta caption (e.g. "7 haftada +18 ball"). */
  deltaLabel?: string;
  /** Delta direction → tone + arrow (up=success, down=danger, flat=muted). */
  deltaDir?: TrendDirection;
  /** Accessible caption for the bar group (default derived from currentBand). */
  ariaLabel?: string;
}

export interface ProgressLevel {
  /** Gamified level number (e.g. 7). */
  level: number;
  /** XP earned inside the current level. */
  xp: number;
  /** XP needed to reach the next level. */
  xpForNext: number;
  /** Lifetime XP — the accent headline chip. Hidden when omitted. */
  totalXp?: number;
  /** Next-level caption (e.g. "8-daraja"). */
  nextLabel?: string;
  /** XP unit label for the a11y text (default "XP"). */
  unit?: string;
}

export interface ProgressStreakDay {
  /** Single-letter / short day label (e.g. "Du", "Se"). */
  label: string;
  /** Whether the student practiced that day. */
  active: boolean;
  /** Marks "today" in the strip. */
  today?: boolean;
}

export interface ProgressStreak {
  /** Current streak length, in days. */
  current: number;
  /** Longest streak on record, in days. */
  longest: number;
  /** Optional 7-day strip. */
  week?: ProgressStreakDay[];
}

export type AchievementStatus = "earned" | "locked";

export interface ProgressAchievement {
  id: string;
  /** Emoji / short glyph rendered as text (paired with the title). */
  icon: string;
  title: string;
  /** Short description or progress hint. */
  description?: string;
  status: AchievementStatus;
  /** Locked badges: progress toward earning, 0..100. */
  progress?: number;
}

export interface ProgressScreenProps {
  bandTrend: ProgressBandTrend;
  level: ProgressLevel;
  streak: ProgressStreak;
  achievements: ProgressAchievement[];
  /** Active nav key (defaults to "progress"). */
  activeNavKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
  onToggleTheme?: (mode: ThemeMode) => void;
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * ProgressScreen — the student's "Progress" place (docs/04 §4.1: CEFR pozitsiya ·
 * trend · yutuqlar). Composed entirely from `shared/ui` + `widgets` + tokens.
 * Presentational and prop-driven: it fetches nothing and owns no state.
 *
 * Layout is full-width (docs/04 §4.10): AppShell frame → band-trend panel (bands
 * over time as token-styled column bars, exposed as a labeled `role="list"`) →
 * a "stats" row pairing the XP/level card with the streak card → the
 * achievements grid (earned / locked badges). Every colour / space / radius /
 * motion value is a token.
 */
export function ProgressScreen({
  bandTrend,
  level,
  streak,
  achievements,
  activeNavKey = "progress",
  onNavigate,
  onToggleTheme,
}: ProgressScreenProps) {
  const { t } = useTranslation();
  return (
    <AppShell
      brand={<Brand />}
      nav={{
        items: studentNavItems(t),
        activeKey: activeNavKey,
        onNavigate,
        label: t("nav.landmark"),
      }}
      headerStart={
        <Text as="h1" variant="title-m">
          {t("nav.progress")}
        </Text>
      }
      headerEnd={<ThemeToggle onChange={onToggleTheme} />}
    >
      <div className={styles.page}>
        <BandTrendCard trend={bandTrend} />

        <section className={styles.stats} aria-label={t("progress.statsAria")}>
          <LevelCard level={level} />
          <StreakCard streak={streak} />
        </section>

        <AchievementsSection achievements={achievements} />
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Band trend (bands over time — token-styled column bars, no chart lib)      */
/* -------------------------------------------------------------------------- */

function BandTrendCard({ trend }: { trend: ProgressBandTrend }) {
  const { t } = useTranslation();
  const dir = trend.deltaDir ?? "flat";
  const kicker = trend.kicker ?? t("progress.currentLevel");
  const lastIndex = trend.points.length - 1;
  const groupLabel =
    trend.ariaLabel ?? t("progress.trendAria", { band: trend.currentBand });

  return (
    <Card variant="outline" padding="lg" className={styles.trendCard}>
      <div className={styles.trendHead}>
        <div className={styles.trendHeadMeta}>
          <Text as="p" variant="label" color="faint">
            {kicker}
          </Text>
          <Text as="p" variant="display" numeric className={styles.trendBand}>
            {trend.currentBand}
          </Text>
        </div>
        {trend.deltaLabel && (
          <Text
            as="p"
            variant="body-s"
            weight="bold"
            color={DELTA_TEXT[dir]}
            className={styles.trendDelta}
          >
            <span aria-hidden>{DELTA_ARROW[dir]} </span>
            {trend.deltaLabel}
          </Text>
        )}
      </div>

      <div className={styles.trendBars} role="list" aria-label={groupLabel}>
        {trend.points.map((p, i) => (
          <div
            key={p.id}
            className={styles.trendCol}
            role="listitem"
            aria-label={`${p.label}: ${p.band ? `${p.band}, ` : ""}${t(
              "units.points",
              { count: Math.round(clampPct(p.score)) },
            )}`}
          >
            <span className={styles.trendTrack} aria-hidden>
              <span
                className={cx(
                  styles.trendFill,
                  i === lastIndex && styles.trendFillCurrent,
                )}
                style={{ height: `${clampPct(p.score)}%` }}
              />
            </span>
            <Text
              as="span"
              variant="body-s"
              color="muted"
              className={styles.trendColLabel}
            >
              {p.label}
            </Text>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* XP / level                                                                 */
/* -------------------------------------------------------------------------- */

function LevelCard({ level }: { level: ProgressLevel }) {
  const { t } = useTranslation();
  const unit = level.unit ?? "XP";
  const pct = clampPct(
    level.xpForNext > 0 ? (level.xp / level.xpForNext) * 100 : 0,
  );
  const remaining = Math.max(level.xpForNext - level.xp, 0);
  const next =
    level.nextLabel ?? t("progress.levelOrdinal", { n: level.level + 1 });

  return (
    <Card variant="outline" padding="lg" className={styles.levelCard}>
      <div className={styles.levelHead}>
        <span className={styles.levelBadge} aria-hidden>
          <StarGlyph />
        </span>
        <div className={styles.levelMeta}>
          <Text as="p" variant="label" color="faint">
            {t("progress.level")}
          </Text>
          <div className={styles.levelNum}>
            <Text as="span" variant="title-l" numeric>
              {t("progress.levelOrdinal", { n: level.level })}
            </Text>
            {level.totalXp !== undefined && (
              <Badge variant="accent" size="md">
                {level.totalXp} {unit}
              </Badge>
            )}
          </div>
        </div>
      </div>

      <div
        className={styles.xpBar}
        role="progressbar"
        aria-label={t("progress.toNextAria", { next, unit })}
        aria-valuemin={0}
        aria-valuemax={level.xpForNext}
        aria-valuenow={level.xp}
        aria-valuetext={`${level.xp} / ${level.xpForNext} ${unit}`}
      >
        <span className={styles.xpFill} style={{ width: `${pct}%` }} />
      </div>

      <Text as="p" variant="body-s" color="ink-soft">
        <Text as="span" variant="body-s" weight="bold" numeric>
          {level.xp} / {level.xpForNext} {unit}
        </Text>
        {" · "}
        {t("progress.toNext", { next, remaining, unit })}
      </Text>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Streak (current + longest + week strip)                                    */
/* -------------------------------------------------------------------------- */

function StreakCard({ streak }: { streak: ProgressStreak }) {
  const { t } = useTranslation();
  const week = streak.week ?? [];
  return (
    <Card variant="outline" padding="lg" className={styles.streakCard}>
      <div className={styles.streakTop}>
        <span className={styles.flameWrap} aria-hidden>
          <FlameGlyph />
        </span>
        <div className={styles.streakMeta}>
          <Text as="p" variant="label" color="faint">
            {t("progress.streak")}
          </Text>
          <div className={styles.streakNum}>
            <Text as="span" variant="title-l" numeric>
              {streak.current}
            </Text>
            <Text as="span" variant="body" color="muted">
              {t("units.daysUnit", { count: streak.current })}
            </Text>
          </div>
          <Text as="p" variant="body-s" color="ink-soft">
            {t("progress.longest")}{" "}
            <Text as="span" variant="body-s" weight="semibold" numeric>
              {streak.longest} {t("units.daysUnit", { count: streak.longest })}
            </Text>
          </Text>
        </div>
      </div>

      {week.length > 0 && (
        <div
          className={styles.week}
          role="list"
          aria-label={t("progress.weekAria")}
        >
          {week.map((d, i) => (
            <div
              key={i}
              className={styles.weekDay}
              role="listitem"
              aria-label={`${d.label}: ${
                d.active ? t("progress.done") : t("progress.notDone")
              }${d.today ? ` (${t("progress.today")})` : ""}`}
            >
              <span
                className={cx(
                  styles.weekDot,
                  d.active && styles.weekDotActive,
                  d.today && styles.weekDotToday,
                )}
                aria-hidden
              >
                {d.active && <CheckGlyph />}
              </span>
              <Text
                as="span"
                variant="body-s"
                color="muted"
                className={styles.weekLabel}
              >
                {d.label}
              </Text>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Achievements grid                                                          */
/* -------------------------------------------------------------------------- */

function AchievementsSection({
  achievements,
}: {
  achievements: ProgressAchievement[];
}) {
  const { t } = useTranslation();
  const earned = achievements.filter((a) => a.status === "earned").length;
  return (
    <section className={styles.achSection} aria-label={t("progress.achievements")}>
      <div className={styles.achHead}>
        <Text as="h2" variant="label" color="faint">
          {t("progress.achievements")}
        </Text>
        <Text as="span" variant="body-s" color="accent" weight="bold" numeric>
          {earned} / {achievements.length}
        </Text>
      </div>
      <ul className={styles.achGrid}>
        {achievements.map((a) => (
          <li key={a.id}>
            <AchievementCard achievement={a} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function AchievementCard({
  achievement,
}: {
  achievement: ProgressAchievement;
}) {
  const { t } = useTranslation();
  const earned = achievement.status === "earned";
  return (
    <Card
      variant={earned ? "outline" : "flat"}
      padding="md"
      className={cx(styles.achCard, !earned && styles.achLocked)}
    >
      <span
        className={cx(
          styles.achIcon,
          earned ? styles.achIconEarned : styles.achIconLocked,
        )}
        aria-hidden
      >
        {achievement.icon}
      </span>

      <Text as="p" variant="title-s" className={styles.achTitle}>
        {achievement.title}
      </Text>

      {achievement.description && (
        <Text as="p" variant="body-s" color="muted">
          {achievement.description}
        </Text>
      )}

      {earned ? (
        <Badge variant="success" size="sm" className={styles.achStatus}>
          {t("progress.unlocked")}
        </Badge>
      ) : (
        achievement.progress !== undefined && (
          <span
            className={styles.achBar}
            role="progressbar"
            aria-label={t("progress.achievementProgressAria", {
              title: achievement.title,
            })}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(clampPct(achievement.progress))}
          >
            <span
              className={styles.achBarFill}
              style={{ width: `${clampPct(achievement.progress)}%` }}
            />
          </span>
        )
      )}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Local helpers                                                              */
/* -------------------------------------------------------------------------- */

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, n));
}

const DELTA_TEXT: Record<TrendDirection, TextColor> = {
  up: "success",
  down: "danger",
  flat: "muted",
};

const DELTA_ARROW: Record<TrendDirection, string> = {
  up: "↑",
  down: "↓",
  flat: "→",
};

function StarGlyph() {
  return (
    <svg
      className={styles.glyph}
      width="22"
      height="22"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path
        d="M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 16.5 7.1 18.2l.9-5.5-4-3.9 5.5-.8z"
        fill="currentColor"
      />
    </svg>
  );
}

function FlameGlyph() {
  return (
    <svg
      className={styles.glyph}
      width="26"
      height="26"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path
        d="M12 3c1 3-2 4-2 7a4 4 0 0 0 8 0c0-1-.5-2-1-2.5.2 2-1 3-1.5 2 .8-3-1.5-5.5-3.5-6.5z"
        fill="currentColor"
      />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 12.5 10 17l9-10"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Default export — a self-wired demo, renderable in isolation.               */
/* -------------------------------------------------------------------------- */

/**
 * ProgressScreenDemo — drop-in standalone preview wired to the mock fixture, so
 * the Progress screen renders end-to-end with no backend.
 */
export default function ProgressScreenDemo() {
  return (
    <ProgressScreen
      bandTrend={mockBandTrend}
      level={mockLevel}
      streak={mockStreak}
      achievements={mockAchievements}
      onNavigate={() => undefined}
    />
  );
}
