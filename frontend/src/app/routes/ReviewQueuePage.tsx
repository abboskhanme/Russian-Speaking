/**
 * ReviewQueuePage (`/teacher/queue`) — B1 «Tekshirish navbati» (plan Phase 4).
 * The Navbat FAB's destination.
 *
 *   • `GET /api/submissions?needs_review=true` → the queue (AI-graded, not yet
 *     teacher-signed-off), teacher-scoped server-side
 *   • `PATCH /api/submissions/{id}/review`    → "✓ Tasdiqlash", accepting the AI's
 *     score with a note that says so
 *
 * Confirming sends a COMMENT rather than a band: leaving `teacher_band` unset is
 * what records "I accept the AI's number", where echoing the AI's score back as a
 * manual one would make every auto-approval indistinguishable from a hand-graded
 * verdict in the data.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ReviewQueueScreen } from "../../screens/teacher";
import type { QueueFilter, QueueItem } from "../../screens/teacher";
import { endpoints } from "../../shared/api";
import type { SubmissionResponse } from "../../shared/api";
import { relativeTime } from "../adapters";
import { PageError, PageLoading } from "../PageState";
import { useTeacherNavHandler } from "../nav";

export default function ReviewQueuePage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const onNavigate = useTeacherNavHandler();
  const [params, setParams] = useSearchParams();

  const filter: QueueFilter = params.get("filter") === "low" ? "low" : "all";

  const [subs, setSubs] = useState<SubmissionResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);

    endpoints
      .teacherReviewQueue(100)
      .then((rows) => alive && setSubs(rows))
      .catch(() => alive && setFailed(true))
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const items = useMemo<QueueItem[]>(
    () =>
      subs.map((s) => {
        const rel = relativeTime(s.created_at);
        return {
          id: s.id,
          studentName: s.student_name ?? "—",
          task: s.question_title ?? "—",
          level: s.question_level ?? undefined,
          score: s.overall_band ?? undefined,
          when: t(rel.key, { count: rel.count }),
          hasAudio: s.audio_url !== null,
        };
      }),
    [subs, t],
  );

  const confirm = useCallback(
    async (id: string) => {
      // Comment-only: the AI's band stands, and the note records who accepted it.
      await endpoints.reviewSubmission(id, { comment: t("teacher.confirmedNote") });
      setSubs((prev) => prev.filter((s) => s.id !== id));
    },
    [t],
  );

  const setFilter = useCallback(
    (f: QueueFilter) => {
      const next = new URLSearchParams(params);
      if (f === "all") next.delete("filter");
      else next.set("filter", f);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  if (loading) return <PageLoading />;
  if (failed) return <PageError onRetry={() => setReloadKey((k) => k + 1)} />;

  return (
    <ReviewQueueScreen
      items={items}
      filter={filter}
      onFilterChange={setFilter}
      activeNavKey="queue"
      onNavigate={onNavigate}
      onOpen={(id) => navigate(`/teacher/queue/${encodeURIComponent(id)}`)}
      onConfirm={confirm}
    />
  );
}
