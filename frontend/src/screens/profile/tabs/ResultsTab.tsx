import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Button, Card, Text, VisuallyHidden, StatTile, cx } from "../../../shared/ui";
import styles from "./ResultsTab.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

/** Direction of an attempt's band vs. the chronologically previous one. */
export type ResultTrend = "up" | "down" | "flat";

export interface ResultsTabStats {
  /** Total submissions the student has made. */
  attempts: number;
  /** Mean `Evaluation.OverallBand`. `null` when nothing has been graded yet. */
  avgBand: number | null;
  /** Consecutive practice days. */
  currentStreak: number;
  /** Sum of `Submission.AudioDurationSec`; rendered as hours to 1dp. */
  totalPracticeSec: number;
  /** Lifetime XP — the headline gamification number, shown in the XP banner. */
  xp: number;
}

export interface ResultsTabResult {
  id: string;
  title: string;
  /** Rounded band, 0..100. */
  band: number;
  /** ISO-8601 timestamp of the attempt. */
  createdAt: string;
  trend: ResultTrend;
}

export interface ResultsTabAchievement {
  /**
   * Stable backend id — one of the 16-badge catalogue keys ("first_step",
   * "attempts_50", "streak_7", "level_b1", "score_90", "practice_5h",
   * "group_member", …). Titles + descriptions are looked up in i18n by this key.
   */
  key: string;
  /** Raw natural-unit progress (attempts / days / minutes / 0..1), NOT capped at target. */
  progress: number;
  target: number;
  unlocked: boolean;
}

export interface ResultsTabProps {
  stats: ResultsTabStats;
  /** Most recent graded attempts, newest first. Empty → a muted empty state. Only
   * the first {@link RECENT_CAP} are shown here; the rest live behind "Barcha natijalar". */
  results: ResultsTabResult[];
  achievements: ResultsTabAchievement[];
  /** Open one attempt's detail by submission id. Omit → rows are non-interactive. */
  onOpenResult?: (id: string) => void;
  /** Open the full "Barcha natijalar" history. Omit → the button is hidden. */
  onSeeAll?: () => void;
}

/** How many recent results the Profile tab shows before "Barcha natijalar". */
const RECENT_CAP = 10;

/* -------------------------------------------------------------------------- */
/* Tab                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * ResultsTab — the "Natijalar" tab body of the Profile screen.
 *
 * Presentational and prop-driven: it fetches nothing and owns no state. Layout
 * is full-width (docs/04 §4.10) — a 2×2 `StatTile` grid, the SO'NGGI NATIJALAR
 * list, then the YUTUQLAR grid. Every colour / space / radius / motion value is
 * a token. The shell owns the `role="tabpanel"` wrapper.
 */
