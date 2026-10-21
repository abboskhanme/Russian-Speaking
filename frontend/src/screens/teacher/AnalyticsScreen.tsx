import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatIsoDate } from "../../shared/format";
import { cefrLabel } from "../../shared/i18n/cefrLabel";
import { Badge, Button, Card, Modal, StatTile, Tabs, Text, VisuallyHidden, cx } from "../../shared/ui";
import type { TabItem } from "../../shared/ui";
import { Page } from "../../widgets";
import type { NavItem } from "../../widgets";
import { mockAnalytics } from "./analytics.mock";
import styles from "./AnalyticsScreen.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

/** One month of the hero chart. `avg` null = no graded attempt that month, and
 * the line GAPS there rather than dropping to zero. `label` is already
 * localized by the caller (the shared date helper — never `Intl.DateTimeFormat`). */
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

/** One column of "Haftalik faollik". `label` comes from the shared date helper (`formatWeekdayShort`). */
export interface AnalyticsWeekDay {
  key: string;
  label: string;
  attempts: number;
  /** The last column — today. Highlighted by weight AND colour. */
  today?: boolean;
}

/** One recipient of a remediation assignment. */
export interface AnalyticsRemediationStudent {
  id: string;
  fullName: string;
}

/**
 * F6 · exactly what "Mashq ber" would send for one error row: ONE task, and the
 * students who actually made that error. Composed server-side (see
 * `InsightsRemediationResponse`), never guessed here.
 *
 * `students` can be EMPTY while the task exists — everyone affected already has
 * it open. That is a reason to disable the button, not to hide the task.
 */
export interface AnalyticsRemediation {
  questionId: string;
  questionTitle: string;
  questionTopic?: string | null;
  questionLevel?: string | null;
  students: AnalyticsRemediationStudent[];
}

/** One row of "Ko'p uchragan xatolar". `share` is 0–1. */
export interface AnalyticsErrorRow {
  type: string;
  /** Localized via `teacher.errorType.*`, falling back to the raw type. */
  label: string;
  count: number;
  studentCount: number;
  share: number;
  /**
   * The row's one-tap remediation. THREE distinct values, and the screen renders
   * each differently — collapsing any two of them tells the teacher a lie:
   *
   *  - `undefined` — the feature is not switched on in this deployment
   *    (`class_insights_enabled`). No button is drawn at all.
   *  - `null` — the feature is on but this row has nothing to assign: either it
   *    is under {@link AnalyticsInsights.remediationMinStudents}, or no
   *    assignable question carries the error. Button DISABLED, reason written out.
   *  - an object — the plan. Button live, but only through a confirm step.
   */
  remediation?: AnalyticsRemediation | null;
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
  /** How many DISTINCT students must have made an error before a remediation is
   * offered for it — the "12 o'quvchi qoqildi" bar. Comes from the server so the
   * threshold has one definition; `0` when the feature is off. It is only used to
   * EXPLAIN a disabled button ("2 o'quvchi, kamida 3 kerak"), never to decide one
   * — the server already decided by sending `remediation: null`. */
  remediationMinStudents?: number;
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
  /**
   * F6 · send the remediation. Resolves with how many assignments were actually
   * created; rejects to surface a failure inside the confirm dialog.
   *
   * The screen never calls this from the row itself — only from the confirm
   * dialog's primary action. Omit it and every "Mashq ber" button is inert, which
   * is what the flagged-off deployment gets anyway.
   */
  onAssignRemediation?: (row: AnalyticsErrorRow, plan: AnalyticsRemediation) => Promise<number>;
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
 * **"Mashq ber" on each error row is F6's one-tap remediation**, and it ships
 * behind `class_insights_enabled`: the server supplies the task (the question
 * this error actually occurred on most often) and exactly the students to send it
 * to, so the screen invents neither. With the flag off the button is absent.
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
  onAssignRemediation,
}: AnalyticsScreenProps) {
  const { t } = useTranslation();

  const tabs: TabItem[] = [
    { key: "insights", label: t("teacher.analytics.tabInsights") },
    { key: "grades", label: t("teacher.analytics.tabGrades") },
  ];

  return (
    <Page title={t("nav.analytics")} width="wide">
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
          <InsightsTab insights={insights} onAssignRemediation={onAssignRemediation} />
        ) : (
          <GradesTab rows={gradebook} />
        )}
      </div>
    </Page>
  );
}

/* -------------------------------------------------------------------------- */
/* D1 — Insaytlar                                                             */
/* -------------------------------------------------------------------------- */

function InsightsTab({
  insights,
  onAssignRemediation,
}: {
  insights: AnalyticsInsights | null;
  onAssignRemediation?: AnalyticsScreenProps["onAssignRemediation"];
}) {
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
      <ErrorsSection
        errors={insights.errors}
        minStudents={insights.remediationMinStudents ?? 0}
        onAssignRemediation={onAssignRemediation}
      />
    </>
  );
}

