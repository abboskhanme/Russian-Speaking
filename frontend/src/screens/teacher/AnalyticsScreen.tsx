import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, StatTile, Tabs, Text, VisuallyHidden, cx } from "../../shared/ui";
import type { TabItem } from "../../shared/ui";
import { AppShell, Brand, NotificationsBell, teacherNavItems } from "../../widgets";
import type { NavItem } from "../../widgets";
import { mockAnalytics } from "./analytics.mock";
import styles from "./AnalyticsScreen.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

/** One month of the hero chart. `avg` null = no graded attempt that month, and
 * the line GAPS there rather than dropping to zero. `label` is already
 * localized by the caller (from `time.month*` — never `Intl.DateTimeFormat`). */
export interface AnalyticsTrendPoint {
  key: string;
  label: string;
  avg: number | null;
}

/** One skill bar. `score` null = never measured, which reads as "baholanmagan"
 * rather than as a zero. */
export interface AnalyticsSkill {
  key: string;
  label: string;
  score: number | null;
}

/** One column of "Haftalik faollik". `label` comes from `time.wd*`. */
export interface AnalyticsWeekDay {
  key: string;
  label: string;
  attempts: number;
  /** The last column — today. Highlighted by weight AND colour. */
  today?: boolean;
}

/** One row of "Ko'p uchragan xatolar". `share` is 0–1. */
export interface AnalyticsErrorRow {
  type: string;
  /** Localized via `teacher.errorType.*`, falling back to the raw type. */
  label: string;
  count: number;
  studentCount: number;
  share: number;
}

/** Everything D1 draws. Null throughout = "no data yet", never zero. */
export interface AnalyticsInsights {
  classAvg: number | null;
  /** CEFR bucket, e.g. "B1" — the hero's DISPLAY value. It has to be the short
   * code: the Uzbek label ("o'rta-yuqori") wraps to two lines at display size and
   * shoves the band off the card. */
  classLevel: string | null;
  /** The short label paired with {@link classLevel} ("o'rta-yuqori"). Secondary
   * text beside the band, so the code stays the headline and nothing is lost. */
  classLevelLabel?: string | null;
  /** Points vs. the previous month; null when either month is empty. */
  trendDelta: number | null;
  trend: AnalyticsTrendPoint[];
  activeStudents: number;
  totalStudents: number;
  assignmentsDone: number;
  assignmentsTotal: number;
  /** Already converted from seconds by the caller. */
  practiceMinutes: number;
  reviewedWeek: number;
  skills: AnalyticsSkill[];
  week: AnalyticsWeekDay[];
  errors: AnalyticsErrorRow[];
}

/** One row of D2 Jurnal. Every score is optional — a student with no graded
 * attempt reads "baholanmagan", never 0 (established in Phase 2). */
export interface GradebookStudent {
  id: string;
  fullName: string;
  fluency?: number;
  grammar?: number;
  pronunciation?: number;
  lexical?: number;
  attempts: number;
  score?: number;
}

/** A group in the filter. Only rendered when the teacher has more than one. */
export interface AnalyticsGroupOption {
  id: string;
  name: string;
}

export type AnalyticsTabKey = "insights" | "grades";