export function ResultsTab({ stats, results, achievements, onOpenResult, onSeeAll }: ResultsTabProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  // Number formatting follows the active UI language, so Russian gets "6,4".
  const formatters = useMemo(
    () => ({
      /** Whole numbers (attempts, streak). */
      int: new Intl.NumberFormat(lang, { maximumFractionDigits: 0 }),
      /** Average band — 1dp, but "72" stays "72" rather than "72.0". */
      band: new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }),
      /** Practice hours — always exactly 1dp, per the contract. */
      hours: new Intl.NumberFormat(lang, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }),
    }),
    [lang],
  );

  // A single "now" for the whole render keeps every relative date consistent.
  const now = useMemo(() => new Date(), []);

  const hours = stats.totalPracticeSec / 3600;

  // "X/16 ochildi" beside the YUTUQLAR header — count of unlocked over the total catalogue.
  const unlockedCount = achievements.filter((a) => a.unlocked).length;
  const achievementTotal = achievements.length;

  return (
    <div className={styles.tab}>
      {/* ---- XP banner: the headline gamification number ---- */}
      <div className={styles.xpBanner}>
        <span className={styles.xpIcon} aria-hidden>
          ⚡
        </span>
        <div className={styles.xpBody}>
          <Text as="span" variant="display" numeric className={styles.xpValue}>
            {formatters.int.format(stats.xp)}
          </Text>
          <Text as="span" variant="label" className={styles.xpLabel}>
            {t("profile.xp.total")}
          </Text>
          <Text as="span" variant="body-s" className={styles.xpCaption}>
            {t("profile.xp.caption")}
          </Text>
        </div>
      </div>

      {/* ---- 2×2 stat tiles ---- */}
      <div className={styles.statGrid}>
        <StatTile
          variant="outline"
          value={formatters.int.format(stats.attempts)}
          label={t("profile.stats.attempts")}
        />
        <StatTile
          variant="outline"
          // No graded attempt means there is no average — showing 0 would lie.
          value={
            stats.avgBand === null ? EM_DASH : formatters.band.format(stats.avgBand)
          }
          label={t("profile.stats.avgBand")}
        />
        <StatTile
          variant="outline"
          value={formatters.int.format(stats.currentStreak)}
          label={t("profile.stats.streakDays")}
        />
        <StatTile
          variant="outline"
          value={formatters.hours.format(hours)}
          unit={t("units.hoursUnit")}
          label={t("profile.stats.totalPractice")}
        />
      </div>

      {/* ---- Recent results ---- */}
      <section
        className={styles.section}
        aria-label={t("profile.sections.recentResults")}
      >
        <Text
          as="h2"
          variant="label"
          color="faint"
          className={styles.sectionLabel}
        >
          {t("profile.sections.recentResults")}
        </Text>

        {results.length === 0 ? (
          <Text as="p" variant="body-s" color="muted" className={styles.empty}>
            {t("profile.results.empty")}
          </Text>
        ) : (
          <>
            <Card variant="outline" padding="none" className={styles.resultsCard}>
              <ul className={styles.resultList}>
                {results.slice(0, RECENT_CAP).map((r) => (
                  <ResultRow
                    key={r.id}
                    result={r}
                    now={now}
                    onOpen={onOpenResult ? () => onOpenResult(r.id) : undefined}
                  />
                ))}
              </ul>
            </Card>
            {onSeeAll && (
              <Button
                variant="secondary"
                fullWidth
                onClick={onSeeAll}
                className={styles.seeAll}
              >
                {t("profile.results.seeAll")}
              </Button>
            )}
          </>
        )}
      </section>

      {/* ---- Achievements ---- */}
      <section
        className={styles.section}
        aria-label={t("profile.sections.achievements")}
      >
        <div className={styles.achHeader}>
          <Text as="h2" variant="label" color="faint">
            {t("profile.sections.achievements")}
          </Text>
          <Text
            as="span"
            variant="body-s"
            color="muted"
            numeric
            className={styles.achSummary}
          >
            {t("profile.achievements.summary", {
              count: unlockedCount,
              total: achievementTotal,
            })}
          </Text>
        </div>
        <ul className={styles.achGrid}>
          {achievements.map((a) => (
            <li key={a.key} className={styles.achCell}>
              <AchievementTile achievement={a} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Result row                                                                 */
/* -------------------------------------------------------------------------- */

function ResultRow({
  result,
  now,
  onOpen,
}: {
  result: ResultsTabResult;
  now: Date;
  /** Present → the row is a button that opens the attempt detail. */
  onOpen?: () => void;
}) {
  const { t } = useTranslation();
  const when = relativeDate(t, result.createdAt, now);

  const inner = (
    <>
      <span className={styles.bandDot} aria-hidden>
        <Text as="span" variant="title-s" numeric className={styles.bandNum}>
          {result.band}
        </Text>
      </span>

      <span className={styles.resultText}>
        <Text as="span" variant="title-s" truncate>
          {result.title}
        </Text>
        {when && (
          <Text as="span" variant="body-s" color="muted">
            {when}
          </Text>
        )}
      </span>

      {/* The arrow is decorative; the words carry the same meaning so a screen-
       * reader user never depends on colour + shape alone. */}
      <span className={styles.trendCell}>
        <VisuallyHidden>{t("units.points", { count: result.band })}</VisuallyHidden>
        <VisuallyHidden>{trendLabel(t, result.trend)}</VisuallyHidden>
        <span className={cx(styles.trendArrow, TREND_CLASS[result.trend])} aria-hidden>
          {TREND_ARROW[result.trend]}
        </span>
        {onOpen && (
          <span className={styles.rowChevron} aria-hidden>
            <ChevronGlyph />
          </span>
        )}
      </span>
    </>
  );

  return (
    <li className={styles.resultItem}>
      {onOpen ? (
        <button
          type="button"
          className={cx(styles.resultRow, styles.resultRowBtn)}
          onClick={onOpen}
          aria-label={t("profile.results.openAria", { title: result.title })}
        >
          {inner}
        </button>
      ) : (
        <div className={styles.resultRow}>{inner}</div>
      )}
    </li>
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
/* Achievement tile                                                           */
/* -------------------------------------------------------------------------- */

function AchievementTile({
  achievement,
}: {
  achievement: ResultsTabAchievement;
}) {
  const { t } = useTranslation();
  const { key, unlocked, progress, target } = achievement;

  // Bar fill 0..100. Progress is uncapped in the payload (a 128-attempt student
  // reads 128/50), so the ratio is clamped here for the bar only.
  const fillPct = target > 0 ? Math.min(progress / target, 1) * 100 : 0;

  // State carried in WORDS, never colour alone: reuse the existing locale keys —
  // "Ochildi" (unlocked) / "Qulflangan" (locked).
  const stateLabel = unlocked
    ? t("progress.unlocked")
    : t("profile.achievements.locked");

  return (
    <Card
      variant="flat"
      padding="md"
      className={cx(
        styles.achTile,
        unlocked ? styles.achUnlocked : styles.achLocked,
      )}
    >
      <span
        className={cx(
          styles.achIcon,
          unlocked ? styles.achIconUnlocked : styles.achIconLocked,
        )}
        aria-hidden
      >
        {unlocked ? achievementEmoji(key) : LOCK_EMOJI}
      </span>

      <span className={styles.achBody}>
        <Text as="p" variant="title-s" className={styles.achTitle}>
          {achievementTitle(t, key)}
        </Text>
        <Text as="p" variant="body-s" color="muted" className={styles.achDesc}>
          {achievementDesc(t, key)}
        </Text>
      </span>

      <span className={styles.achFooter}>
        {/* Decorative — the state word + counts below carry the same meaning. */}
        <span className={styles.achBar} aria-hidden>
          <span
            className={cx(styles.achBarFill, unlocked && styles.achBarFillDone)}
            style={{ width: `${fillPct}%` }}
          />
        </span>

        {/* In-progress tiles show the raw count; numerals need no translation. */}
        {!unlocked && (
          <Text as="p" variant="body-s" color="faint" numeric className={styles.achCount}>
            {progress} / {target}
          </Text>
        )}
      </span>

      {/* The one channel that states unlocked / locked to a screen reader. */}
      <VisuallyHidden>{stateLabel}</VisuallyHidden>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Local helpers                                                              */
/* -------------------------------------------------------------------------- */

/** Placeholder for "no value" — typography, not translatable copy. */
const EM_DASH = "—";

const LOCK_EMOJI = "🔒";

const TREND_ARROW: Record<ResultTrend, string> = {
  up: "↑",
  down: "↓",
  flat: "→",
};

const TREND_CLASS: Record<ResultTrend, string> = {
  up: styles.trendUp,
  down: styles.trendDown,
  flat: styles.trendFlat,
};

/**
 * The trend stated in words, for the screen-reader-only row text — the arrow
 * itself is `aria-hidden`, so this is the only channel carrying the direction
 * to a non-sighted reader.
 */
function trendLabel(t: TFunction, trend: ResultTrend): string {
  switch (trend) {
    case "up":
      return t("profile.trend.up");
    case "down":
      return t("profile.trend.down");
    default:
      return t("profile.trend.flat");
  }
}

/**
 * Emoji per achievement — the 16-badge catalogue, in the backend's order.
 * Decorative (`aria-hidden`); an unknown key falls back to a medal, and locked
 * tiles render {@link LOCK_EMOJI} instead.
 */
const ACHIEVEMENT_EMOJI: Record<string, string> = {
  first_step: "👣",
  attempts_10: "🚀",
  attempts_50: "💪",
  attempts_100: "💯",
  streak_3: "🌱",
  streak_7: "📅",
  streak_30: "🔥",
  streak_100: "🏔️",
  level_a2: "🥉",
  level_b1: "🥈",
  level_b2: "🥇",
  score_80: "⭐",
  score_90: "🎯",
  practice_1h: "⏱️",
  practice_5h: "🏃",
  group_member: "👥",
  xp_100: "⚡",
  xp_500: "🌟",
  xp_1000: "💎",
  xp_2500: "👑",
  xp_5000: "🔱",
};

function achievementEmoji(key: string): string {
  return ACHIEVEMENT_EMOJI[key] ?? "🏅";
}

/**
 * Title for an achievement, looked up in i18n by the backend `key` under
 * `profile.achievements.items.<key>.title`. Fails safe: an unrecognised key
 * falls back to the raw key rather than crashing or leaking the i18n path.
 */
function achievementTitle(t: TFunction, key: string): string {
  return t(`profile.achievements.items.${key}.title`, { defaultValue: key });
}

/**
 * One-line description (`…items.<key>.desc`). Fails safe to an empty string so a
 * missing key renders nothing rather than the raw i18n path.
 */
function achievementDesc(t: TFunction, key: string): string {
  return t(`profile.achievements.items.${key}.desc`, { defaultValue: "" });
}

/** Local midnight for a date — the boundary relative dates are measured from. */
function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Whole calendar days between two instants, counted by LOCAL day boundary
 * rather than by a 24h delta — so an attempt at 23:00 last night is 1 day ago
 * ("Kecha") even though only two hours have passed. Rounding absorbs the 23h /
 * 25h days that DST transitions produce.
 */
function calendarDaysBetween(from: Date, to: Date): number {
  const MS_PER_DAY = 86_400_000;
  return Math.round(
    (startOfLocalDay(to) - startOfLocalDay(from)) / MS_PER_DAY,
  );
}

/**
 * "Bugun" / "Kecha" / "{{count}} kun oldin" / "{{count}} hafta oldin".
 * Counts go through i18next's CLDR plurals so Russian resolves few/many.
 * Returns `null` for an unparseable timestamp so the caller can omit the line.
 */
function relativeDate(t: TFunction, iso: string, now: Date): string | null {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;

  const days = calendarDaysBetween(then, now);

  // Clock skew can put a fresh attempt marginally in the future — still today.
  if (days <= 0) return t("profile.relativeDate.today");
  if (days === 1) return t("profile.relativeDate.yesterday");
  if (days < 7) return t("profile.relativeDate.daysAgo", { count: days });
  return t("profile.relativeDate.weeksAgo", {
    count: Math.floor(days / 7),
  });
}