/* ---- Hero: class average + CEFR + delta + 3-month chart ------------------ */

function HeroCard({ insights }: { insights: AnalyticsInsights }) {
  const { t } = useTranslation();
  const { classAvg, classLevel, trendDelta, trend } = insights;
  // The server's `class_level_label` is Uzbek-only; caption the level in the UI language instead.
  const classLevelLabel = cefrLabel(t, classLevel, insights.classLevelLabel);
  // A line needs two months. One graded month is a single number, said as one —
  // a lone dot in the corner of an empty chart read as "something is broken".
  const realMonths = trend.filter((p) => p.avg != null);
  const hasTrend = realMonths.length >= 2;
  const onlyMonth = realMonths.length === 1 ? realMonths[0] : null;

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
          {onlyMonth
            ? t("uiDash.analytics.oneMonth", {
                month: onlyMonth.label,
                score: Math.round(onlyMonth.avg ?? 0),
              })
            : t("teacher.analytics.noTrend")}
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
      <Text as="h3" variant="label" color="muted">
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
        <Text as="span" variant="body-s" color="muted" className={styles.skillScoreNone}>
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
      <Text as="h3" variant="label" color="muted">
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

/**
 * "Ko'p uchragan xatolar" — and, behind `class_insights_enabled`, **F6**: the
 * one-tap remediation the product strategy names ("12 o'quvchi родительный
 * падеж da qoqildi → 1 tap bilan remediation topshiriq").
 *
 * `sent` is deliberately LOCAL and not a refetch. Once a row's remediation has
 * gone out, the server would answer the next read with an empty audience anyway
 * (everyone now has the task open); re-fetching the whole screen to learn that
 * would blank the charts and throw away the confirmation the teacher just earned.
 * The row states what happened and its button stays down.
 */
export function ErrorsSection({
  errors,
  minStudents,
  onAssignRemediation,
  title,
}: {
  errors: AnalyticsErrorRow[];
  minStudents: number;
  onAssignRemediation?: AnalyticsScreenProps["onAssignRemediation"];
  /** Section heading. A5 reuses this section as "Guruh xatolari" — the same rows,
   * the same numbers and the same F6 button as Analitika filtered to that group. */
  title?: string;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<AnalyticsErrorRow | null>(null);
  const [sent, setSent] = useState<Record<string, number>>({});
  const heading = title ?? t("teacher.analytics.errorsTitle");

  return (
    <section className={styles.section} aria-label={heading}>
      <Text as="h3" variant="label" color="muted">
        {heading}
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
              <ErrorRow
                row={e}
                rank={i + 1}
                minStudents={minStudents}
                sentCount={sent[e.type]}
                onAssign={onAssignRemediation ? () => setPending(e) : undefined}
              />
            </li>
          ))}
        </ul>
      )}

      <RemediationDialog
        row={pending}
        onClose={() => setPending(null)}
        onConfirm={async (row, plan) => {
          const created = await onAssignRemediation!(row, plan);
          setSent((s) => ({ ...s, [row.type]: created }));
          setPending(null);
        }}
      />
    </section>
  );
}

function ErrorRow({
  row,
  rank,
  minStudents,
  sentCount,
  onAssign,
}: {
  row: AnalyticsErrorRow;
  rank: number;
  minStudents: number;
  sentCount?: number;
  onAssign?: () => void;
}) {
  const { t } = useTranslation();
  const tone: ScoreTone | "neutral" = rank === 1 ? "danger" : rank === 2 ? "warn" : "neutral";
  const pct = Math.round(clamp(row.share * 100));

  // `undefined` = the deployment has the feature switched off. No action area at
  // all — an absent feature must not advertise itself as a broken one.
  const showAction = row.remediation !== undefined && onAssign !== undefined;
  const block = showAction ? remediationBlock(row, minStudents) : null;
  const blocked = block ? t(block.key, { min: block.min }) : null;

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

      {showAction && (
        <div className={styles.errorAction}>
          {/* The reason is VISIBLE text, not a `title` tooltip: a disabled button
              takes no focus and shows no tooltip on touch, so a tooltip would
              leave the teacher with a dead control and no explanation. */}
          {sentCount != null ? (
            <Text as="p" variant="body-s" className={styles.errorSent} role="status">
              {t("teacher.analytics.remediationSent", { count: sentCount })}
            </Text>
          ) : (
            blocked && (
              <Text as="p" variant="body-s" color="muted" className={styles.errorReason}>
                {blocked}
              </Text>
            )
          )}
          <Button
            variant="secondary"
            size="sm"
            className={styles.errorCta}
            disabled={blocked != null || sentCount != null}
            onClick={onAssign}
          >
            {t("teacher.analytics.assignDrill")}
          </Button>
        </div>
      )}
    </Card>
  );
}

