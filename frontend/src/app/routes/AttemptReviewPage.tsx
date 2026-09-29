/**
 * AttemptReviewPage (`/teacher/queue/:attemptId`) — B2 «Javob detali» + B3
 * «Qo'lda baholash» (plan Phase 4).
 *
 *   • `GET /api/submissions/{id}/detail`      → audio, transcript + per-word
 *     accuracy, AI scores, corrections/feedback, any existing teacher verdict
 *   • `PATCH /api/submissions/{id}/review`    → the verdict
 *
 * The detail route 404s for an attempt outside this teacher's roster/questions,
 * so an unreachable id renders the error state rather than anything partial.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AttemptReviewScreen } from "../../screens/teacher";
import type { ReviewCriterion, ReviewWord } from "../../screens/teacher";
import { endpoints } from "../../shared/api";
import type { AttemptDetailResponse } from "../../shared/api";
import { parseCorrections, parseFeedback } from "../adapters";
import { PageError, PageLoading } from "../PageState";
import { TEACHER_NAV_PATH, useTeacherNavHandler } from "../nav";

export default function AttemptReviewPage() {
  const { attemptId = "" } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const onNavigate = useTeacherNavHandler();

  const [detail, setDetail] = useState<AttemptDetailResponse | null>(null);
  const [queued, setQueued] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);

    Promise.allSettled([
      endpoints.attemptDetail(attemptId),
      endpoints.teacherReviewCount(),
    ])
      .then(([d, q]) => {
        if (!alive) return;
        if (d.status !== "fulfilled") {
          setFailed(true);
          return;
        }
        setDetail(d.value);
        setQueued(q.status === "fulfilled" ? q.value.count : 0);
      })
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, [attemptId, reloadKey]);

  const words = useMemo<ReviewWord[]>(
    () =>
      (detail?.words ?? []).map((w) => ({
        word: w.word,
        accuracy: w.accuracy ?? undefined,
      })),
    [detail],
  );

  const criteria = useMemo<ReviewCriterion[]>(() => {
    if (!detail) return [];
    // Only the sub-skills that were actually scored — a 0 bar would read as
    // "scored zero" where the truth is "not measured".
    return (
      [
        ["fluency", "teacher.skillFluency", detail.fluency_score],
        ["grammar", "teacher.skillGrammar", detail.grammar_score],
        ["pronunciation", "teacher.skillPronunciation", detail.pronunciation_score],
        ["lexical", "teacher.skillLexical", detail.lexical_score],
      ] as const
    )
      .filter(([, , v]) => v != null)
      .map(([key, labelKey, v]) => ({ key, label: t(labelKey), score: v as number }));
  }, [detail, t]);

  // The columns hold JSON, not prose — parse before rendering, or the teacher
  // reads a raw blob (which is what the student's own screen was doing too).
  const corrections = useMemo(() => parseCorrections(detail?.corrections), [detail]);
  const feedback = useMemo(() => parseFeedback(detail?.feedback), [detail]);

  const taskLine = useMemo(
    () => [detail?.question_title, detail?.question_level].filter(Boolean).join(" · "),
    [detail],
  );

  const save = useCallback(
    async (args: { band?: number; comment?: string }) => {
      await endpoints.reviewSubmission(attemptId, args);
      // Refetch so the screen shows the stored verdict, not the local guess.
      setReloadKey((k) => k + 1);
    },
    [attemptId],
  );

  const confirm = useCallback(async () => {
    // `confirm: true` — the AI's band stands and NO comment is written. The old
    // call stored "AI bahosi tasdiqlandi" as the teacher's comment, which the
    // student then read as feedback from their teacher.
    await endpoints.reviewSubmission(attemptId, { confirm: true });
    navigate(TEACHER_NAV_PATH.queue);
  }, [attemptId, navigate]);

  if (loading) return <PageLoading />;
  if (failed || !detail) return <PageError onRetry={() => setReloadKey((k) => k + 1)} />;

  return (
    <AttemptReviewScreen
      studentName={detail.student_name ?? "—"}
      taskLine={taskLine}
      score={detail.overall_band ?? undefined}
      audioUrl={detail.audio_url}
      audioExpiredLabel={detail.audio_expired ? t("teacher.audioExpired") : undefined}
      transcript={detail.transcript}
      words={words}
      criteria={criteria}
      corrections={corrections}
      feedback={feedback}
      teacherBand={detail.teacher_band}
      teacherComment={detail.teacher_comment}
      reviewed={detail.reviewed_at !== null}
      activeNavKey="queue"
      onNavigate={onNavigate}
      queuedCount={queued}
      onBack={() => navigate(TEACHER_NAV_PATH.queue)}
      onSave={save}
      onConfirm={confirm}
    />
  );
}
