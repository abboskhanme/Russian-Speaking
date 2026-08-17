import { useCallback, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, Tabs, Text } from "../../shared/ui";
import { AppShell, Brand, NotificationsBell, studentNavItems } from "../../widgets";
import type { NavItem } from "../../widgets";
import { ModulesTab } from "./tabs/ModulesTab";
import type { PracticeModule } from "./tabs/ModulesTab";
import { AssignmentsTab } from "./tabs/AssignmentsTab";
import type { AssignmentsTabProps } from "./tabs/AssignmentsTab";
import { mockHubAssignments, mockHubModules } from "./practice-hub.mock";
import styles from "./PracticeHubScreen.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

/** The two inner places of Mashq: Modullar · Topshiriqlar. (AI Suhbat is now its
 * own destination behind the centre FAB, not a Mashq tab.) */
export type PracticeHubTabKey = "modules" | "assignments";

/** The «Xatolar ustida» entry — how the F5 replay drill is reached (docs/04 §4.1
 * puts the SRS drill inside Mashq, as a way to practise rather than a sixth
 * destination, which is why it is a card here and not a nav item). */
export interface PracticeHubReviewDrill {
  /** Reviews due right now. The entry hides itself at 0 — an entry point to an
   * empty drill is an invitation to a dead end. */
  dueCount: number;
  onStart: () => void;
}

export interface PracticeHubScreenProps {
  /** Modullar tab — the student's modules (D1/E1). */
  modules: PracticeModule[];
  /** Open a module's detail screen (D2). */
  onOpenModule: (id: string) => void;

  /** Topshiriqlar tab — one-off teacher assignments. */
  assignments: AssignmentsTabProps["assignments"];
  /** Start an assignment on the task recording screen. */
  onStartTask: AssignmentsTabProps["onStart"];

  /** Xatolar ustida — omitted or null when the deployment has the drill flag off
   * (or nothing is due), and the hub then shows no trace of it. */
  reviewDrill?: PracticeHubReviewDrill | null;

  /**
   * Controlled tab selection. Omit both this and `onChangeTab` to let the screen
   * own the choice internally (the usual case, mirroring ProfileScreen).
   */
  activeTab?: PracticeHubTabKey;
  onChangeTab?: (key: PracticeHubTabKey) => void;

  /** Active nav key (defaults to "practice"). */
  activeNavKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * PracticeHubScreen — the student's "Mashq" place, a two-tab hub: Modullar
 * (modules, each a sequence of tasks) and Topshiriqlar (one-off teacher
 * assignments). AI Suhbat is no longer a tab here — it is the centre FAB's own
 * destination (`ConversationHubScreen`).
 *
 * This file owns only the frame, the tab semantics and the prop distribution —
 * each tab body lives in its own component. It is presentational and prop-driven:
 * it fetches nothing and owns no server state. The single piece of state it may
 * own is which tab is showing, and even that defers to `activeTab`/`onChangeTab`
 * when the caller wants control. Layout is full-width; every colour / space /
 * radius / motion value is a token, and all copy resolves through `mashq.*`.
 */
export function PracticeHubScreen({
  modules,
  onOpenModule,
  assignments,
  onStartTask,
  reviewDrill,
  activeTab,
  onChangeTab,
  activeNavKey = "practice",
  onNavigate,
}: PracticeHubScreenProps) {
  const { t } = useTranslation();
  const panelId = useId();

  // Uncontrolled by default; `activeTab` wins the moment the caller passes one.
  const [ownTab, setOwnTab] = useState<PracticeHubTabKey>("modules");
  const current = activeTab ?? ownTab;

  const selectTab = useCallback(
    (key: string) => {
      const next = key as PracticeHubTabKey;
      if (activeTab === undefined) setOwnTab(next);
      onChangeTab?.(next);
    },
    [activeTab, onChangeTab],
  );

  const items = [
    { key: "modules", label: t("mashq.tabs.modules"), panelId },
    { key: "assignments", label: t("mashq.tabs.assignments"), panelId },
  ];

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
          {t("mashq.title")}
        </Text>
      }
      headerEnd={<NotificationsBell />}
    >
      <div className={styles.page}>
        {/* The drill's entry point. The card is deliberately NOT `interactive`:
            a press-scale on a wide row that carries its own edge button shifts
            the button out from under the cursor, and the tap silently misses. */}
        {reviewDrill && reviewDrill.dueCount > 0 && (
          <Card variant="tint" padding="md" className={styles.drillEntry}>
            <div className={styles.drillText}>
              <Text variant="label" color="primary">
                {t("review.entry.kicker")}
              </Text>
              <Text variant="title-s" weight="black">
                {t("review.title")}
              </Text>
              <Text variant="body-s" color="ink-soft">
                {t("review.entry.body", { count: reviewDrill.dueCount })}
              </Text>
            </div>
            <Button variant="primary" onClick={reviewDrill.onStart}>
              {t("review.entry.cta")}
            </Button>
          </Card>
        )}

        <Tabs
          items={items}
          activeKey={current}
          onChange={selectTab}
          aria-label={t("mashq.title")}
        />

        {/* One panel node reused across tabs: the tab strip is the only thing
            that changes identity, so a single labelled region keeps assistive
            tech oriented instead of announcing three separate landmarks. */}
        <div
          id={panelId}
          role="tabpanel"
          tabIndex={-1}
          aria-label={t(`mashq.tabs.${current}`)}
          className={styles.panel}
        >
          {current === "modules" && (
            <ModulesTab modules={modules} onOpenModule={onOpenModule} />
          )}

          {current === "assignments" && (
            <AssignmentsTab assignments={assignments} onStart={onStartTask} />
          )}
        </div>
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Default export — a self-wired demo, renderable in isolation.               */
/* -------------------------------------------------------------------------- */

/**
 * PracticeHubScreenDemo — drop-in standalone preview wired to the mock fixtures,
 * so both Mashq tabs render end-to-end with no backend.
 */
export default function PracticeHubScreenDemo() {
  return (
    <PracticeHubScreen
      modules={mockHubModules}
      onOpenModule={() => undefined}
      assignments={mockHubAssignments}
      onStartTask={() => undefined}
      onNavigate={() => undefined}
    />
  );
}
