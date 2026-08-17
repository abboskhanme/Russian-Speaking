import { useTranslation } from "react-i18next";
import { Card, Mascot, Text, cx } from "../../shared/ui";
import { AppShell, Brand, NotificationsBell, studentNavItems } from "../../widgets";
import type { NavItem } from "../../widgets";
import { SCENARIOS, scenarioIcon } from "./scenarios";
import type { Scenario } from "./scenarios";
import styles from "./ConversationHubScreen.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

/** The icon-square tint per tone (contract mapping — tokens only). */
const TONE_CLASS: Record<Scenario["tone"], string> = {
  peach: styles.tonePeach,
  blue: styles.toneBlue,
  green: styles.toneGreen,
  amber: styles.toneAmber,
};

export interface ConversationHubScreenProps {
  /** The scenario tiles (defaults to the bundled `SCENARIOS` fallback). */
  scenarios?: Scenario[];
  /**
   * One honest line under the intro when the feature cannot run — the flag is
   * off, no AI key is wired, or the day's budget is spent. Already localized by
   * the page. Said HERE, on the grid, so a student learns it before recording
   * themselves rather than after.
   */
  note?: string;
  /** Open a scenario's chat (`/chat/:id`). */
  onOpenScenario: (scenarioId: string) => void;
  /** Open the open-ended "Erkin mavzu" conversation (`/chat/free`). */
  onOpenFree: () => void;
  /** Active nav key (defaults to "chat" — this IS the AI Suhbat destination). */
  activeNavKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * ConversationHubScreen — the AI Suhbat destination, reached from the bottom-bar
 * centre FAB (its OWN place now, no longer a Mashq tab). An intro line over a
 * 2-column grid of scenario tiles, then the "Erkin mavzu" free-topic card. The
 * AI asks in text and the student answers by voice (see ConversationScreen), so
 * the intro sets that expectation. Presentational + prop-driven: the page owns
 * navigation and passes `onOpenScenario` / `onOpenFree`. Full-width; every
 * colour / space / radius is a token; scenario titles are literal Russian.
 */
export function ConversationHubScreen({
  scenarios = SCENARIOS,
  note,
  onOpenScenario,
  onOpenFree,
  activeNavKey = "chat",
  onNavigate,
}: ConversationHubScreenProps) {
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
          {t("nav.chat")}
        </Text>
      }
      headerEnd={<NotificationsBell />}
    >
      <div className={styles.page}>
        <Text as="p" variant="body" color="ink-soft" className={styles.intro}>
          {t("suhbat.intro")}
        </Text>

        {note && (
          <Card variant="outline" padding="md" className={styles.note} role="status">
            <Text as="p" variant="body-s" color="muted">
              {note}
            </Text>
          </Card>
        )}

        <ul className={styles.grid}>
          {scenarios.map((s) => (
            <li key={s.id} className={styles.cell}>
              <Card variant="panel" padding="md" interactive asChild className={styles.tile}>
                <button type="button" onClick={() => onOpenScenario(s.id)}>
                  <span className={cx(styles.icon, TONE_CLASS[s.tone])} aria-hidden>
                    {scenarioIcon(s.id, s.tone, s.icon)}
                  </span>

                  <Text as="span" variant="title-s" className={styles.title}>
                    {s.titleRu}
                  </Text>

                  <Text as="span" variant="body-s" color="muted" className={styles.tileMeta}>
                    {s.level} · {s.goalUz}
                  </Text>
                </button>
              </Card>
            </li>
          ))}
        </ul>

        {/* ---- Erkin mavzu — open-ended conversation ---- */}
        <Card variant="tint" padding="lg" interactive asChild className={styles.free}>
          <button type="button" className={styles.freeBtn} onClick={onOpenFree}>
            <Mascot mood="idle" size={56} label="" className={styles.freeMascot} />
            <span className={styles.freeBody}>
              <Text as="span" variant="title-s">
                {t("suhbat.freeTitle")}
              </Text>
              <Text as="span" variant="body-s" color="muted">
                {t("suhbat.freeBody")}
              </Text>
            </span>
            <span className={styles.freeChevron} aria-hidden>
              <ChevronGlyph />
            </span>
          </button>
        </Card>
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Default export — a self-wired demo, renderable in isolation.               */
/* -------------------------------------------------------------------------- */

/** ConversationHubScreenDemo — standalone preview wired to the static data. */
export default function ConversationHubScreenDemo() {
  return (
    <ConversationHubScreen
      onOpenScenario={() => undefined}
      onOpenFree={() => undefined}
      onNavigate={() => undefined}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Glyph                                                                       */
/* -------------------------------------------------------------------------- */

function ChevronGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
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
