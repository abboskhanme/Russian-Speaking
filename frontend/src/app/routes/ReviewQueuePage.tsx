/**
 * ReviewQueuePage (`/teacher/queue`) — B1 «Tekshirish navbati» (plan Phase 4).
 * The Navbat FAB's destination.
 *
 *   • `GET /api/submissions?needs_review=true` → the queue (AI-graded, not yet
 *     teacher-signed-off), teacher-scoped server-side
 *   • `PATCH /api/submissions/{id}/review`    → "✓ Tasdiqlash", accepting the AI's
 *     score as it stands
 *
 * Confirming sends `{ confirm: true }` — no band and no comment. Leaving
 * `teacher_band` unset is what records "I accept the AI's number" (echoing the
 * AI's score back as a manual one would make every confirmation indistinguishable
 * from a hand-graded verdict), and `reviewed_at` records the confirmation itself.
 * It used to send a canned "AI bahosi tasdiqlandi" note as the teacher comment,
 * which the STUDENT then saw as feedback their teacher had written.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ReviewQueueScreen } from "../../screens/teacher";
import type { QueueFilter, QueueItem } from "../../screens/teacher";
import { endpoints } from "../../shared/api";
import type { SubmissionResponse } from "../../shared/api";
import { useDateFormat } from "../../shared/format";
import { PageError, PageLoading } from "../PageState";
import { useTeacherNavHandler } from "../nav";

/** One page of the queue. The API caps a page at 200; 100 keeps the first paint light. */
const PAGE = 100;

export default function ReviewQueuePage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const fmt = useDateFormat();
  const onNavigate = useTeacherNavHandler();
  const [params, setParams] = useSearchParams();

  const filter: QueueFilter = params.get("filter") === "low" ? "low" : "all";

  const [subs, setSubs] = useState<SubmissionResponse[]>([]);
  /** The queue's true size — `subs` is only the pages fetched so far. Null when the
   * count read failed; the screen then falls back to the list's own length. */
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);

    Promise.allSettled([endpoints.teacherReviewQueue(PAGE), endpoints.teacherReviewCount()])
      .then(([rows, count]) => {
        if (!alive) return;
        if (rows.status !== "fulfilled") {
          setFailed(true);
          return;
        }
        setSubs(rows.value);
        setTotal(count.status === "fulfilled" ? count.value.count : null);
      })
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, [reloadKey]);

  // Newest first, so the next page starts where this one ended. A row confirmed in
  // the meantime has left the server's queue too, which shifts the window by one —
  // de-duplicating by id keeps that from ever showing a card twice.
  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const next = await endpoints.teacherReviewQueue(PAGE, subs.length);
      setSubs((prev) => {
        const seen = new Set(prev.map((s) => s.id));
        return [...prev, ...next.filter((s) => !seen.has(s.id))];
      });
    } finally {
      setLoadingMore(false);
    }
  }, [subs.length]);

  const items = useMemo<QueueItem[]>(
    () =>
      subs.map((s) => {
        return {
          id: s.id,
          studentName: s.student_name ?? "—",
          task: s.question_title ?? "—",
          level: s.question_level ?? undefined,
          score: s.overall_band ?? undefined,
          when: fmt.relative(s.created_at),
          audioUrl: s.audio_url,
        };
      }),
    [subs, t, fmt],
  );

  const confirm = useCallback(async (id: string) => {
    // The AI's band stands; no comment is invented on the teacher's behalf.
    await endpoints.reviewSubmission(id, { confirm: true });
    setSubs((prev) => prev.filter((s) => s.id !== id));
    setTotal((n) => (n == null ? n : Math.max(0, n - 1)));
  }, []);

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
      total={total ?? undefined}
      onLoadMore={loadMore}
      loadingMore={loadingMore}
    />
  );
}
