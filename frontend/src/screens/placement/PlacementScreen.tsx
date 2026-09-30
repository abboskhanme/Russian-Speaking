/**
 * PlacementScreen — the CEFR level check ("dastlabki sinov"). ONE screen, TWO modes (owner mockup
 * frames A2 · A3):
 *
 *   mode="auth"  (`/placement`)  — the logged-in student's optional level test. Reuses the authed
 *                `/api/placement/*` endpoints, remembers completion in localStorage (govori_placed),
 *                and routes into the app (Home) when done or skipped. No longer forced post-register.
 *   mode="guest" (`/try`)        — the AUTH-LESS "try before you register" flow reached from a link on
 *                the login/register screens. Reuses the SAME UI but calls `/api/guest/placement/*`
 *                (no token), sets NO placed flag (it's a trial), and at the result nudges the visitor
 *                to sign up (primary "Ro'yxatdan o'tish →" + a subtle "Kirish").
 *
 * Three steps, all full-screen (no app nav): intro → record 3 → result. Reuses Recorder / Mascot /
 * Card / Button / Text / LevelRing + tokens + i18n. Grading is STUBBED server-side (deterministic
 * band) until real AI keys land, so the level is approximate.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button, Card, Mascot, Recorder, Spinner, Text } from "../../shared/ui";
import { ThemeToggle } from "../../widgets";
import { endpoints, isApiError } from "../../shared/api";
import type { PlacementQuestionResponse, PlacementResultResponse } from "../../shared/api";
import { useAuth } from "../../shared/auth";
import { PageError } from "../../app/PageState";
import { LevelRing } from "./LevelRing";
import { hasPlaced, markPlaced } from "./placed";
import styles from "./PlacementScreen.module.css";

type Phase = "intro" | "recording" | "result";

export type PlacementMode = "auth" | "guest";

export interface PlacementScreenProps {
  /** "auth" (logged-in `/placement`) or "guest" (auth-less `/try`). Default "auth". */
  mode?: PlacementMode;
}

/** ~90s per answer (mockup "~90s") — the Recorder auto-stops at the cap. */
const MAX_ANSWER_MS = 90_000;

