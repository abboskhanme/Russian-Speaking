import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Card, Spinner, Text, VisuallyHidden, cx } from "../../../shared/ui";
import styles from "./LeaderboardTab.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

export type LeaderboardPeriod = "weekly" | "monthly" | "all";

export type LeaderboardLeague = "gold" | "silver" | "bronze";

export interface LeaderboardNeighbor {
  rank: number;
  fullName: string;
  xp: number;
  /** The caller's own row — visually highlighted + `aria-current`. */
  isMe: boolean;
}

export interface LeaderboardData {
  league: LeaderboardLeague;
  myRank: number;
  totalStudents: number;
  /** "Top X%" — 1 is best (top 1%), 100 is worst. */
  percentile: number;
  /** The caller's XP FOR the chosen period. */
  myXp: number;
  currentStreak: number;
  /** previous-period rank − my_rank (positive = climbed N places). null = unknown. */
  rankDelta: number | null;
  /** Rows around the caller, ascending by rank; includes the caller (isMe). */
  neighbors: LeaderboardNeighbor[];
}

export interface LeaderboardTabProps {
  period: LeaderboardPeriod;
  onChangePeriod: (p: LeaderboardPeriod) => void;
  /** A period switch is refetching — dim the board, keep the pills mounted. */
  loading?: boolean;
  /** `null` → the empty state (no ranking yet, or a non-student caller). */
  data: LeaderboardData | null;
}

/* -------------------------------------------------------------------------- */
/* Tab                                                                        */
/* -------------------------------------------------------------------------- */

const PERIODS: readonly LeaderboardPeriod[] = ["weekly", "monthly", "all"];

/**
 * LeaderboardTab — the "Reyting" tab body of the Progress screen.
 *
 * Presentational and prop-driven: the shell owns the fetch + period state; this
 * body only renders and calls `onChangePeriod`. Layout is full-width — period
 * pills, then the board: an app-wide summary card (league + three stat cells +
 * a "ladder" bar), a highlighted "me" card (rank + delta), and the nearby
 * neighbours list. Every colour / space / radius / motion value is a token; the
 * shell owns the `role="tabpanel"` wrapper.
 *
 * A11y: league + rank state are always carried in words (labels + `aria-current`
 * on the caller's row), never colour alone. During a period refetch the pills
 * stay mounted and only the board dims (`aria-busy`), so focus is never lost.
 */
