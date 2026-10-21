import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, StatTile, Text, cx } from "../../shared/ui";
import { Sparkline } from "../../shared/ui/Chart";
import { Page } from "../../widgets";
import type { NavItem } from "../../widgets";
import { RegradeButton } from "../results/RegradeButton";
import { formatDayMonthShort } from "../../shared/format";
import { mockAdminActivity, mockAdminBudget, mockAdminFailed, mockAdminStats } from "./admin.mock";
import styles from "./AdminDashboardScreen.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

/** The counters `GET /api/admin/stats` returns. Every one is a COUNT the database
 * answers directly — nothing here is estimated or projected. */
export interface AdminStats {
  teachers: number;
  students: number;
  questions: number;
  publishedQuestions: number;
  submissions: number;
  evaluatedSubmissions: number;
  /** Queued or being graded right now. Null when the API predates the field. */
  pendingSubmissions: number | null;
  /** Grading ended in an error. Null when the API predates the field. */
  failedSubmissions: number | null;
}

/** One product day of `GET /api/admin/stats/activity`, oldest first. */
export interface AdminActivityPoint {
  date: string;
  submissions: number;
  graded: number;
  failed: number;
  activeStudents: number;
  newStudents: number;
  aiCostUsd: number;
}

/** Today's AI spend against the daily cap (from `GET /api/admin/settings/ai-budget`). */
export interface AdminBudgetGlance {
  spentTodayUsd: number;
  dailyCapUsd: number;
  /** `open` | `paused` | `daily_cap` | `monthly_cap` */
  state: string;
}

/** One answer whose grading failed — a row in the expandable alert. */
export interface AdminFailedItem {
  id: string;
  studentName: string;
  taskTitle: string;
  /** Localized failure reason. */
  reason: string;
  /** Localized "when", already formatted. */
  when: string;
  /** False once the recording is gone — nothing left to grade. */
  canRegrade: boolean;
}

