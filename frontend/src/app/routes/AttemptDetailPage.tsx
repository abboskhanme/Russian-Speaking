/**
 * AttemptDetailPage (`/results/:id`) — one attempt's full detail: audio +
 * transcript + AI score breakdown + feedback. Loads `GET /api/submissions/:id/
 * detail`. A missing / not-owned attempt (404) → back to the results list.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AttemptDetailScreen } from "../../screens/results";
import type { AttemptDetail } from "../../screens/results";
import { endpoints } from "../../shared/api";
import { isApiError } from "../../shared/api/client";
import { parseCorrections, parseFeedback } from "../adapters";
import { PageError, PageLoading } from "../PageState";
import { useNavHandler } from "../nav";

export default function AttemptDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const onNavigate = useNavHandler();

  const [detail, setDetail] = useState<AttemptDetail | null>(null);
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

  if (loading) return <PageLoading />;
  if (error || !detail) return <PageError onRetry={retry} />;

  return (
    <AttemptDetailScreen
      detail={detail}
      onBack={() => navigate("/results")}
      activeNavKey="profile"
      onNavigate={onNavigate}
    />
  );
}
