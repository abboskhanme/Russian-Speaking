import { useCallback, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tabs, Text } from "../../shared/ui";
import { Page } from "../../widgets";
import type { NavItem } from "../../widgets";
import { SkillsTab } from "./tabs/SkillsTab";
import type { SkillsTabProps } from "./tabs/SkillsTab";
import { AchievementsTab } from "./tabs/AchievementsTab";
import type { AchievementsTabProps } from "./tabs/AchievementsTab";
import { LeaderboardTab } from "./tabs/LeaderboardTab";
import type { LeaderboardPeriod, LeaderboardTabProps } from "./tabs/LeaderboardTab";
import {
  mockLeaderboard,
  mockProgressAchievements,
  mockSkills,
} from "./progress.mock";
import styles from "./ProgressScreen.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

/** The three inner places of Progress: Ko'nikmalar · Yutuqlar · Reyting. */
export type ProgressTabKey = "skills" | "achievements" | "leaderboard";

export interface ProgressScreenProps {
  /** Lifetime XP — the headline "★ {xp} XP" badge in the header (all tabs). */
  xp: number;
  /** Ko'nikmalar tab data. */
  skills: SkillsTabProps;
  /** Yutuqlar tab data (the 21-badge catalogue, reused from Profile). */
  achievements: AchievementsTabProps;
  /**
   * Reyting tab data + controls. The period is LIFTED to the page: the tab's
   * `onChangePeriod` refetches server-side (with `loading` toggled), so the shell
   * only forwards it and never owns the period itself.
   */
  leaderboard: LeaderboardTabProps;
  /**
   * Controlled tab selection. Omit both this and `onChangeTab` to let the screen
   * own the choice internally (the usual case).
   */
  activeTab?: ProgressTabKey;
  onChangeTab?: (key: ProgressTabKey) => void;
  /** Active nav key (defaults to "progress"). */
  activeNavKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * ProgressScreen — the student's "Progress" place (docs/04 §4.1), the shared
 * frame around its three inner tabs: Ko'nikmalar (skills), Yutuqlar
 * (achievements) and Reyting (leaderboard).
 *
 * The header carries the page title plus a "★ {xp} XP" badge in place of the
 * usual notifications bell — the badge is the mockup's `headerEnd` on this screen
 * only. Below it, a segmented `Tabs` control drives a single labelled tabpanel;
 * this file owns only the frame, the tab semantics and the prop distribution.
 *
 * Presentational and prop-driven: it fetches nothing and owns no server state.
 * The single piece of state it may own is which tab is showing, and even that
 * defers to `activeTab`/`onChangeTab` when the caller wants control. The
 * leaderboard period lives on the page (so a switch refetches), not here. Layout
 * is full-width (docs/04 §4.10); every colour / space / radius value is a token.
 */
export function ProgressScreen({
  xp,
  skills,
  achievements,
  leaderboard,
  activeTab,
  onChangeTab,
}: ProgressScreenProps) {
  const { t } = useTranslation();
  const panelId = useId();

  // Uncontrolled by default; `activeTab` wins the moment the caller passes one.
  const [ownTab, setOwnTab] = useState<ProgressTabKey>("skills");
  const current = activeTab ?? ownTab;

  const selectTab = useCallback(
    (key: string) => {
      const next = key as ProgressTabKey;
      if (activeTab === undefined) setOwnTab(next);
      onChangeTab?.(next);
    },
    [activeTab, onChangeTab],
  );

  const items = [
    { key: "skills", label: t("progress.tabs.skills"), panelId },
    { key: "achievements", label: t("progress.tabs.achievements"), panelId },
    { key: "leaderboard", label: t("progress.tabs.leaderboard"), panelId },
  ];

  return (
    <Page title={t("nav.progress")}>
      <div className={styles.page}>
        <XpBadge xp={xp} />
        <Tabs
          items={items}
          activeKey={current}
          onChange={selectTab}
          aria-label={t("nav.progress")}
        />

        {/* One panel node reused across tabs: the tab strip is the only thing
            that changes identity, so a single labelled region keeps assistive
            tech oriented instead of announcing three separate landmarks. */}
        <div
          id={panelId}
          role="tabpanel"
          tabIndex={-1}
          aria-label={t(`progress.tabs.${current}`)}
          className={styles.panel}
        >
          {current === "skills" && <SkillsTab {...skills} />}
          {current === "achievements" && <AchievementsTab {...achievements} />}
          {current === "leaderboard" && <LeaderboardTab {...leaderboard} />}
        </div>
      </div>
    </Page>
  );
}

/* -------------------------------------------------------------------------- */
/* XP badge — the header trailing slot on this screen                         */
/* -------------------------------------------------------------------------- */

/** "★ {xp} XP" pill — primary-tint background, `--primary` text, a star glyph.
 * Replaces the notifications bell in the AppShell `headerEnd` on Progress. */
function XpBadge({ xp }: { xp: number }) {
  const { t } = useTranslation();
  return (
    <span className={styles.xpBadge}>
      <StarGlyph />
      <Text as="span" variant="body-s" weight="bold" numeric className={styles.xpText}>
        {t("progress.xpBadge", { count: xp })}
      </Text>
    </span>
  );
}

function StarGlyph() {
  return (
    <svg
      className={styles.xpStar}
      width="15"
      height="15"
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

/* -------------------------------------------------------------------------- */
/* Default export — a self-wired demo, renderable in isolation.               */
/* -------------------------------------------------------------------------- */

/**
 * ProgressScreenDemo — drop-in standalone preview wired to the mock fixtures, so
 * all three Progress tabs render end-to-end with no backend. It owns the
 * leaderboard period locally so the sub-period pills toggle in isolation.
 */
export default function ProgressScreenDemo() {
  const [period, setPeriod] = useState<LeaderboardPeriod>("weekly");

  return (
    <ProgressScreen
      xp={1240}
      skills={mockSkills}
      achievements={{ achievements: mockProgressAchievements }}
      leaderboard={{
        period,
        onChangePeriod: setPeriod,
        loading: false,
        data: mockLeaderboard,
      }}
      onNavigate={() => undefined}
    />
  );
}