export function LeaderboardTab({
  period,
  onChangePeriod,
  loading = false,
  data,
}: LeaderboardTabProps) {
  const { t, i18n } = useTranslation();

  // Numbers follow the active UI language (Russian gets thin-space grouping).
  const nf = useMemo(
    () => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 }),
    [i18n.language],
  );

  return (
    <div className={styles.tab}>
      {/* ---- Sub-period pills (never unmount on a refetch) ---- */}
      <div
        className={styles.pills}
        role="group"
        aria-label={t("progress.tabs.leaderboard")}
      >
        {PERIODS.map((p) => {
          const selected = p === period;
          return (
            <button
              key={p}
              type="button"
              // A single-select filter → aria-pressed states the choice without
              // implying a separate tabpanel per period (the board is shared).
              aria-pressed={selected}
              className={cx(styles.pill, selected && styles.pillActive)}
              onClick={() => onChangePeriod(p)}
            >
              {t(`progress.lb.period.${p}`)}
            </button>
          );
        })}
      </div>

      {/* ---- Board ---- */}
      {data === null ? (
        <Card variant="outline" padding="lg" className={styles.empty}>
          <Text as="p" variant="body" color="muted">
            {t("progress.lb.empty")}
          </Text>
        </Card>
      ) : (
        <div className={styles.board} aria-busy={loading || undefined}>
          {loading && (
            <div className={styles.loadingOverlay}>
              <Spinner size="md" label={t("common.loading")} />
            </div>
          )}

          <AppWideCard data={data} t={t} nf={nf} />
          <MeCard data={data} period={period} t={t} nf={nf} />
          <NeighborsList neighbors={data.neighbors} t={t} nf={nf} />
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* App-wide summary card: league + 3 stat cells + ladder bar                  */
/* -------------------------------------------------------------------------- */

function AppWideCard({
  data,
  t,
  nf,
}: {
  data: LeaderboardData;
  t: TFunction;
  nf: Intl.NumberFormat;
}) {
  const { league, myRank, totalStudents, percentile } = data;

  // Ladder fill: percentile is "top X%" where 1 is best, so a higher standing
  // must read as a FULLER bar → fill = 100 − percentile (top 1% ⇒ ~99% full).
  const ladderPct = clampPct(100 - percentile);

  return (
    <Card variant="outline" padding="lg" className={styles.card}>
      <div className={styles.cardHead}>
        <Text as="h3" variant="label" color="faint">
          {t("progress.lb.appWide")}
        </Text>
        <LeagueBadge league={league} t={t} />
      </div>

      <div className={styles.stats}>
        <Stat
          value={`#${nf.format(myRank)}`}
          label={t("progress.lb.rank")}
        />
        <Stat
          value={nf.format(totalStudents)}
          label={t("progress.lb.totalStudents")}
        />
        <Stat
          value={`${nf.format(percentile)}%`}
          label={t("progress.lb.bestPct")}
        />
      </div>

      <div className={styles.ladder}>
        <div className={styles.ladderLabels}>
          <Text as="span" variant="body-s" color="ink-soft">
            {t("progress.lb.ladder")}
          </Text>
          <Text as="span" variant="body-s" weight="bold" color="accent" numeric>
            {t("progress.lb.topPct", { pct: nf.format(percentile) })}
          </Text>
        </div>
        <span
          className={styles.ladderBar}
          role="progressbar"
          aria-label={t("progress.lb.ladder")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(ladderPct)}
          aria-valuetext={t("progress.lb.topPct", { pct: nf.format(percentile) })}
        >
          <span className={styles.ladderFill} style={{ width: `${ladderPct}%` }} />
        </span>
      </div>
    </Card>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className={styles.stat}>
      <Text as="p" variant="title-l" numeric className={styles.statValue}>
        {value}
      </Text>
      <Text as="p" variant="body-s" color="muted" className={styles.statLabel}>
        {label}
      </Text>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* League badge — tinted by rank tier (colour reinforced by a distinct medal)  */
/* -------------------------------------------------------------------------- */

const LEAGUE_MEDAL: Record<LeaderboardLeague, string> = {
  gold: "🥇",
  silver: "🥈",
  bronze: "🥉",
};

const LEAGUE_LABEL_KEY: Record<LeaderboardLeague, string> = {
  gold: "progress.lb.leagueOltin",
  silver: "progress.lb.leagueKumush",
  bronze: "progress.lb.leagueBronza",
};

function LeagueBadge({
  league,
  t,
}: {
  league: LeaderboardLeague;
  t: TFunction;
}) {
  const CLASS: Record<LeaderboardLeague, string> = {
    gold: styles.leagueGold,
    silver: styles.leagueSilver,
    bronze: styles.leagueBronze,
  };
  return (
    <span className={cx(styles.league, CLASS[league])}>
      {/* The medal differs per tier, so the league is legible without colour. */}
      <span className={styles.leagueMedal} aria-hidden>
        {LEAGUE_MEDAL[league]}
      </span>
      {/* A plain span (not <Text>) so the label inherits the tier tint via
       * currentColor — Text hardcodes its own --ink colour. */}
      <span className={styles.leagueLabel}>{t(LEAGUE_LABEL_KEY[league])}</span>
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* "Me" card — the caller's own standing this period + delta line             */
/* -------------------------------------------------------------------------- */

const PERIOD_TITLE_KEY: Record<LeaderboardPeriod, string> = {
  weekly: "progress.lb.meThisWeek",
  monthly: "progress.lb.meThisMonth",
  all: "progress.lb.meAllTime",
};

function MeCard({
  data,
  period,
  t,
  nf,
}: {
  data: LeaderboardData;
  period: LeaderboardPeriod;
  t: TFunction;
  nf: Intl.NumberFormat;
}) {
  const { myRank, myXp, rankDelta } = data;
  const xpText = nf.format(myXp);

  return (
    <Card variant="flat" padding="lg" className={styles.meCard}>
      <Text as="p" variant="title-m" color="primary" className={styles.meRank}>
        {t(PERIOD_TITLE_KEY[period], { rank: myRank })}
      </Text>
      <Text
        as="p"
        variant="body"
        weight="semibold"
        color="ink-soft"
        className={styles.meDelta}
      >
        {deltaLine(t, xpText, rankDelta)}
      </Text>
    </Card>
  );
}

/**
 * The delta sentence, picked by the SIGN of `rankDelta`:
 *   > 0 climbed N places · < 0 dropped N · 0 unchanged · null → XP only.
 * The arrow glyph lives inside each locale string, so the direction is stated
 * in words too — never conveyed by an arrow alone.
 */
function deltaLine(
  t: TFunction,
  xpText: string,
  rankDelta: number | null,
): string {
  if (rankDelta === null) return t("progress.lb.meNoDelta", { xp: xpText });
  if (rankDelta > 0) return t("progress.lb.meDeltaUp", { xp: xpText, n: rankDelta });
  if (rankDelta < 0)
    return t("progress.lb.meDeltaDown", { xp: xpText, n: Math.abs(rankDelta) });
  return t("progress.lb.meDeltaFlat", { xp: xpText });
}

/* -------------------------------------------------------------------------- */
/* Neighbours list                                                            */
/* -------------------------------------------------------------------------- */

const MEDAL: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

function NeighborsList({
  neighbors,
  t,
  nf,
}: {
  neighbors: LeaderboardNeighbor[];
  t: TFunction;
  nf: Intl.NumberFormat;
}) {
  return (
    <section className={styles.nearby} aria-label={t("progress.lb.nearby")}>
      <Text
        as="h3"
        variant="label"
        color="faint"
        className={styles.nearbyLabel}
      >
        {t("progress.lb.nearby")}
      </Text>

      <Card variant="outline" padding="none" className={styles.nearbyCard}>
        <ul className={styles.rows}>
          {neighbors.map((n) => (
            <NeighborRow key={n.rank} neighbor={n} t={t} nf={nf} />
          ))}
        </ul>
      </Card>
    </section>
  );
}

function NeighborRow({
  neighbor,
  t,
  nf,
}: {
  neighbor: LeaderboardNeighbor;
  t: TFunction;
  nf: Intl.NumberFormat;
}) {
  const { rank, fullName, xp, isMe } = neighbor;
  const medal = MEDAL[rank];

  return (
    <li
      className={cx(styles.row, isMe && styles.rowMe)}
      // The caller's row is announced as "current" — a non-visual signal that
      // pairs with the highlight so it never rests on colour alone.
      aria-current={isMe ? "true" : undefined}
    >
      <span className={styles.rankCell}>
        {medal ? (
          <>
            <span className={styles.medal} aria-hidden>
              {medal}
            </span>
            {/* Keep the numeric rank audible even when a medal replaces it. */}
            <VisuallyHidden>{nf.format(rank)}</VisuallyHidden>
          </>
        ) : (
          <Text as="span" variant="title-s" numeric color="muted">
            {nf.format(rank)}
          </Text>
        )}
      </span>

      <span className={styles.avatar} aria-hidden>
        {initials(fullName)}
      </span>

      <Text as="span" variant="title-s" truncate className={styles.name}>
        {fullName}
      </Text>

      <Text as="span" variant="body-s" weight="bold" numeric className={styles.xp}>
        {nf.format(xp)} {t("progress.lb.xpSuffix")}
      </Text>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Local helpers                                                              */
/* -------------------------------------------------------------------------- */

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, n));
}

/**
 * Up to two initials from a full name, for the avatar chip. Two words → first
 * letter of each; one word → its first two characters; empty → "?".
 */
function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
