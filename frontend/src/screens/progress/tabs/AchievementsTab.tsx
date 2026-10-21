import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Card, EmptyState, Text, VisuallyHidden, cx } from "../../../shared/ui";
import styles from "./AchievementsTab.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

/**
 * One achievement badge — the SAME shape the Profile screen's ResultsTab
 * consumes (docs/07 21-badge catalogue). `key` is the stable backend id; titles
 * + descriptions are looked up in i18n under `profile.achievements.items.<key>`.
 */
export interface ProgressAchievement {
  key: string;
  /** Raw natural-unit progress (attempts / days / minutes / XP), NOT capped at target. */
  progress: number;
  target: number;
  unlocked: boolean;
}

export interface AchievementsTabProps {
  /** The 21-badge array, same shape as Profile's `ResultsTabAchievement[]`. */
  achievements: ProgressAchievement[];
  /** The empty state's one action ("start practising"). */
  onStartPractice?: () => void;
}

/* -------------------------------------------------------------------------- */
/* Tab                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * AchievementsTab — the "Yutuqlar" tab body of the Progress screen.
 *
 * Presentational and prop-driven: it fetches nothing and owns no state. Layout
 * is full-width — a header ("Erishilgan yutuqlar" + "X / Y" + a progress bar of
 * unlocked/total), then a 2-col responsive grid of badge tiles. Every colour /
 * space / radius / motion value is a token; the shell owns the
 * `role="tabpanel"` wrapper.
 *
 * A11y: a tile's unlocked/locked state is ALWAYS carried in words (a visible
 * "✓ Ochildi" row when unlocked, an SR-only "Qulflangan" on locked tiles) — the
 * grey/green colour is only a reinforcement, never the sole signal.
 */
export function AchievementsTab({ achievements, onStartPractice }: AchievementsTabProps) {
  const { t } = useTranslation();

  const unlockedCount = useMemo(
    () => achievements.filter((a) => a.unlocked).length,
    [achievements],
  );
  const total = achievements.length;
  // Header bar fill — share of the catalogue unlocked. Guard total 0.
  const headerPct = total > 0 ? (unlockedCount / total) * 100 : 0;

  // Nothing to show at all (the catalogue did not load): Govo + one step, not
  // a header reading "0 / 0" over an empty grid.
  if (total === 0) {
    return (
      <EmptyState
        title={t("motivation.empty.achTitle")}
        body={t("motivation.empty.achBody")}
        actionLabel={t("motivation.empty.startPractice")}
        onAction={onStartPractice}
      />
    );
  }

  return (
    <div className={styles.tab}>
      {/* Nothing unlocked yet: say how close the first badge is and offer the
          one step that earns it, above the (all-locked) grid. */}
      {unlockedCount === 0 && (
        <EmptyState
          compact
          title={t("motivation.empty.achTitle")}
          body={t("motivation.empty.achBody")}
          actionLabel={t("motivation.empty.startPractice")}
          onAction={onStartPractice}
        />
      )}

      {/* ---- Header: title + count + overall progress bar ---- */}
      <header className={styles.header}>
        <div className={styles.headerRow}>
          <Text as="h2" variant="title-m" className={styles.headerTitle}>
            {t("progress.ach.header")}
          </Text>
          <Text
            as="span"
            variant="title-s"
            color="accent"
            numeric
            className={styles.headerCount}
          >
            {t("progress.ach.count", { unlocked: unlockedCount, total })}
          </Text>
        </div>

        <span
          className={styles.headerBar}
          role="progressbar"
          aria-label={t("progress.ach.header")}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={unlockedCount}
          aria-valuetext={t("progress.ach.count", {
            unlocked: unlockedCount,
            total,
          })}
        >
          <span
            className={styles.headerBarFill}
            style={{ width: `${headerPct}%` }}
          />
        </span>
      </header>

      {/* ---- 2-col badge grid ---- */}
      <ul className={styles.grid}>
        {achievements.map((a) => (
          <li key={a.key} className={styles.cell}>
            <AchievementTile achievement={a} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Achievement tile                                                           */
/* -------------------------------------------------------------------------- */

function AchievementTile({ achievement }: { achievement: ProgressAchievement }) {
  const { t } = useTranslation();
  const { key, unlocked, progress, target } = achievement;

  // Bar fill 0..100. Progress is uncapped in the payload (a 128-attempt student
  // reads 128/50), so the ratio is clamped here for the bar only.
  const fillPct = target > 0 ? Math.min(progress / target, 1) * 100 : 0;

  return (
    <Card
      variant="flat"
      padding="md"
      className={cx(
        styles.tile,
        unlocked ? styles.tileUnlocked : styles.tileLocked,
      )}
    >
      <span
        className={cx(
          styles.icon,
          unlocked ? styles.iconUnlocked : styles.iconLocked,
        )}
        aria-hidden
      >
        {unlocked ? achievementEmoji(key) : LOCK_EMOJI}
      </span>

      <span className={styles.body}>
        <Text as="p" variant="title-s" className={styles.title}>
          {achievementTitle(t, key)}
        </Text>
        <Text as="p" variant="body-s" color="muted" className={styles.desc}>
          {achievementDesc(t, key)}
        </Text>
      </span>

      <span className={styles.footer}>
        {unlocked ? (
          // Visible state word — colour is never the only signal.
          <Text
            as="p"
            variant="body-s"
            weight="bold"
            color="success"
            className={styles.unlockedRow}
          >
            <span aria-hidden>✓ </span>
            {t("progress.ach.unlocked")}
          </Text>
        ) : (
          <>
            {/* Decorative — the count below carries the same meaning. */}
            <span className={styles.bar} aria-hidden>
              <span className={styles.barFill} style={{ width: `${fillPct}%` }} />
            </span>
            <Text
              as="p"
              variant="body-s"
              color="muted"
              numeric
              className={styles.count}
            >
              {progress} / {target}
            </Text>
          </>
        )}
      </span>

      {/* Locked tiles state their status to a screen reader (unlocked tiles
       * already show the "Ochildi" word visibly). */}
      {!unlocked && <VisuallyHidden>{t("profile.achievements.locked")}</VisuallyHidden>}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Local helpers                                                              */
/* -------------------------------------------------------------------------- */

const LOCK_EMOJI = "🔒";

/**
 * Emoji per achievement — the 21-badge catalogue, in the backend's order. Kept
 * IN SYNC with Profile's ResultsTab map so the two screens agree. Decorative
 * (`aria-hidden`); an unknown key falls back to a medal, and locked tiles render
 * {@link LOCK_EMOJI} instead.
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
 * Title for an achievement (`…items.<key>.title`). Fails safe: an unrecognised
 * key falls back to the raw key rather than crashing or leaking the i18n path.
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
