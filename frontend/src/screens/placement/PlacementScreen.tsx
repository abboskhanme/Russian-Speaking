/**
 * PlacementScreen (`/placement`) — the one-time "dastlabki sinov" a brand-new student takes right
 * after registering (owner mockup frames A2 · A3). Three steps, all full-screen (no app nav):
 *
 *   intro     — "DASTLABKI SINOV · BIR MARTALIK", Govo, "Darajangizni aniqlaymiz", a 1-SAVOL preview
 *               card, "Sinovni boshlash →", and a "Keyinroq — hozircha kirish" skip link.
 *   recording — for each of the 3 questions: "N / 3-savol" progress, the Russian question card, and
 *               the shared <Recorder/> (Govo listens, timer, "Yozilyapti", record/stop). On accept we
 *               POST the take → collect the band → advance; a grading beat shows Govo thinking.
 *   result    — "JOYLASHTIRUV TUGADI", proud Govo, the CEFR level ring (e.g. A2 · boshlang'ich),
 *               "Yaxshi boshladik!", and "Boshlash" → into the app.
 *
 * Reuses Recorder / Mascot / Card / Button / Text + tokens + i18n. Grading is STUBBED server-side
 * (deterministic band) until real AI keys land, so the level is approximate. Both the skip link and
 * the final button mark placement done (localStorage) and route to Home; an already-placed user is
 * bounced straight to Home on mount.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button, Card, Mascot, Recorder, Spinner, Text } from "../../shared/ui";
import { ThemeToggle } from "../../widgets";
import { endpoints } from "../../shared/api";
import type { PlacementQuestionResponse, PlacementResultResponse } from "../../shared/api";
import { useAuth } from "../../shared/auth";
import { PageError } from "../../app/PageState";
import { LevelRing } from "./LevelRing";
import { hasPlaced, markPlaced } from "./placed";
import styles from "./PlacementScreen.module.css";

type Phase = "intro" | "recording" | "result";

/** ~90s per answer (mockup "~90s") — the Recorder auto-stops at the cap. */
const MAX_ANSWER_MS = 90_000;