export default function PlacementScreen({ mode = "auth" }: PlacementScreenProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { clearJustRegistered } = useAuth();
  const isGuest = mode === "guest";

  // The auth vs guest placement endpoints — identical shapes, different auth (guest sends no token).
  const api = useMemo(
    () =>
      isGuest
        ? {
            questions: endpoints.guestPlacementQuestions,
            submit: endpoints.guestPlacementSubmit,
            complete: endpoints.guestPlacementComplete,
          }
        : {
            questions: endpoints.placementQuestions,
            submit: endpoints.placementSubmit,
            complete: endpoints.placementComplete,
          },
    [isGuest],
  );

  const [questions, setQuestions] = useState<PlacementQuestionResponse[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [phase, setPhase] = useState<Phase>("intro");
  const [current, setCurrent] = useState(0);
  const [bands, setBands] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);
  /** The last failure was "cannot be scored right now" — offer leaving the test for later. */
  const [canDefer, setCanDefer] = useState(false);
  const [recorderKey, setRecorderKey] = useState(0);
  const [result, setResult] = useState<PlacementResultResponse | null>(null);

  // Auth mode only: an already-placed user is bounced straight to Home (guests always get the trial).
  const placed = useRef(isGuest ? false : hasPlaced());
  useEffect(() => {
    if (placed.current) navigate("/", { replace: true });
  }, [navigate]);

  // Fetch the 3 fixed questions (auth route → token present; guest route → no token).
  useEffect(() => {
    if (placed.current) return;
    let alive = true;
    setLoadError(false);
    setQuestions(null);
    api
      .questions()
      .then((qs) => alive && setQuestions(qs))
      .catch(() => alive && setLoadError(true));
    return () => {
      alive = false;
    };
  }, [api, reloadKey]);

  /** Finish an AUTH placement: remember it, drop the "just registered" signal, enter the app. */
  const finishAuth = useCallback(() => {
    markPlaced();
    clearJustRegistered();
    navigate("/", { replace: true });
  }, [clearJustRegistered, navigate]);

  /** Guest bail-out (intro skip): go straight to sign-up (the trial's whole point). */
  const goRegister = useCallback(() => navigate("/register"), [navigate]);

  const total = questions?.length ?? 0;

  const handleAnswer = useCallback(
    async (audio: Blob) => {
      if (!questions) return;
      const index = questions[current].index;
      setSubmitting(true);
      setAnswerError(null);
      setCanDefer(false);
      try {
        const res = await api.submit({ index, audio });
        const nextBands = [...bands, res.band];
        setBands(nextBands);
        if (current + 1 < questions.length) {
          setCurrent((c) => c + 1);
          setRecorderKey((k) => k + 1); // fresh Recorder for the next question
          setSubmitting(false);
        } else {
          const done = await api.complete(nextBands);
          setResult(done);
          setPhase("result");
          setSubmitting(false);
        }
      } catch (e) {
        // 503 = the answer could not be SCORED right now (no AI key, or a vendor failed). The
        // server used to answer that with a band made of the recording's byte length, shown here
        // as the student's level; now it refuses, and the screen offers a retry or leaving the
        // test for later — never a number it does not have.
        const unavailable = isApiError(e) && e.status === 503;
        setAnswerError(t(unavailable ? "placement.unavailable" : "placement.submitError"));
        setCanDefer(unavailable);
        setRecorderKey((k) => k + 1); // remount the Recorder so they can retry
        setSubmitting(false);
      }
    },
    [api, bands, current, questions, t],
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
          kicker={isGuest ? t("placement.guest.kicker") : t("placement.kicker")}
          body={isGuest ? t("placement.guest.introBody") : t("placement.introBody")}
          skipLabel={isGuest ? t("placement.guest.introSkip") : t("placement.skipCta")}
          onStart={() => setPhase("recording")}
          onSkip={isGuest ? goRegister : finishAuth}
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
          {answerError && canDefer && (
            <Button variant="ghost" fullWidth onClick={isGuest ? goRegister : finishAuth}>
              {isGuest ? t("placement.guest.introSkip") : t("placement.skipCta")}
            </Button>
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

      {phase === "result" &&
        result &&
        (isGuest ? (
          <GuestResultStep
            result={result}
            onRegister={goRegister}
            onLogin={() => navigate("/login")}
          />
        ) : (
          <ResultStep result={result} onStart={finishAuth} />
        ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Intro                                                                      */
/* -------------------------------------------------------------------------- */

interface IntroStepProps {
  firstPrompt: string;
  total: number;
  kicker: string;
  body: string;
  skipLabel: string;
  onStart: () => void;
  onSkip: () => void;
}

function IntroStep({ firstPrompt, total, kicker, body, skipLabel, onStart, onSkip }: IntroStepProps) {
  const { t } = useTranslation();
  return (
    <div className={styles.intro}>
      <Text as="p" variant="label" color="primary" className={styles.kicker}>
        {kicker}
      </Text>
      <Mascot mood="listening" size={120} label="Govo" className={styles.introMascot} />
      <Text as="h1" variant="title-l" weight="black" align="center">
        {t("placement.introTitle")}
      </Text>
      <Text as="p" variant="body" color="ink-soft" align="center" className={styles.introBody}>
        {body}
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
          {skipLabel}
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Result — authed (into the app)                                             */
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

/* -------------------------------------------------------------------------- */
/* Result — guest (nudge to register)                                         */
/* -------------------------------------------------------------------------- */

function GuestResultStep({
  result,
  onRegister,
  onLogin,
}: {
  result: PlacementResultResponse;
  onRegister: () => void;
  onLogin: () => void;
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
        {t("placement.guest.resultTitle")}
      </Text>
      <Text as="p" variant="body" color="ink-soft" align="center" className={styles.resultBody}>
        {t("placement.guest.resultBody")}
      </Text>
      <Button variant="primary" size="lg" fullWidth onClick={onRegister} className={styles.resultCta}>
        {t("placement.guest.registerCta")}
      </Button>
      <Button variant="ghost" fullWidth onClick={onLogin}>
        {t("placement.guest.loginCta")}
      </Button>
    </div>
  );
}
