import { useTranslation } from "react-i18next";
import { Badge, Button, Card, Mascot, StatTile, Text } from "../../shared/ui";
import type { Scenario } from "./scenarios";
import styles from "./ConversationSummary.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

export interface ConversationSummaryProps {
  /** The scenario just played (title for context). */
  scenario: Scenario;
  /** Did the student complete enough turns to count the goal as reached? */
  goalReached: boolean;
  /** Number of student turns taken in this run. */
  turns: number;
  /** Stubbed fluency estimate, 0..100 (derived from the run by the page). */
  fluency: number;
  /** Three useful phrases from the scenario script (RU, literal). */
  phrases: string[];
  /** "Yana urinish →" — restart the same scenario. */
  onRetry: () => void;
  /** Optional "back to practice" — the header/secondary exit. */
  onBack?: () => void;
}

/* -------------------------------------------------------------------------- */
/* Summary                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * ConversationSummary (E4) — the Suhbat wrap-up.
 *
 * A proud Govo, "Suhbat tugadi", a goal-reached / goal-missed badge, two stat
 * cells (turns · fluency from the stub run), a "FOYDALI IBORA" list of the
 * scenario's three phrases, and a primary "Yana urinish →". Presentational and
 * prop-driven; every value is handed in already computed by the page. Tokens
 * only; full-width focal column like Placement's result step.
 */
export function ConversationSummary({
  scenario,
  goalReached,
  turns,
  fluency,
  phrases,
  onRetry,
  onBack,
}: ConversationSummaryProps) {
  const { t } = useTranslation();

  return (
    <div className={styles.page}>
      <div className={styles.column}>
        <Mascot mood="proud" size={104} label="Govo" className={styles.mascot} />

        <Text as="h1" variant="title-l" weight="black" align="center" className={styles.title}>
          {t("suhbat.endedTitle")}
        </Text>
        <Text as="p" variant="body-s" color="muted" align="center" className={styles.scenarioName}>
          {scenario.titleRu}
        </Text>

        <Badge variant={goalReached ? "success" : "warn"} size="md" className={styles.badge}>
          {goalReached ? t("suhbat.goalReached") : t("suhbat.goalMissed")}
        </Badge>

        {/* ---- Two stat cells ---- */}
        <div className={styles.stats}>
          <StatTile
            variant="outline"
            value={turns}
            label={t("suhbat.turns")}
          />
          <StatTile
            variant="outline"
            value={Math.round(fluency)}
            unit="%"
            label={t("suhbat.fluency")}
          />
        </div>

        {/* ---- Useful phrases ---- */}
        <section className={styles.phrasesSection} aria-label={t("suhbat.phrasesLabelShort")}>
          <Text as="h2" variant="label" color="faint" className={styles.phrasesLabel}>
            {t("suhbat.phrasesLabelShort")}
          </Text>
          <Card variant="outline" padding="none" className={styles.phrasesCard}>
            <ul className={styles.phraseList}>
              {phrases.map((p, i) => (
                <li key={i} className={styles.phraseRow}>
                  <span className={styles.phraseDot} aria-hidden>
                    ▶
                  </span>
                  <Text as="span" variant="body" className={styles.phraseText}>
                    {p}
                  </Text>
                </li>
              ))}
            </ul>
          </Card>
        </section>

        <Button variant="primary" size="lg" fullWidth onClick={onRetry} className={styles.retry}>
          {t("suhbat.retry")} <span aria-hidden>→</span>
        </Button>
        {onBack && (
          <Button variant="ghost" fullWidth onClick={onBack}>
            {t("common.back")}
          </Button>
        )}
      </div>
    </div>
  );
}