export default function PlacementScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { clearJustRegistered } = useAuth();

  const [questions, setQuestions] = useState<PlacementQuestionResponse[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [phase, setPhase] = useState<Phase>("intro");
  const [current, setCurrent] = useState(0);
  const [bands, setBands] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [recorderKey, setRecorderKey] = useState(0);
  const [result, setResult] = useState<PlacementResultResponse | null>(null);

  // Already placed on this device → never re-prompt; go straight to Home.
  const placed = useRef(hasPlaced());
  useEffect(() => {
    if (placed.current) navigate("/", { replace: true });
  }, [navigate]);

  // Fetch the 3 fixed questions (auth-guarded route → token is present).
  useEffect(() => {
    if (placed.current) return;
    let alive = true;
    setLoadError(false);
    setQuestions(null);
    endpoints
      .placementQuestions()
      .then((qs) => alive && setQuestions(qs))
      .catch(() => alive && setLoadError(true));
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  /** Finish placement: remember it, drop the "just registered" signal, enter the app. */
  const finish = useCallback(() => {
    markPlaced();
    clearJustRegistered();
    navigate("/", { replace: true });
  }, [clearJustRegistered, navigate]);

  const total = questions?.length ?? 0;

  const handleAnswer = useCallback(
    async (audio: Blob) => {
      if (!questions) return;
      const index = questions[current].index;
      setSubmitting(true);
      setAnswerError(null);
      try {
        const res = await endpoints.placementSubmit({ index, audio });
        const nextBands = [...bands, res.band];
        setBands(nextBands);
        if (current + 1 < questions.length) {
          setCurrent((c) => c + 1);
          setRecorderKey((k) => k + 1); // fresh Recorder for the next question
          setSubmitting(false);
        } else {
          const done = await endpoints.placementComplete(nextBands);
          setResult(done);
          setPhase("result");
          setSubmitting(false);
        }
      } catch {
        setAnswerError(t("placement.submitError"));
        setRecorderKey((k) => k + 1); // remount the Recorder so they can retry
        setSubmitting(false);
      }
    },
    [bands, current, questions, t],
  );

  if (loadError) return <PageError onRetry={() => setReloadKey((k) => k + 1)} />;
  if (placed.current || questions === null) {
    return (
      <div className={styles.page}>
        <div className={styles.center}>
          <Spinner size="lg" label={t("common.loading")} />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <ThemeToggle className={styles.themeToggle} />

      {phase === "intro" && (
        <IntroStep
          firstPrompt={questions[0]?.prompt_ru ?? ""}
          total={total}
          onStart={() => setPhase("recording")}
          onSkip={finish}
        />
      )}

      {phase === "recording" && (
        <div className={styles.step}>
          <div className={styles.progressRow}>
            <Text as="span" variant="body-s" color="muted" weight="bold" numeric>
              {t("placement.questionProgress", { current: current + 1, total })}
            </Text>
            <Text as="span" variant="body-s" color="muted" weight="bold" numeric>
              {t("placement.answerHint")}
            </Text>
          </div>
          <div className={styles.progressTrack} aria-hidden>
            <div
              className={styles.progressFill}
              style={{ width: `${((current + (submitting ? 1 : 0)) / total) * 100}%` }}
            />
          </div>

          <Card variant="flat" padding="lg" className={styles.questionCard}>
            <Text as="p" variant="label" color="muted">
              {t("placement.questionKicker")}
            </Text>
            <Text as="p" variant="mono" className={styles.questionText}>
              {questions[current].prompt_ru}
            </Text>
          </Card>

          {answerError && (
            <div className={styles.error} role="alert">
              {answerError}
            </div>
          )}

          <div className={styles.stage} aria-live="polite">
            {submitting ? (
              <div className={styles.grading} role="status">
                <Mascot mood="thinking" size={150} label={t("placement.gradingMascotLabel")} />
                <Text variant="title-s" align="center">
                  {t("placement.grading")}
                </Text>
              </div>
            ) : (
              <Recorder
                key={`${current}-${recorderKey}`}
                onComplete={handleAnswer}
                maxDurationMs={MAX_ANSWER_MS}
              />
            )}
          </div>
        </div>
      )}

      {phase === "result" && result && (
        <ResultStep result={result} onStart={finish} />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Intro                                                                      */
/* -------------------------------------------------------------------------- */

interface IntroStepProps {
  firstPrompt: string;
  total: number;
  onStart: () => void;
  onSkip: () => void;
}

function IntroStep({ firstPrompt, total, onStart, onSkip }: IntroStepProps) {
  const { t } = useTranslation();
  return (
    <div className={styles.intro}>
      <Text as="p" variant="label" color="primary" className={styles.kicker}>
        {t("placement.kicker")}
      </Text>
      <Mascot mood="listening" size={120} label="Govo" className={styles.introMascot} />
      <Text as="h1" variant="title-l" weight="black" align="center">
        {t("placement.introTitle")}
      </Text>
      <Text as="p" variant="body" color="ink-soft" align="center" className={styles.introBody}>
        {t("placement.introBody")}
      </Text>

      <Card variant="flat" padding="lg" className={styles.previewCard}>
        <Text as="p" variant="label" color="muted">
          {t("placement.firstQuestion")}
        </Text>
        <Text as="p" variant="mono" className={styles.questionText}>
          {firstPrompt}
        </Text>
      </Card>

      <div className={styles.dots} aria-hidden>
        {Array.from({ length: Math.max(total, 1) }, (_, i) => (
          <span key={i} className={i === 0 ? styles.dotActive : styles.dot} />
        ))}
      </div>

      <div className={styles.introActions}>
        <Button variant="primary" size="lg" fullWidth onClick={onStart}>
          {t("placement.startCta")}
        </Button>
        <Button variant="ghost" fullWidth onClick={onSkip}>
          {t("placement.skipCta")}
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Result                                                                     */
/* -------------------------------------------------------------------------- */

function ResultStep({
  result,
  onStart,
}: {
  result: PlacementResultResponse;
  onStart: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.result}>
      <Text as="p" variant="label" color="muted">
        {t("placement.resultKicker")}
      </Text>
      <Mascot mood="proud" size={92} label="Govo" className={styles.resultMascot} />
      <LevelRing level={result.level} label={result.label_uz} band={result.band} />
      <Text as="h1" variant="title-l" weight="black" align="center" className={styles.resultTitle}>
        {t("placement.resultTitle")}
      </Text>
      <Text as="p" variant="body" color="ink-soft" align="center" className={styles.resultBody}>
        {t("placement.resultBody")}
      </Text>
      <Button variant="primary" size="lg" fullWidth onClick={onStart} className={styles.resultCta}>
        {t("placement.enterApp")}
      </Button>
    </div>
  );
}
