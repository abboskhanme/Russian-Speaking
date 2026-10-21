import { useTranslation } from "react-i18next";
import { cefrLabel } from "../../../shared/i18n/cefrLabel";
import type { TFunction } from "i18next";
import { Card, Text } from "../../../shared/ui";
import type { TextColor } from "../../../shared/ui";
import { LineChart } from "../LineChart";
import styles from "./SkillsTab.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

/** The four CEFR sub-skills, always all four in this order. `score` is 0..100. */
export type SkillKey = "fluency" | "pronunciation" | "lexical" | "grammar";

export interface SkillsTabProps {
  /** CEFR level (e.g. "A2"). Null → nothing graded yet (empty state). */
  level: string | null;
  /** The server's Uzbek-only caption — rendered only as the fallback for a level `cefrLabel` has no key for. */
  levelLabel: string | null;
  /** Current average OverallBand, 1dp. Drives the trend line + chart summary. */
  band: number | null;
  /** `band now − band as of deltaWeeks ago`. Null → not enough history (hide trend). */
  bandDelta: number | null;
  /** Weeks the delta spans; 0 when there is no history. */
  deltaWeeks: number;
  /** Weekly average bands, oldest → newest ([] when none). */
  trend: { weekIndex: number; band: number }[];
  /** The four sub-skill scores, always all four in fluency→grammar order. */
  skills: { key: SkillKey; score: number }[];
}

/* -------------------------------------------------------------------------- */
/* Tab                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * SkillsTab — the "Ko'nikmalar" tab body of the Progress screen.
 *
 * Presentational and prop-driven: it fetches nothing and owns no state. Two
 * cards — a raised "HOZIRGI DARAJA" card (the big CEFR level, a coloured trend
 * line and the band-trend {@link LineChart}) and a "KO'NIKMALAR" card of four
 * skill rows (name · a track bar filled to the score · the score number). When
 * nothing is graded (`level` is null) the first card degrades to an empty state
 * and the bars simply read 0. Every colour / space / radius value is a token;
 * the shell owns the `role="tabpanel"` wrapper.
 */
export function SkillsTab({
  level,
  levelLabel,
  bandDelta,
  deltaWeeks,
  trend,
  skills,
}: SkillsTabProps) {
  const { t } = useTranslation();
  // The server's `level_label` is Uzbek-only; caption the level in the UI language instead.
  const caption = cefrLabel(t, level, levelLabel);

  return (
    <div className={styles.tab}>
      {/* ---- Current level + band trend ---- */}
      <Card variant="raised" padding="lg" className={styles.levelCard}>
        {level === null ? (
          <Text as="p" variant="body-s" color="muted" className={styles.empty}>
            {t("progress.skills.empty")}
          </Text>
        ) : (
          <>
            <Text as="p" variant="label" color="muted">
              {t("progress.skills.currentLevel")}
            </Text>

            <div className={styles.levelRow}>
              <Text as="p" variant="display" numeric className={styles.levelValue}>
                {level}
              </Text>
              {caption && (
                <Text as="span" variant="body-s" color="muted" className={styles.levelLabel}>
                  {caption}
                </Text>
              )}
            </div>

            <TrendLine bandDelta={bandDelta} deltaWeeks={deltaWeeks} t={t} />

            <LineChart
              points={trend.map((p) => p.band)}
              ariaLabel={t("progress.trendAria", { band: level })}
              className={styles.chart}
            />
          </>
        )}
      </Card>

      {/* ---- The four sub-skills ---- */}
      <section className={styles.skillsSection} aria-label={t("progress.skills.sectionLabel")}>
        <Text as="h2" variant="label" color="muted" className={styles.skillsLabel}>
          {t("progress.skills.sectionLabel")}
        </Text>

        <Card variant="outline" padding="lg" className={styles.skillsCard}>
          <ul className={styles.skillList}>
            {skills.map((s) => {
              const name = t(`progress.skills.${s.key}`);
              const pct = clampPct(s.score);
              return (
                <li
                  key={s.key}
                  className={styles.skillRow}
                  aria-label={`${name}: ${t("units.points", { count: Math.round(pct) })}`}
                >
                  <Text as="span" variant="body" className={styles.skillName}>
                    {name}
                  </Text>
                  <span className={styles.skillTrack} aria-hidden>
                    <span className={styles.skillFill} style={{ width: `${pct}%` }} />
                  </span>
                  <Text
                    as="span"
                    variant="title-s"
                    numeric
                    className={styles.skillScore}
                    aria-hidden
                  >
                    {Math.round(s.score)}
                  </Text>
                </li>
              );
            })}
          </ul>
        </Card>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Trend line                                                                 */
/* -------------------------------------------------------------------------- */

/** The coloured "N haftada +M punkt" line under the level. Hidden when there is
 * not enough history (delta null or fewer than 2 weeks) — the contract nulls the
 * delta in that case so the line simply omits. */
function TrendLine({
  bandDelta,
  deltaWeeks,
  t,
}: {
  bandDelta: number | null;
  deltaWeeks: number;
  t: TFunction;
}) {
  if (bandDelta === null || deltaWeeks < 2) return null;

  const rounded = Math.round(bandDelta);
  const dir: TrendDir = rounded > 0 ? "up" : rounded < 0 ? "down" : "flat";

  const text =
    dir === "up"
      ? t("progress.skills.trendUp", { weeks: deltaWeeks, points: rounded })
      : dir === "down"
        ? t("progress.skills.trendDown", { weeks: deltaWeeks, points: rounded })
        : t("progress.skills.trendFlat", { weeks: deltaWeeks });

  return (
    <Text
      as="p"
      variant="body-s"
      weight="bold"
      color={TREND_COLOR[dir]}
      className={styles.trend}
      data-dir={dir}
    >
      <span aria-hidden>{TREND_ARROW[dir]} </span>
      {text}
    </Text>
  );
}

/* -------------------------------------------------------------------------- */
/* Local helpers                                                              */
/* -------------------------------------------------------------------------- */

type TrendDir = "up" | "down" | "flat";

const TREND_COLOR: Record<TrendDir, TextColor> = {
  up: "success",
  down: "danger",
  flat: "muted",
};

const TREND_ARROW: Record<TrendDir, string> = {
  up: "↑",
  down: "↓",
  flat: "→",
};

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, n));
}
