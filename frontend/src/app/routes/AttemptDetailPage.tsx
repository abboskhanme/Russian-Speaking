/**
 * AttemptDetailPage (`/results/:id`) — one attempt's full detail: audio +
 * transcript + AI score breakdown + feedback. Loads `GET /api/submissions/:id/
 * detail`. A missing / not-owned attempt (404) → back to the results list.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { AttemptDetailScreen } from "../../screens/results";
import type { AttemptDetail } from "../../screens/results";
import { endpoints } from "../../shared/api";
import { isApiError } from "../../shared/api/client";
import { gradingFailureKey, parseCorrections, parseFeedback } from "../adapters";
import { canRegrade, requestRegrade } from "../regrade";

/** While a regrade runs, how often to look at the attempt, and for how long. */
const POLL_MS = 3000;
const POLL_FOR_MS = 3 * 60 * 1000;
import { PageError, PageLoading } from "../PageState";
import { useNavHandler } from "../nav";

export default function AttemptDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const onNavigate = useNavHandler();

  const { t } = useTranslation();
  const [detail, setDetail] = useState<AttemptDetail | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!id) {
      navigate("/results", { replace: true });
      return;
    }
    let alive = true;
    setLoading(true);
    setError(false);

    endpoints
      .attemptDetail(id)
      .then((d) => {
        if (!alive) return;
        setErrorCode(d.error_message ?? null);
        // Opened while grading runs (e.g. right after a retry) — keep watching.
        if (d.status === "pending" || d.status === "processing") setPolling(true);
        setDetail({
          id: d.id,
          status: d.status,
          createdAt: d.created_at,
          questionTitle: d.question_title,
          questionLevel: d.question_level,
          questionTopic: d.question_topic,
          audioUrl: d.audio_url,
          audioDurationSec: d.audio_duration_sec,
          audioExpired: d.audio_expired,
          transcript: d.transcript,
          band: d.band,
          fluency: d.fluency_score,
          lexical: d.lexical_score,
          grammar: d.grammar_score,
          pronunciation: d.pronunciation_score,
          relevance: d.relevance_score,
          // JSON columns — parse, never render raw.
          feedback: parseFeedback(d.feedback),
          corrections: parseCorrections(d.corrections),
          modelAnswer: d.model_answer_text,
          teacherBand: d.teacher_band,
          teacherComment: d.teacher_comment,
          reviewedAt: d.reviewed_at,
        });
      })
      .catch((e) => {
        if (!alive) return;
        // A missing / not-visible attempt → bounce back to the list, not a dead end.
        if (isApiError(e) && e.status === 404) navigate("/results", { replace: true });
        else setError(true);
      })
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, [id, reloadKey, navigate]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  // After a retry the attempt is "grading…" again; look at it every few seconds
  // and reload the detail once it has an outcome (graded, or failed again).
  useEffect(() => {
    if (!polling || !id) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - started > POLL_FOR_MS) {
        setPolling(false);
        return;
      }
      endpoints
        .getSubmission(id)
        .then((s) => {
          if (s.status === "done" || s.status === "failed") {
            setPolling(false);
            setReloadKey((k) => k + 1);
          }
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [polling, id]);

  const regrade = useCallback(async () => {
    if (!id) return;
    const next = await requestRegrade(t, id);
    setErrorCode(null);
    setDetail((d) => (d ? { ...d, status: next.status } : d));
    setPolling(true);
  }, [id, t]);

  if (loading) return <PageLoading />;
  if (error || !detail) return <PageError onRetry={retry} />;

  return (
    <AttemptDetailScreen
      detail={detail}
      onBack={() => navigate("/results")}
      activeNavKey="profile"
      onNavigate={onNavigate}
      failedReason={detail.status === "failed" ? t(gradingFailureKey(errorCode)) : undefined}
      onRegrade={canRegrade(detail.status, detail.audioExpired) ? regrade : undefined}
    />
  );
}
