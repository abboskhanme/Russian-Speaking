/**
 * AdminDashboardPage (`/admin`) — Boshqaruv.
 *
 *   • `GET /api/admin/stats` → the six counters
 *
 * One fetch, and it is load-bearing: with no stats there is no dashboard, so a
 * failure is a real error state rather than a page of dashes.
 */
import { useEffect, useState } from "react";
import { AdminDashboardScreen } from "../../screens/admin";
import type { AdminStats } from "../../screens/admin";
import { endpoints } from "../../shared/api";
import { PageError, PageLoading } from "../PageState";
import { useAdminNavHandler } from "../nav";

export default function AdminDashboardPage() {
  const onNavigate = useAdminNavHandler();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);

    endpoints
      .adminStats()
      .then((s) => {
        if (!alive) return;
        setStats({
          teachers: s.teachers,
          students: s.students,
          questions: s.questions,
          publishedQuestions: s.published_questions,
          submissions: s.submissions,
          evaluatedSubmissions: s.evaluated_submissions,
          // Read through a fallback although the contract has them: an API image built
          // before the split still answers every other counter, and the screen then
          // falls back to its old, coarser sentence instead of claiming zero failures.
          pendingSubmissions: s.pending_submissions ?? null,
          failedSubmissions: s.failed_submissions ?? null,
        });
      })
      .catch(() => alive && setFailed(true))
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, [reloadKey]);

  if (loading) return <PageLoading />;
  if (failed || !stats) return <PageError onRetry={() => setReloadKey((k) => k + 1)} />;

  return <AdminDashboardScreen stats={stats} activeNavKey="home" onNavigate={onNavigate} />;
}