/**
 * Which i18n key explains a dead "Mashq ber", or `null` when the button is live.
 *
 * Three different dead ends deserve three different sentences: "this error is too
 * rare to drill", "no task carries this error" and "everyone already has this
 * task" call for opposite next moves from a teacher, and one generic "unavailable"
 * would hide which one they are in.
 */
function remediationBlock(
  row: AnalyticsErrorRow,
  minStudents: number,
): { key: string; min?: number } | null {
  if (row.remediation === undefined) return null; // no action area is rendered at all
  if (row.remediation === null) {
    // The server already decided by sending null; `minStudents` only picks which
    // sentence describes that decision.
    return minStudents > 0 && row.studentCount < minStudents
      ? { key: "teacher.analytics.remediationTooRare", min: minStudents }
      : { key: "teacher.analytics.remediationNoTask" };
  }
  return row.remediation.students.length === 0
    ? { key: "teacher.analytics.remediationAllAssigned" }
    : null;
}

/**
 * The confirm step. **Not optional.** One tap sending a task to thirty people is
 * irreversible — there is no unassign — so the dialog spells out all three
 * unknowns before the write: WHICH task, HOW MANY students, and WHO by name.
 *
 * Nothing is sent until the primary action here is pressed; the row's button only
 * ever opens this. A failed write keeps the dialog open with the reason, because
 * closing on failure would leave the teacher unable to tell a refusal from a
 * success.
 */
function RemediationDialog({
  row,
  onClose,
  onConfirm,
}: {
  row: AnalyticsErrorRow | null;
  onClose: () => void;
  onConfirm: (row: AnalyticsErrorRow, plan: AnalyticsRemediation) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const plan = row?.remediation ?? null;

  const close = () => {
    if (busy) return; // never abandon an in-flight write
    setFailed(false);
    onClose();
  };

  const confirm = async () => {
    if (!row || !plan) return;
    setBusy(true);
    setFailed(false);
    try {
      await onConfirm(row, plan);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={row != null && plan != null}
      onClose={close}
      title={t("teacher.analytics.remediationConfirmTitle")}
      closeLabel={t("common.close")}
    >
      {row && plan && (
        <div className={styles.confirm}>
          <Text as="p" variant="body-s" color="muted">
            {t("teacher.analytics.remediationConfirmLead", { error: row.label })}
          </Text>

          <div className={styles.confirmBlock}>
            <Text as="h4" variant="label" color="muted">
              {t("teacher.analytics.remediationConfirmTask")}
            </Text>
            <Text as="p" variant="body" weight="semibold">
              {plan.questionTitle}
            </Text>
            {(plan.questionTopic || plan.questionLevel) && (
              <div className={styles.confirmTags}>
                {plan.questionTopic && <Badge variant="neutral">{plan.questionTopic}</Badge>}
                {plan.questionLevel && <Badge variant="neutral">{plan.questionLevel}</Badge>}
              </div>
            )}
          </div>

          <div className={styles.confirmBlock}>
            <Text as="h4" variant="label" color="muted">
              {t("teacher.analytics.remediationConfirmWho", { count: plan.students.length })}
            </Text>
            {/* Every name, not a "+7 more": the teacher is about to act on this
                exact list and cannot inspect it afterwards. Long rosters scroll
                inside the block rather than pushing the buttons off-screen. */}
            <ul className={styles.confirmNames}>
              {plan.students.map((s) => (
                <Text as="li" key={s.id} variant="body-s">
                  {s.fullName}
                </Text>
              ))}
            </ul>
          </div>

          <Text as="p" variant="body-s" color="muted">
            {t("teacher.analytics.remediationConfirmWarn")}
          </Text>

          {failed && (
            <Text as="p" variant="body-s" className={styles.confirmError} role="alert">
              {t("teacher.analytics.remediationFailed")}
            </Text>
          )}

          <div className={styles.confirmActions}>
            <Button variant="ghost" onClick={close} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" onClick={confirm} loading={busy}>
              {t("teacher.analytics.remediationConfirmCta")}
            </Button>
          </div>
        </div>
      )}
    </Modal>
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
                    <Text as="span" variant="body-s" color="muted">
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
      <Text as="span" variant="body-s" color="muted" numeric>
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

/** `YYYY-MM-DD` in local time, for the filename (the shared helper — never ICU). */
function todayStamp(): string {
  return formatIsoDate(new Date());
}

/* -------------------------------------------------------------------------- */
/* Default export — a self-wired demo, renderable in isolation.               */
/* -------------------------------------------------------------------------- */

export default function AnalyticsDemo() {
  return <AnalyticsScreen {...mockAnalytics} />;
}
