import { useTranslation } from "react-i18next";
import { Badge, Button, Card, Mascot, StatTile, Text } from "../../shared/ui";
import type { Scenario } from "./scenarios";
import type { RoleplayCorrection } from "./roleplayApi";
import styles from "./ConversationSummary.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

export interface ConversationSummaryProps {
  /** The scenario just played (title for context). */
  scenario: Scenario;
  /** Did the partner get through every beat of the scenario? */
  goalReached: boolean;
  /** Number of student turns taken in this run. */
  turns: number;
  /**
   * Mean of the per-turn AI grades, 0..100 — or `null` when nothing was graded
   * (the student said nothing, or the grader was unreachable the whole run). Null
   * shows a dash: a run with no judgement behind it must not display a number the
   * student could mistake for one they earned.
   */
  fluency: number | null;
  /** Three useful phrases from the scenario (RU, literal). */
  phrases: string[];
  /** The run's merged corrections, deduplicated by the API. */
  corrections?: RoleplayCorrection[];
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
  corrections,
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
            value={fluency === null ? "—" : Math.round(fluency)}
            unit={fluency === null ? undefined : "%"}
            label={t("suhbat.fluency")}
          />
        </div>

        {/* ---- What to fix — the run's merged coaching ---- */}
        {corrections && corrections.length > 0 && (
          <section className={styles.fixesSection} aria-label={t("suhbat.fixesLabel")}>
            <Text as="h2" variant="label" color="faint" className={styles.phrasesLabel}>
              {t("suhbat.fixesLabel")}
            </Text>
            <Card variant="outline" padding="none" className={styles.phrasesCard}>
              <ul className={styles.phraseList}>
                {corrections.map((c, i) => (
                  <li key={i} className={styles.fixRow}>
                    <Text as="span" variant="body" className={styles.fixLine}>
                      <s className={styles.fixWas}>{c.original}</s>
                      <span aria-hidden> → </span>
                      <b>{c.corrected}</b>
                    </Text>
                    {c.explanation && (
                      <Text as="span" variant="body-s" color="muted">
                        {c.explanation}
                      </Text>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        )}

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
