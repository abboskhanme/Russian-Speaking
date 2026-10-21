/**
 * AdminDashboardPage (`/admin`) — Boshqaruv.
 *
 *   • `GET /api/admin/stats`               → the all-time counters + the alert counts
 *   • `GET /api/admin/stats/activity`      → 14 days → week-over-week deltas + sparklines
 *   • `GET /api/admin/settings/ai-budget`  → AI spend today vs the daily cap
 *   • `GET /api/submissions?status=failed` → the failed answers behind the alert row,
 *                                            each retryable (`POST …/regrade`)
 *
 * Stats are load-bearing: with no stats there is no dashboard, so a failure is a real
 * error state. The other three are best-effort (`allSettled`): a dead one costs its
 * own tile or list, never the page.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AdminDashboardScreen } from "../../screens/admin";
import type {
  AdminActivityPoint,
  AdminBudgetGlance,
  AdminFailedItem,
  AdminStats,
} from "../../screens/admin";
import { endpoints } from "../../shared/api";
import type { SubmissionResponse } from "../../shared/api";
import { gradingFailureKey } from "../adapters";
import { requestRegrade } from "../regrade";
import { PageError, PageLoading } from "../PageState";
import { ADMIN_NAV_PATH, useAdminNavHandler } from "../nav";

/** How many failed answers the alert lists; the rest are counted, not shown. */
const FAILED_LIST = 10;

export default function AdminDashboardPage() {
  const onNavigate = useAdminNavHandler();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [activity, setActivity] = useState<AdminActivityPoint[] | null>(null);
  const [budget, setBudget] = useState<AdminBudgetGlance | null>(null);
  const [failedRows, setFailedRows] = useState<SubmissionResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);

    Promise.allSettled([
      endpoints.adminStats(),
      endpoints.adminActivity(),
      endpoints.adminAiBudget(),
      endpoints.failedSubmissions(FAILED_LIST),
    ])
      .then(([s, a, b, f]) => {
        if (!alive) return;
        if (s.status === "rejected") {
          setFailed(true);
          return;
        }
        const v = s.value;
        setStats({
          teachers: v.teachers,
          students: v.students,
          questions: v.questions,
          publishedQuestions: v.published_questions,
          submissions: v.submissions,
          evaluatedSubmissions: v.evaluated_submissions,
          // Read through a fallback although the contract has them: an API image built
          // before the split still answers every other counter.
          pendingSubmissions: v.pending_submissions ?? null,
          failedSubmissions: v.failed_submissions ?? null,
        });
        setActivity(
          a.status === "fulfilled"
            ? a.value.days.map((d) => ({
                date: d.date,
                submissions: d.submissions,
                graded: d.graded,
                failed: d.failed,
                activeStudents: d.active_students,
                newStudents: d.new_students,
                aiCostUsd: d.ai_cost_usd,
              }))
            : null,
        );
        setBudget(
          b.status === "fulfilled"
            ? {
                spentTodayUsd: b.value.spent_today_usd,
                dailyCapUsd: b.value.daily_cap_usd,
                state: b.value.state,
              }
            : null,
        );
        setFailedRows(f.status === "fulfilled" ? f.value : []);
      })
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const failedItems = useMemo<AdminFailedItem[]>(
    () =>
      failedRows.map((r) => ({
        id: r.id,
        studentName: r.student_name ?? "—",
        taskTitle: r.question_title ?? t("results.attempt"),
        reason: t(gradingFailureKey(r.error_message)),
        when: formatWhen(r.created_at),
        canRegrade: r.audio_url !== null,
      })),
    [failedRows, t],
  );

  const regrade = useCallback(async (id: string) => {
    await requestRegrade(t, id);
  }, [t]);

  if (loading) return <PageLoading />;
  if (failed || !stats) return <PageError onRetry={() => setReloadKey((k) => k + 1)} />;

  return (
    <AdminDashboardScreen
      stats={stats}
      activity={activity}
      budget={budget}
      failedItems={failedItems}
      onRegrade={regrade}
      onOpenAiSettings={() => navigate(ADMIN_NAV_PATH.settings)}
      onOpenAudit={() => navigate(ADMIN_NAV_PATH.audit)}
      activeNavKey="home"
      onNavigate={onNavigate}
    />
  );
}

/** dd.MM.yyyy HH:mm, 24h — the panel's one date style. */
function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