export interface AdminDashboardProps {
  stats: AdminStats;
  /** 14 days, oldest first. Absent/empty ⇒ the trend tiles are not drawn. */
  activity?: AdminActivityPoint[] | null;
  /** Absent ⇒ no AI-spend tile (an older API, or the read failed). */
  budget?: AdminBudgetGlance | null;
  /** The failed answers behind the alert row (newest first, capped). */
  failedItems?: AdminFailedItem[];
  /** Retry one failed answer's grading. Rejects with an already-localized Error. */
  onRegrade?: (id: string) => Promise<void>;
  /** Opens Settings → AI budget. */
  onOpenAiSettings?: () => void;
  /** Opens Jurnal (the audit trail). The nav lists it in the sidebar only, so on a
   * phone this is the way in; absent (a demo, a test), the card is not rendered. */
  onOpenAudit?: () => void;
  activeNavKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * AdminDashboardScreen — **Boshqaruv**, the admin landing page.
 *
 * Top to bottom, in the order an admin acts on it:
 *   1. **Alerts** — actionable rows only: failed grading (expands to the failed
 *      answers, each with a regrade), the AI budget when it is closed, work in
 *      flight; "all graded" when there is nothing to do.
 *   2. **This week** — trend tiles, each this-7-days vs the 7 before with a 14-day
 *      sparkline: answers, new students, grading success, and AI spend today
 *      against the daily cap (a link to Settings).
 *   3. **Totals** — the six all-time counters, compact.
 *
 * Still deliberately absent: revenue, ratings, retention — no payment provider or
 * table stands behind them, and a decorative number is worse than none.
 */
export function AdminDashboardScreen({
  stats,
  activity,
  budget,
  failedItems = [],
  onRegrade,
  onOpenAiSettings,
  onOpenAudit,
}: AdminDashboardProps) {
  const { t } = useTranslation();

  // FLOOR, not round: 768 of 770 rounds to 100%, which sat directly above "2 answers
  // are still ungraded" and contradicted it. Only a complete queue reads 100%.
  const gradedPct =
    stats.submissions > 0
      ? Math.floor((stats.evaluatedSubmissions / stats.submissions) * 100)
      : null;
  // In flight and failed are two different answers to "is grading keeping up?" —
  // a failure never finishes on its own, so it must not read as "still ungraded".
  const legacy = stats.pendingSubmissions === null || stats.failedSubmissions === null;
  const pending = Math.max(0, stats.pendingSubmissions ?? 0);
  const failed = Math.max(0, stats.failedSubmissions ?? 0);
  const ungraded = Math.max(0, stats.submissions - stats.evaluatedSubmissions);
  const budgetClosed = !!budget && budget.state !== "open";
  const hasActivity = !!activity && activity.length > 0;

  return (
    <Page title={t("nav.adminHome")} width="wide">
      <div className={styles.page} data-density="compact">
        {/* ---- 1 · Alerts ---- */}
        <section className={styles.section} aria-label={t("uiDash.admin.alerts")}>
          <Text as="h2" variant="label" color="muted" className={styles.legend}>
            {t("uiDash.admin.alerts")}
          </Text>
          <div className={styles.alerts}>
            {legacy ? (
              <AlertRow tone={ungraded > 0 ? "warn" : "ok"}>
                {ungraded > 0 ? t("admin.ungradedNote", { count: ungraded }) : t("admin.allGradedNote")}
              </AlertRow>
            ) : (
              <>
                {failed > 0 && <FailedAlert count={failed} items={failedItems} onRegrade={onRegrade} />}
                {budgetClosed && budget && (
                  <AlertRow
                    tone="warn"
                    onClick={onOpenAiSettings}
                    action={onOpenAiSettings ? t("uiDash.admin.openSettings") : undefined}
                  >
                    {t("uiDash.admin.budgetClosed", {
                      state: t(`admin.aiBudgetState.${budget.state}`, { defaultValue: budget.state }),
                    })}
                  </AlertRow>
                )}
                {pending > 0 && <AlertRow tone="info">{t("admin.pendingNote", { count: pending })}</AlertRow>}
                {pending === 0 && failed === 0 && (
                  <AlertRow tone={ungraded > 0 ? "warn" : "ok"}>
                    {ungraded > 0 ? t("admin.ungradedNote", { count: ungraded }) : t("admin.allGradedNote")}
                  </AlertRow>
                )}
              </>
            )}
          </div>
        </section>

        {/* ---- 2 · This week ---- */}
        {(hasActivity || budget) && (
          <section className={styles.section} aria-label={t("uiDash.admin.thisWeek")}>
            <Text as="h2" variant="label" color="muted" className={styles.legend}>
              {t("uiDash.admin.thisWeek")}
            </Text>
            <div className={styles.kpis}>
              {hasActivity && <TrendTiles activity={activity!} />}
              {budget && <BudgetTile budget={budget} activity={activity ?? []} onOpen={onOpenAiSettings} />}
            </div>
          </section>
        )}

        {/* ---- 3 · Totals ---- */}
        <section className={styles.section} aria-label={t("uiDash.admin.totals")}>
          <Text as="h2" variant="label" color="muted" className={styles.legend}>
            {t("uiDash.admin.totals")}
          </Text>
          <div className={styles.totals}>
            <StatTile variant="outline" value={stats.teachers} label={t("admin.teachers")} />
            <StatTile variant="outline" value={stats.students} label={t("admin.students")} />
            <StatTile variant="outline" value={stats.questions} label={t("admin.tasks")} />
            <StatTile variant="outline" value={stats.publishedQuestions} label={t("admin.published")} />
            <StatTile variant="outline" value={stats.submissions} label={t("admin.answers")} />
            <StatTile
              variant="outline"
              value={gradedPct === null ? "—" : gradedPct}
              unit={gradedPct === null ? undefined : "%"}
              label={t("admin.graded")}
            />
          </div>
          {/* A draft reaches nobody: the gap is how much authored work is not live. */}
          <Text as="p" variant="body-s" color="muted">
            {t("admin.draftsNote", { count: Math.max(0, stats.questions - stats.publishedQuestions) })}
          </Text>
        </section>

        {onOpenAudit && (
          <section className={styles.section} aria-label={t("admin.audit.title")}>
            <Text as="h2" variant="label" color="muted" className={styles.legend}>
              {t("admin.audit.title")}
            </Text>
            <Card variant="flat" padding="md" className={styles.notes}>
              <Text as="p" variant="body-s" color="muted">
                {t("admin.audit.dashboardHint")}
              </Text>
              <div>
                <Button variant="secondary" size="sm" onClick={onOpenAudit}>
                  {t("admin.audit.open")}
                </Button>
              </div>
            </Card>
          </section>
        )}
      </div>
    </Page>
  );
}

/* -------------------------------------------------------------------------- */
/* Alerts                                                                     */
/* -------------------------------------------------------------------------- */

type AlertTone = "danger" | "warn" | "info" | "ok";

function AlertRow({
  tone,
  children,
  onClick,
  action,
  expanded,
}: {
  tone: AlertTone;
  children: ReactNode;
  onClick?: () => void;
  action?: string;
  expanded?: boolean;
}) {
  const body = (
    <>
      <span className={styles.alertIcon} aria-hidden>
        {ALERT_GLYPH[tone]}
      </span>
      <Text as="span" variant="body-s" weight="semibold" className={styles.alertText}>
        {children}
      </Text>
      {action && (
        <span className={styles.alertAction}>
          <Text as="span" variant="body-s" weight="bold">
            {action}
          </Text>
          <span className={cx(styles.alertChevron, expanded && styles.alertChevronOpen)} aria-hidden>
            <ChevronGlyph />
          </span>
        </span>
      )}
    </>
  );
  const cls = cx(styles.alert, styles[`alert-${tone}` as const]);
  return onClick ? (
    <button type="button" className={cx(cls, styles.alertBtn)} onClick={onClick} aria-expanded={expanded}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function FailedAlert({
  count,
  items,
  onRegrade,
}: {
  count: number;
  items: AdminFailedItem[];
  onRegrade?: (id: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<Set<string>>(() => new Set());
  const canExpand = items.length > 0;

  return (
    <div className={styles.failedWrap}>
      <AlertRow
        tone="danger"
        onClick={canExpand ? () => setOpen((o) => !o) : undefined}
        action={canExpand ? (open ? t("uiDash.admin.hide") : t("uiDash.admin.show")) : undefined}
        expanded={canExpand ? open : undefined}
      >
        {t("admin.failedNote", { count })}
      </AlertRow>
      {open && (
        <ul className={styles.failedList}>
          {items.map((it) => (
            <li key={it.id} className={styles.failedItem}>
              <div className={styles.failedText}>
                <Text as="span" variant="body-s" weight="bold" truncate>
                  {it.studentName} · {it.taskTitle}
                </Text>
                <Text as="span" variant="body-s" color="muted">
                  {it.reason} · {it.when}
                </Text>
              </div>
              {sent.has(it.id) ? (
                <Text as="span" variant="body-s" color="info" weight="semibold" role="status">
                  {t("uiDash.regrade.sent")}
                </Text>
              ) : (
                onRegrade &&
                it.canRegrade && (
                  <RegradeButton
                    label={it.taskTitle}
                    compact
                    onRegrade={async () => {
                      await onRegrade(it.id);
                      setSent((s) => new Set(s).add(it.id));
                    }}
                  />
                )
              )}
            </li>
          ))}
          {count > items.length && (
            <li className={styles.failedMore}>
              <Text as="span" variant="body-s" color="muted">
                {t("uiDash.admin.moreFailed", { count: count - items.length })}
              </Text>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Trend tiles                                                                */
/* -------------------------------------------------------------------------- */

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
/** `21.10` — the short day a trend tooltip names. */
const dayLabel = (iso: string) => formatDayMonthShort(iso);

/** This 7 days vs the 7 before. */
function weekSplit(series: number[]) {
  return { cur: sum(series.slice(-7)), prev: sum(series.slice(-14, -7)) };
}

/** Graded share of the answers submitted in `days`; no answers ⇒ no rate (null). */
function gradingRate(days: AdminActivityPoint[]): number | null {
  const n = sum(days.map((d) => d.submissions));
  return n > 0 ? Math.floor((sum(days.map((d) => d.graded)) / n) * 100) : null;
}

function TrendTiles({ activity }: { activity: AdminActivityPoint[] }) {
  const { t } = useTranslation();
  const subs = activity.map((d) => d.submissions);
  const joins = activity.map((d) => d.newStudents);
  const s = weekSplit(subs);
  const j = weekSplit(joins);
  const rateCur = gradingRate(activity.slice(-7));
  const ratePrev = gradingRate(activity.slice(-14, -7));
  const dayRates = activity.map((d) => (d.submissions > 0 ? Math.floor((d.graded / d.submissions) * 100) : null));
  const aria = (what: string, values: Array<string | number>) =>
    t("uiDash.admin.sparkAria", { what, values: values.join(", ") });

  return (
    <>
      <KpiTile
        label={t("uiDash.admin.kpiAnswers")}
        value={s.cur}
        delta={<Delta cur={s.cur} prev={s.prev} />}
        spark={
          <Sparkline
            values={subs}
            label={aria(t("uiDash.admin.kpiAnswers"), subs)}
            titles={activity.map((d) => `${dayLabel(d.date)} · ${d.submissions}`)}
          />
        }
      />
      <KpiTile
        label={t("uiDash.admin.kpiNewStudents")}
        value={j.cur}
        delta={<Delta cur={j.cur} prev={j.prev} />}
        spark={
          <Sparkline
            values={joins}
            label={aria(t("uiDash.admin.kpiNewStudents"), joins)}
            titles={activity.map((d) => `${dayLabel(d.date)} · ${d.newStudents}`)}
          />
        }
      />
      <KpiTile
        label={t("uiDash.admin.kpiGradingRate")}
        value={rateCur === null ? "—" : rateCur}
        unit={rateCur === null ? undefined : "%"}
        delta={
          rateCur !== null && ratePrev !== null ? (
            <Delta cur={rateCur} prev={ratePrev} points />
          ) : (
            <Text as="span" variant="body-s" color="muted">
              {t("uiDash.admin.noPrev")}
            </Text>
          )
        }
        spark={
          <Sparkline
            values={dayRates}
            label={aria(t("uiDash.admin.kpiGradingRate"), dayRates.map((r) => (r === null ? "—" : `${r}%`)))}
            titles={activity.map((d, i) => `${dayLabel(d.date)} · ${dayRates[i] === null ? "—" : `${dayRates[i]}%`}`)}
          />
        }
      />
    </>
  );
}

function KpiTile({
  label,
  value,
  unit,
  delta,
  spark,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  delta: ReactNode;
  spark: ReactNode;
}) {
  return (
    <Card variant="outline" padding="sm" className={styles.kpi}>
      <Text as="span" variant="body-s" color="muted" weight="semibold">
        {label}
      </Text>
      <span className={styles.kpiValue}>
        <Text as="span" variant="title-l" weight="black" numeric>
          {value}
        </Text>
        {unit && (
          <Text as="span" variant="body-s" color="muted" weight="bold">
            {unit}
          </Text>
        )}
      </span>
      {delta}
      <div className={styles.kpiSpark}>{spark}</div>
    </Card>
  );
}

/** "↑ 12% vs last week" — a change in % of last week, in points for a rate, or a
 * plain count when last week was zero (a percentage of nothing is not a number).
 * The arrow + words carry the direction; colour only reinforces it. */
function Delta({ cur, prev, points = false }: { cur: number; prev: number; points?: boolean }) {
  const { t } = useTranslation();
  const diff = cur - prev;
  const dir = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  const amount = points
    ? t("uiDash.admin.deltaPoints", { value: Math.abs(diff) })
    : prev > 0
      ? `${Math.round((Math.abs(diff) / prev) * 100)}%`
      : String(Math.abs(diff));
  return (
    <span className={cx(styles.delta, styles[`delta-${dir}` as const])}>
      <span aria-hidden>{dir === "up" ? "↑" : dir === "down" ? "↓" : "→"}</span>
      <Text as="span" variant="body-s" weight="semibold" className={styles.deltaText}>
        {dir === "flat"
          ? t("uiDash.admin.deltaSame")
          : t(dir === "up" ? "uiDash.admin.deltaUp" : "uiDash.admin.deltaDown", { value: amount })}
      </Text>
    </span>
  );
}

function BudgetTile({
  budget,
  activity,
  onOpen,
}: {
  budget: AdminBudgetGlance;
  activity: AdminActivityPoint[];
  onOpen?: () => void;
}) {
  const { t } = useTranslation();
  const usd = (n: number) => `$${n.toFixed(2)}`;
  const share = budget.dailyCapUsd > 0 ? Math.min(1, budget.spentTodayUsd / budget.dailyCapUsd) : 0;
  const costs = activity.map((d) => d.aiCostUsd);
  const tone = budget.state !== "open" ? "danger" : share >= 0.8 ? "warn" : "ok";
  const body = (
    <>
      <Text as="span" variant="body-s" color="muted" weight="semibold">
        {t("uiDash.admin.kpiAiToday")}
      </Text>
      <span className={styles.kpiValue}>
        <Text as="span" variant="title-l" weight="black" numeric>
          {usd(budget.spentTodayUsd)}
        </Text>
        <Text as="span" variant="body-s" color="muted" weight="bold" numeric>
          / {usd(budget.dailyCapUsd)}
        </Text>
      </span>
      <span
        className={styles.meter}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={budget.dailyCapUsd}
        aria-valuenow={budget.spentTodayUsd}
        aria-label={t("uiDash.admin.kpiAiToday")}
      >
        <span className={cx(styles.meterFill, styles[`meter-${tone}` as const])} style={{ width: `${share * 100}%` }} />
      </span>
      <Text as="span" variant="body-s" color={budget.state === "open" ? "muted" : "danger"} weight="semibold">
        {t(`admin.aiBudgetState.${budget.state}`, { defaultValue: budget.state })}
        {onOpen ? ` · ${t("uiDash.admin.openSettings")} →` : ""}
      </Text>
      {costs.length > 0 && (
        <div className={styles.kpiSpark}>
          <Sparkline
            values={costs}
            label={t("uiDash.admin.sparkAria", {
              what: t("uiDash.admin.kpiAiToday"),
              values: costs.map(usd).join(", "),
            })}
            titles={activity.map((d) => `${dayLabel(d.date)} · ${usd(d.aiCostUsd)}`)}
          />
        </div>
      )}
    </>
  );
  return onOpen ? (
    <button type="button" className={cx(styles.kpi, styles.kpiBtn)} onClick={onOpen}>
      {body}
    </button>
  ) : (
    <Card variant="outline" padding="sm" className={styles.kpi}>
      {body}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Glyphs                                                                     */
/* -------------------------------------------------------------------------- */

function ChevronGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const ALERT_GLYPH: Record<AlertTone, ReactNode> = {
  danger: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M12 3 2 20h20z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
      <path d="M12 10v4M12 17h.01" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  ),
  warn: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.9" />
      <path d="M12 7v6M12 16.5h.01" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  ),
  info: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.9" />
      <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  ),
  ok: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

/* -------------------------------------------------------------------------- */
/* Default export — a self-wired demo.                                        */
/* -------------------------------------------------------------------------- */

export default function AdminDashboardDemo() {
  return (
    <AdminDashboardScreen
      stats={mockAdminStats}
      activity={mockAdminActivity}
      budget={mockAdminBudget}
      failedItems={mockAdminFailed}
    />
  );
}