export interface AnalyticsScreenProps {
  /** Null while the endpoint is unavailable — the tab then shows one calm
   * message instead of a grid of dashes. */
  insights: AnalyticsInsights | null;
  gradebook: GradebookStudent[];
  activeTab?: AnalyticsTabKey;
  onTabChange?: (key: AnalyticsTabKey) => void;
  groups?: AnalyticsGroupOption[];
  /** null / undefined = all of the teacher's groups. */
  activeGroupId?: string | null;
  onGroupChange?: (id: string | null) => void;
  activeNavKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
  queuedCount?: number;
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * AnalyticsScreen — **D1 «Insaytlar» + D2 «Jurnal»**
 * (`docs/design/mockups/Govorim - Teacher.dc.html`). One screen, the mockup's
 * `Insaytlar | Jurnal` segmented control on top.
 *
 * D1 order, from the mockup: inverted hero (class average + CEFR + delta chip +
 * 3-month area chart) → 2×2 KPI tiles → "Ko'nikma taqsimoti" bars → "Haftalik
 * faollik" columns → "Ko'p uchragan xatolar" ranked rows.
 *
 * **Nothing here is invented.** Every number comes from `GET
 * /api/reports/insights` / `GET /api/reports/gradebook`, and every one of them
 * can be null: a class with no graded attempt gets an empty state per section,
 * not a wall of zeros. Divide-by-zero renders an em-dash, never `NaN%`.
 *
 * **The mockup's per-error "Mashq ber" button is deliberately absent** — there
 * is no error-type→task mapping anywhere in the data, so the button would have
 * nothing to assign.
 *
 * Presentational and prop-driven: it fetches nothing (the CSV export is the one
 * side effect, and it is built entirely from the rows already on screen).
 * Full-width (docs/04 §4.10), compact density (docs/03 §3.5). Teacher panel
 * design — not a student screen restyled.
 */
export function AnalyticsScreen({
  insights,
  gradebook,
  activeTab = "insights",
  onTabChange,
  groups = [],
  activeGroupId = null,
  onGroupChange,
  activeNavKey = "analytics",
  onNavigate,
  queuedCount = 0,
}: AnalyticsScreenProps) {
  const { t } = useTranslation();

  const tabs: TabItem[] = [
    { key: "insights", label: t("teacher.analytics.tabInsights") },
    { key: "grades", label: t("teacher.analytics.tabGrades") },
  ];

  return (
    <AppShell
      brand={<Brand />}
      nav={{
        items: teacherNavItems(t, queuedCount),
        activeKey: activeNavKey,
        onNavigate,
        label: t("nav.landmark"),
      }}
      headerStart={
        <Text as="h1" variant="title-m">
          {t("nav.analytics")}
        </Text>
      }
      headerEnd={<NotificationsBell />}
    >
      <div className={styles.page} data-density="compact">
        <Tabs
          items={tabs}
          activeKey={activeTab}
          onChange={(k) => onTabChange?.(k as AnalyticsTabKey)}
          aria-label={t("nav.analytics")}
        />

        {/* One group needs no filter — a control with a single choice is noise. */}
        {groups.length > 1 && (
          <div className={styles.filter}>
            <label className={styles.filterLabel} htmlFor="analytics-group">
              <Text as="span" variant="body-s" color="muted">
                {t("teacher.analytics.groupFilter")}
              </Text>
            </label>
            <select
              id="analytics-group"
              className={styles.select}
              value={activeGroupId ?? ""}
              onChange={(e) => onGroupChange?.(e.target.value || null)}
            >
              <option value="">{t("teacher.analytics.allGroups")}</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {activeTab === "insights" ? (
          <InsightsTab insights={insights} />
        ) : (
          <GradesTab rows={gradebook} />
        )}
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* D1 — Insaytlar                                                             */
/* -------------------------------------------------------------------------- */

function InsightsTab({ insights }: { insights: AnalyticsInsights | null }) {
  const { t } = useTranslation();

  if (!insights) {
    return (
      <Card variant="flat" padding="md" className={styles.empty}>
        <Text as="p" variant="body" color="muted">
          {t("teacher.analytics.noInsights")}
        </Text>
      </Card>
    );
  }

  return (
    <>
      <HeroCard insights={insights} />
      <KpiTiles insights={insights} />
      <SkillsSection skills={insights.skills} />
      <WeekSection week={insights.week} />
      <ErrorsSection errors={insights.errors} />
    </>
  );
}

/* ---- Hero: class average + CEFR + delta + 3-month chart ------------------ */

function HeroCard({ insights }: { insights: AnalyticsInsights }) {
  const { t } = useTranslation();
  const { classAvg, classLevel, classLevelLabel, trendDelta, trend } = insights;
  const hasTrend = trend.some((p) => p.avg != null);

  return (
    <section className={styles.hero} aria-label={t("teacher.analytics.classAvgTitle")}>
      <div className={styles.heroTop}>
        <div className={styles.heroHeadline}>
          <Text as="h2" variant="label" className={styles.heroLabel}>
            {t("teacher.analytics.classAvgTitle")}
          </Text>
          {classAvg == null ? (
            <Text as="p" variant="body" className={styles.heroEmpty}>
              {t("teacher.analytics.noScores")}
            </Text>
          ) : (
            <p className={styles.heroValue}>
              <Text as="span" variant="display" className={styles.heroLevel}>
                {classLevel ?? "—"}
              </Text>
              <Text as="span" variant="body-s" numeric className={styles.heroBand}>
                {classLevelLabel
                  ? `${classLevelLabel} · ${t("teacher.analytics.outOf", { score: Math.round(classAvg) })}`
                  : t("teacher.analytics.outOf", { score: Math.round(classAvg) })}
              </Text>
            </p>
          )}
        </div>

        {trendDelta != null && <DeltaChip delta={trendDelta} />}
      </div>

      {hasTrend ? (
        <>
          <TrendChart trend={trend} />
          <ul className={styles.heroAxis}>
            {trend.map((p) => (
              <Text as="li" key={p.key} variant="body-s" className={styles.heroAxisLabel}>
                {p.label}
              </Text>
            ))}
          </ul>
        </>
      ) : (
        <Text as="p" variant="body-s" className={styles.heroChartEmpty}>
          {t("teacher.analytics.noTrend")}
        </Text>
      )}
    </section>
  );
}

/** `↑ +7 punkt` — the arrow, the sign AND the colour all say the same thing, so
 * colour is never the only signal (docs/03 §3.3). */
function DeltaChip({ delta }: { delta: number }) {
  const { t } = useTranslation();
  const rounded = Math.round(delta);
  const dir = rounded > 0 ? "up" : rounded < 0 ? "down" : "flat";
  const arrow = dir === "up" ? "↑" : dir === "down" ? "↓" : "→";
  const signed = rounded > 0 ? `+${rounded}` : String(rounded);

  return (
    <span className={cx(styles.delta, styles[`delta-${dir}` as const])}>
      <span aria-hidden>{arrow}</span>
      <Text as="span" variant="body-s" weight="black" numeric>
        {t("teacher.analytics.deltaPoints", { delta: signed })}
      </Text>
      <VisuallyHidden>
        {t(
          dir === "up"
            ? "teacher.analytics.deltaUpAria"
            : dir === "down"
              ? "teacher.analytics.deltaDownAria"
              : "teacher.analytics.deltaFlatAria",
        )}
      </VisuallyHidden>
    </span>
  );
}

const CHART_W = 300;
const CHART_H = 72;
/** Band 0–100 maps into this vertical band, leaving room for the end dot. */
const CHART_TOP = 10;
const CHART_BOTTOM = 62;

/**
 * The hero's 3-month area chart. The domain is a FIXED 0–100 band, not the data's
 * own min/max: a two-point range auto-scaled to the box turns a 1-point wobble
 * into a cliff. A month with no data is a gap — `avg: null` breaks the line
 * instead of being drawn as zero, which would invent a catastrophic month.
 */
function TrendChart({ trend }: { trend: AnalyticsTrendPoint[] }) {
  const { t } = useTranslation();

  const points = useMemo(() => {
    const n = Math.max(trend.length - 1, 1);
    return trend.map((p, i) => ({
      x: (i / n) * CHART_W,
      y:
        p.avg == null
          ? null
          : CHART_BOTTOM - (Math.max(0, Math.min(100, p.avg)) / 100) * (CHART_BOTTOM - CHART_TOP),
      avg: p.avg,
      label: p.label,
    }));
  }, [trend]);

  /** Contiguous runs of real months. Each is drawn on its own, so the gaps stay
   * gaps rather than being bridged by a straight line through missing data. */
  const runs = useMemo(() => {
    const out: { x: number; y: number }[][] = [];
    let cur: { x: number; y: number }[] = [];
    for (const p of points) {
      if (p.y == null) {
        if (cur.length) out.push(cur);
        cur = [];
      } else {
        cur.push({ x: p.x, y: p.y });
      }
    }
    if (cur.length) out.push(cur);
    return out;
  }, [points]);

  const summary = trend
    .map((p) =>
      p.avg == null
        ? `${p.label}: ${t("teacher.notScored")}`
        : `${p.label}: ${Math.round(p.avg)}`,
    )
    .join(", ");

  return (
    <svg
      className={styles.chart}
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={summary}
    >
      <defs>
        <linearGradient id="govori-trend-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.4" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>

      {runs.map((run, i) =>
        run.length > 1 ? (
          <g key={`run-${i}`}>
            <path
              d={`M${run.map((p) => `${p.x},${p.y}`).join(" ")} L${run[run.length - 1]!.x},${CHART_H} L${run[0]!.x},${CHART_H} Z`}
              fill="url(#govori-trend-fill)"
            />
            <polyline
              points={run.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ) : null,
      )}

      {/* A dot on every real month, so a lone month still shows as something.
          Drawn as a zero-length round-capped line rather than a <circle>: the
          box is stretched horizontally by preserveAspectRatio="none", which
          would flatten a real circle into a wide ellipse on a desktop width.
          `non-scaling-stroke` renders the cap in device space, so it stays
          round at every viewport. */}
      {points.map((p, i) =>
        p.y == null ? null : (
          <line
            key={`dot-${i}`}
            x1={p.x}
            y1={p.y}
            x2={p.x}
            y2={p.y}
            stroke="currentColor"
            strokeWidth="7"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ),
      )}
    </svg>
  );
}

/* ---- 2×2 KPI tiles ------------------------------------------------------- */

function KpiTiles({ insights }: { insights: AnalyticsInsights }) {
  const { t } = useTranslation();

  // Divide-by-zero is an em-dash, not NaN%. A teacher who has set no
  // assignments has no completion rate — that is not "0% done".
  const completion =
    insights.assignmentsTotal > 0
      ? Math.round((insights.assignmentsDone / insights.assignmentsTotal) * 100)
      : null;

  return (
    <div className={styles.kpis}>
      <StatTile
        variant="outline"
        value={insights.totalStudents > 0 ? insights.activeStudents : "—"}
        unit={insights.totalStudents > 0 ? `/ ${insights.totalStudents}` : undefined}
        label={t("teacher.analytics.kpiActive")}
      />
      <StatTile
        variant="outline"
        value={completion ?? "—"}
        unit={completion != null ? "%" : undefined}
        label={t("teacher.analytics.kpiCompletion")}
      />
      <StatTile
        variant="outline"
        value={insights.practiceMinutes}
        unit={t("teacher.analytics.unitMinutes")}
        label={t("teacher.analytics.kpiPractice")}
      />
      <StatTile
        variant="outline"
        value={insights.reviewedWeek}
        unit={t("teacher.analytics.unitAnswers")}
        label={t("teacher.analytics.kpiReviewed")}
      />
    </div>
  );
}

/* ---- Ko'nikma taqsimoti -------------------------------------------------- */

function SkillsSection({ skills }: { skills: AnalyticsSkill[] }) {
  const { t } = useTranslation();
  const anyScored = skills.some((s) => s.score != null);

  return (
    <section className={styles.section} aria-label={t("teacher.analytics.skillsTitle")}>
      <Text as="h3" variant="label" color="faint">
        {t("teacher.analytics.skillsTitle")}
      </Text>
      {!anyScored ? (
        <Card variant="flat" padding="md" className={styles.empty}>
          <Text as="p" variant="body" color="muted">
            {t("teacher.analytics.noSkills")}
          </Text>
        </Card>
      ) : (
        <Card variant="outline" padding="md" className={styles.skills}>
          {skills.map((s) => (
            <SkillBar key={s.key} skill={s} />
          ))}
        </Card>
      )}
    </section>
  );
}

function SkillBar({ skill }: { skill: AnalyticsSkill }) {
  const { t } = useTranslation();
  const scored = skill.score != null;
  const tone = scored ? scoreTone(skill.score!) : null;

  return (
    <div className={styles.skillRow}>
      <Text as="span" variant="body-s" weight="semibold" className={styles.skillLabel}>
        {skill.label}
      </Text>
      {scored ? (
        <div
          className={styles.track}
          role="progressbar"
          aria-valuenow={Math.round(skill.score!)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={skill.label}
        >
          <div
            className={cx(styles.fill, styles[`fill-${tone}` as const])}
            style={{ width: `${clamp(skill.score!)}%` }}
          />
        </div>
      ) : (
        // Never measured — an empty track plus the word, not a zero-width bar
        // that would read as "scored zero".
        <div className={styles.track} aria-hidden />
      )}
      {scored ? (
        <Text
          as="span"
          variant="body-s"
          weight="black"
          numeric
          className={cx(styles.skillScore, styles[`score-${tone}` as const])}
        >
          {Math.round(skill.score!)}
        </Text>
      ) : (
        <Text as="span" variant="body-s" color="faint" className={styles.skillScoreNone}>
          {t("teacher.notScored")}
        </Text>
      )}
    </div>
  );
}

/* ---- Haftalik faollik ---------------------------------------------------- */

function WeekSection({ week }: { week: AnalyticsWeekDay[] }) {
  const { t } = useTranslation();
  // Scaled to the busiest day in the set. An all-zero week keeps its axis and
  // its labels — the max guard is what stops the 0/0.
  const max = week.reduce((m, d) => Math.max(m, d.attempts), 0);
  const total = week.reduce((sum, d) => sum + d.attempts, 0);

  return (
    <section className={styles.section} aria-label={t("teacher.analytics.weekTitle")}>
      <Text as="h3" variant="label" color="faint">
        {t("teacher.analytics.weekTitle")}
      </Text>
      <Card variant="outline" padding="md" className={styles.weekCard}>
        <ul className={styles.weekBars}>
          {week.map((d) => (
            <li key={d.key} className={styles.weekCol}>
              {d.attempts > 0 && (
                <Text as="span" variant="body-s" color="muted" numeric className={styles.weekCount}>
                  {d.attempts}
                </Text>
              )}
              <span
                className={cx(styles.weekBar, d.today && styles.weekBarToday)}
                style={{ height: max > 0 ? `${(d.attempts / max) * 100}%` : "0%" }}
              />
              <VisuallyHidden>
                {t("teacher.analytics.weekBarAria", { day: d.label, count: d.attempts })}
              </VisuallyHidden>
            </li>
          ))}
        </ul>
        <div className={styles.weekAxis} aria-hidden>
          {week.map((d) => (
            <Text
              key={d.key}
              as="span"
              variant="body-s"
              className={cx(styles.weekLabel, d.today && styles.weekLabelToday)}
            >
              {d.label}
            </Text>
          ))}
        </div>
        {total === 0 && (
          <Text as="p" variant="body-s" color="muted" align="center">
            {t("teacher.analytics.noActivity")}
          </Text>
        )}
      </Card>
    </section>
  );
}

/* ---- Ko'p uchragan xatolar ----------------------------------------------- */

function ErrorsSection({ errors }: { errors: AnalyticsErrorRow[] }) {
  const { t } = useTranslation();

  return (
    <section className={styles.section} aria-label={t("teacher.analytics.errorsTitle")}>
      <Text as="h3" variant="label" color="faint">
        {t("teacher.analytics.errorsTitle")}
      </Text>
      {errors.length === 0 ? (
        <Card variant="flat" padding="md" className={styles.empty}>
          <Text as="p" variant="body" color="muted">
            {t("teacher.analytics.noErrors")}
          </Text>
        </Card>
      ) : (
        <ul className={styles.errorList}>
          {errors.map((e, i) => (
            <li key={e.type}>
              <ErrorRow row={e} rank={i + 1} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ErrorRow({ row, rank }: { row: AnalyticsErrorRow; rank: number }) {
  const { t } = useTranslation();
  const tone: ScoreTone | "neutral" = rank === 1 ? "danger" : rank === 2 ? "warn" : "neutral";
  const pct = Math.round(clamp(row.share * 100));

  return (
    <Card variant="outline" padding="md" className={styles.errorCard}>
      <div className={styles.errorTop}>
        {/* The rank numeral carries the ordering; the tint only reinforces it. */}
        <span className={cx(styles.rank, styles[`rank-${tone}` as const])} aria-hidden>
          <Text as="span" variant="body-s" weight="black" numeric>
            {rank}
          </Text>
        </span>
        <div className={styles.errorBody}>
          <Text as="span" variant="mono" weight="semibold" className={styles.errorLabel}>
            {row.label}
          </Text>
          <Text as="span" variant="body-s" color="muted">
            {t("teacher.analytics.errorMeta", { count: row.studentCount, pct })}
          </Text>
        </div>
      </div>
      <div
        className={styles.errorTrack}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={row.label}
      >
        <div
          className={cx(styles.errorFill, styles[`errorFill-${tone}` as const])}
          style={{ width: `${pct}%` }}
        />
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* D2 — Jurnal                                                                */
/* -------------------------------------------------------------------------- */

function GradesTab({ rows }: { rows: GradebookStudent[] }) {
  const { t } = useTranslation();

  if (rows.length === 0) {
    return (
      <Card variant="flat" padding="md" className={styles.empty}>
        <Text as="p" variant="body" color="muted">
          {t("teacher.noStudents")}
        </Text>
      </Card>
    );
  }

  return (
    <>
      <div className={styles.tableWrap}>
        <table className={styles.table} aria-label={t("teacher.analytics.tabGrades")}>
          <thead>
            <tr>
              <th scope="col" className={styles.thName}>
                {t("teacher.analytics.colStudent")}
              </th>
              <th scope="col" className={styles.thNum}>
                {t("teacher.analytics.colFluency")}
              </th>
              <th scope="col" className={styles.thNum}>
                {t("teacher.analytics.colGrammar")}
              </th>
              <th scope="col" className={styles.thScore}>
                {t("teacher.analytics.colScore")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <th scope="row" className={styles.tdName}>
                  <Text as="span" variant="body-s" weight="semibold" truncate>
                    {r.fullName}
                  </Text>
                </th>
                <td className={styles.tdNum}>
                  <SubScore value={r.fluency} />
                </td>
                <td className={styles.tdNum}>
                  <SubScore value={r.grammar} />
                </td>
                <td className={styles.tdScore}>
                  {r.score != null ? (
                    <span
                      className={cx(styles.band, styles[`band-${scoreTone(r.score)}` as const])}
                    >
                      <Text as="span" variant="body-s" weight="black" numeric>
                        {Math.round(r.score)}
                      </Text>
                    </span>
                  ) : (
                    // Phase 2's rule, and it holds here: no graded attempt reads
                    // "baholanmagan", never 0.
                    <Text as="span" variant="body-s" color="faint">
                      {t("teacher.notScored")}
                    </Text>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ExportButton rows={rows} />
    </>
  );
}

function SubScore({ value }: { value?: number }) {
  if (value == null) {
    return (
      <Text as="span" variant="body-s" color="faint" numeric>
        —
      </Text>
    );
  }
  return (
    <Text
      as="span"
      variant="body-s"
      weight="bold"
      numeric
      className={styles[`score-${scoreTone(value)}` as const]}
    >
      {Math.round(value)}
    </Text>
  );
}

/**
 * "CSV eksport" — built entirely in the browser from the rows already on screen.
 * No backend involved, so the file always matches what the teacher is looking at
 * (same group filter, same ordering).
 *
 * Leading BOM: without `﻿` Excel opens a UTF-8 CSV in the system codepage
 * and turns every Cyrillic and Uzbek-Latin name into mojibake.
 */
function ExportButton({ rows }: { rows: GradebookStudent[] }) {
  const { t } = useTranslation();

  const download = () => {
    const header = [
      t("teacher.analytics.colStudent"),
      t("teacher.skillFluency"),
      t("teacher.skillGrammar"),
      t("teacher.skillPronunciation"),
      t("teacher.skillLexical"),
      t("teacher.analytics.colAttempts"),
      t("teacher.analytics.colScore"),
    ];
    const cell = (n?: number) => (n == null ? "" : String(Math.round(n)));
    const body = rows.map((r) => [
      r.fullName,
      cell(r.fluency),
      cell(r.grammar),
      cell(r.pronunciation),
      cell(r.lexical),
      String(r.attempts),
      cell(r.score),
    ]);

    const csv = [header, ...body]
      .map((cols) => cols.map(csvEscape).join(","))
      .join("\r\n");

    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `govori-jurnal-${todayStamp()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke on the next tick — Safari cancels an in-flight download otherwise.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <Button variant="secondary" onClick={download} className={styles.export}>
      {t("teacher.analytics.exportCsv")}
    </Button>
  );
}

/* -------------------------------------------------------------------------- */
/* Local helpers                                                              */
/* -------------------------------------------------------------------------- */

type ScoreTone = "success" | "warn" | "danger";

/** Same thresholds as ClassesScreen / TeacherStudentProfileScreen — a score must
 * not change colour depending on which teacher screen it is shown on. */
function scoreTone(score: number): ScoreTone {
  if (score >= 75) return "success";
  if (score >= 60) return "warn";
  return "danger";
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}

/** RFC 4180: quote anything containing a delimiter, quote or newline, and double
 * every embedded quote. A student's name is free text and may hold any of them. */
function csvEscape(value: string): string {
  return /[",\r\n;]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** `YYYY-MM-DD` in local time, for the filename. Deliberately not
 * `Intl.DateTimeFormat` — a filename must never depend on the locale's ICU data. */
function todayStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/* -------------------------------------------------------------------------- */
/* Default export — a self-wired demo, renderable in isolation.               */
/* -------------------------------------------------------------------------- */

export default function AnalyticsDemo() {
  return <AnalyticsScreen {...mockAnalytics} />;
}
