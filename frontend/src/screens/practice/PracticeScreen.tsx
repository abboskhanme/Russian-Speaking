import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Card,
  Mascot,
  Recorder,
  Spinner,
  Text,
  cx,
} from "../../shared/ui";
import type { MascotMood, TextColor } from "../../shared/ui";
import { mockFeedback, mockProgress, mockTask } from "./practice.mock";
import styles from "./PracticeScreen.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The core practice loop, as a single product-level phase (docs/04 §4.2, §4.6):
 *   idle       — awaiting the answer (the Recorder is the surface)
 *   recording  — the mic is capturing (Govo listens)
 *   reviewing  — the take was submitted and is being graded (Govo thinks)
 *   submitted  — the result is ready (Govo is proud) — mockup B6, the value moment
 *   pending    — grading outlived the wait. The answer is SAVED and its result will
 *                land in Natijalar; the screen says exactly that, never a dead end
 *   failed     — grading failed: the reason in words, plus a way to try again
 */
export type PracticePhase =
  | "idle"
  | "recording"
  | "reviewing"
  | "submitted"
  | "pending"
  | "failed";

/** Govo's mood is a pure function of the phase (the one wiring the task asks for). */
const MOOD_BY_PHASE: Record<PracticePhase, MascotMood> = {
  idle: "idle",
  recording: "listening",
  reviewing: "thinking",
  submitted: "proud",
  pending: "thinking",
  failed: "sleepy",
};

/** A task's picture or clip (mockup B2 "rasm / video"). */
export interface PracticeMedia {
  url: string;
  type: "image" | "video";
}

export interface PracticeTask {
  id: string;
  /**
   * The task's short name ("Do'konda"). Shown as a heading ABOVE the prompt when
   * the task has a prompt of its own; left out when the prompt IS the title (an
   * API that does not send `prompt_text` yet), so the name is never printed twice.
   */
  title?: string;
  /** The Russian phrase / question the student answers — the prominent line. */
  prompt: string;
  /** The instruction (shart) — shown in a tinted panel. */
  instruction?: string;
  /** A picture or clip the task is about. A video gets controls and never autoplays. */
  media?: PracticeMedia | null;
  /** CEFR level badge (e.g. "A2"). */
  band?: string;
  /** Register cue (e.g. "Oddiy" / "Jonli"). */
  style?: string;
  /** Human-readable duration hint (e.g. "~1 daqiqa"). */
  durationHint?: string;
  /** Offer a "listen to the model" button. */
  hasReferenceAudio?: boolean;
  /** Hard recording cap forwarded to the Recorder (default 120s). */
  maxDurationMs?: number;
  /** "Collect your thoughts" countdown before capture (skippable); 0/absent = none. */
  prepMs?: number;
  /**
   * Beyond the free part of an official module, for a student without premium.
   * The server would refuse the answer with a 402, so the screen says so BEFORE a
   * whole answer is recorded for nothing: no recorder is offered at all.
   */
  premiumLocked?: boolean;
}

export interface PracticeProgress {
  /** 1-based index of the current task. */
  current: number;
  /** Total tasks in this session/module. */
  total: number;
}

export interface PracticeCorrection {
  id: string;
  /** What the student said. */
  before: string;
  /** The corrected form. */
  after: string;
  /** A short, kind explanation. */
  note?: string;
}

export interface PracticeCriterion {
  id: string;
  /** Ravonlik / Lug'at / Grammatika / Talaffuz … */
  label: string;
  /** 0..100. */
  score: number;
}

export interface PracticeFeedback {
  /** Level score 0..100 (count-up target). */
  score: number;
  /** Relative CEFR band shown to the student (e.g. "A2"). */
  band: string;
  /** One short, encouraging sentence (≤ 12 words). Empty when the grader gave none. */
  summary: string;
  /** The faithful transcript of what the student said. */
  transcript?: string;
  /** "Yaxshi bo'ldi" — what went well. */
  strengths?: string[];
  /** The (first N) corrections to show. */
  corrections?: PracticeCorrection[];
  /** Total corrections found (for the "N tadan M tasi" cue). */
  correctionTotal?: number;
  /** Per-criterion breakdown bars. */
  criteria?: PracticeCriterion[];
}

export interface PracticeScreenProps {
  task: PracticeTask;
  progress: PracticeProgress;
  /**
   * Controlled phase. Omit to let the screen manage its own state
   * (uncontrolled): it advances to `reviewing` on submit and to `submitted`
   * once `feedback` arrives.
   */
  phase?: PracticePhase;
  /** The graded result. Rendered once the phase reaches `submitted`. */
  feedback?: PracticeFeedback | null;
  /** Remaining free attempts (freemium). Hidden when undefined. */
  attemptsLeft?: number;
  /** Fired with the recorded take when the student accepts it. */
  onSubmit?: (audio: Blob) => void;
  /** Advance to the next task. */
  onNext?: () => void;
  /** Skip this task. Hidden when absent (e.g. no other open task to skip to). */
  onSkip?: () => void;
  /** Try this task again (from the result panel). */
  onRetry?: () => void;
  /** Play the reference / model answer. The button is hidden without it. */
  onPlayReference?: () => void;
  /** Play back the student's own recorded answer. The button is hidden without it. */
  onPlayAnswer?: () => void;
  /** "Batafsil" on the result — the full attempt detail (`/results/:id`). */
  onOpenDetail?: () => void;
  /** The pending state's way on: the Natijalar history, where the result will land. */
  onOpenResults?: () => void;
  /** The premium lock's "Premium haqida". */
  onOpenPremium?: () => void;
  /** Present only when the task was opened from the daily session — back to it. */
  onBackToDaily?: () => void;
  /** Why grading failed, already localized. Shown in the `failed` phase. */
  failureMessage?: string;
  /**
   * Where `reviewing` is: the take still uploading, or uploaded and being graded.
   * Drives the two-step progress in the grading panel. Default "grading".
   */
  submitStage?: "uploading" | "grading";
  /** The top bar's close (×) — leave the task flow. Hidden when absent. */
  onClose?: () => void;
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * PracticeScreen — the core practice loop, composed entirely from `shared/ui`
 * + `widgets` + tokens (docs/03, docs/04 §4.2–4.6). Presentational and
 * prop-driven: it fetches nothing and owns only the phase (when uncontrolled).
 *
 * Layout is full-width (docs/04 §4.10): AppShell frame → the task card (name,
 * media, the Russian prompt, the instruction — mockup B2) → a "stage" that swaps
 * Recorder / grading placeholder / result / pending / failure by phase →
 * progress → result actions. Govo's mood is derived from the phase via
 * `MOOD_BY_PHASE`, so the mascot and the recorder state stay in lockstep.
 */
export function PracticeScreen({
  task,
  progress,
  phase: phaseProp,
  feedback = null,
  attemptsLeft,
  onSubmit,
  onNext,
  onSkip,
  onRetry,
  onPlayReference,
  onPlayAnswer,
  onOpenDetail,
  onOpenResults,
  onOpenPremium,
  onBackToDaily,
  failureMessage,
  submitStage = "grading",
  onClose,
}: PracticeScreenProps) {
  const { t } = useTranslation();
  // The bottom action bar. A state-backed ref, so the Recorder re-renders and
  // portals its controls in as soon as the element exists.
  const [dockEl, setDockEl] = useState<HTMLElement | null>(null);
  const recorderLabels = useMemo(() => ({ accept: t("practice.focusSend") }), [t]);
  const controlled = phaseProp !== undefined;
  const [internalPhase, setInternalPhase] = useState<PracticePhase>("idle");
  const phase = controlled ? phaseProp : internalPhase;

  // Uncontrolled: a new task resets the loop back to the start.
  useEffect(() => {
    if (!controlled) setInternalPhase("idle");
  }, [task.id, controlled]);

  // Uncontrolled: once grading produces feedback, reveal the result.
  useEffect(() => {
    if (!controlled && internalPhase === "reviewing" && feedback) {
      setInternalPhase("submitted");
    }
  }, [controlled, internalPhase, feedback]);

  const setPhase = useCallback(
    (next: PracticePhase) => {
      if (!controlled) setInternalPhase(next);
    },
    [controlled],
  );

  const handleComplete = useCallback(
    (audio: Blob) => {
      setPhase("reviewing");
      onSubmit?.(audio);
    },
    [onSubmit, setPhase],
  );

  const handleRetry = useCallback(() => {
    setPhase("idle");
    onRetry?.();
  }, [onRetry, setPhase]);

  const handleNext = useCallback(() => {
    setPhase("idle");
    onNext?.();
  }, [onNext, setPhase]);

  const mood = MOOD_BY_PHASE[phase];
  const answering = phase === "idle" || phase === "recording";

  const skipButton = onSkip ? (
    <Button variant="ghost" onClick={onSkip}>
      {t("practice.skipCta")}
    </Button>
  ) : null;

  /* A focused, full-screen flow (like a lesson in Duolingo / Speak): no app nav,
   * no sidebar — a minimal top bar (close + progress) over a scrolling task, and
   * a bottom action bar that holds the ONE mic button and Skip, always on screen
   * (safe-area aware). The route renders this without AppShell on purpose. */
  return (
    <div className={styles.focus}>
      <header className={styles.topBar}>
        {onClose && (
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label={t("practice.focusClose")}
          >
            <CloseGlyph />
          </button>
        )}
        <Text as="h1" variant="title-m" className={styles.srOnly}>
          {t("nav.practice")}
        </Text>
        <ProgressBar current={progress.current} total={progress.total} />
        {attemptsLeft !== undefined && (
          <Badge variant={attemptsLeft > 0 ? "neutral" : "warn"}>
            {t("practice.attemptsLeft", { count: attemptsLeft })}
          </Badge>
        )}
      </header>

      <main className={styles.scroll}>
      <div className={styles.page}>
        <TaskCard task={task} onPlayReference={onPlayReference} />

        <section className={styles.stage} aria-live="polite">
          {task.premiumLocked ? (
            <LockedPanel onOpenPremium={onOpenPremium} />
          ) : (
            answering && (
              <Recorder
                key={task.id}
                onComplete={handleComplete}
                onCancel={() => setPhase("idle")}
                maxDurationMs={task.maxDurationMs}
                prepMs={task.prepMs}
                mascotSize={104}
                labels={recorderLabels}
                dockTarget={dockEl}
                dockAside={skipButton}
              />
            )
          )}

          {phase === "reviewing" && <GradingPanel mood={mood} stage={submitStage} />}

          {phase === "submitted" &&
            (feedback ? (
              <FeedbackPanel
                mood={mood}
                feedback={feedback}
                onRetry={handleRetry}
                onNext={handleNext}
                onOpenDetail={onOpenDetail}
                onBackToDaily={onBackToDaily}
                onPlayReference={onPlayReference}
                onPlayAnswer={onPlayAnswer}
              />
            ) : (
              <GradingPanel mood="thinking" />
            ))}

          {phase === "pending" && (
            <OutcomePanel
              mood={mood}
              title={t("practice.pending.title")}
              body={t("practice.pending.body")}
              actions={
                <>
                  {onOpenResults && (
                    <Button variant="secondary" onClick={onOpenResults}>
                      {t("practice.pending.cta")}
                    </Button>
                  )}
                  <NextActions onNext={handleNext} onBackToDaily={onBackToDaily} />
                </>
              }
            />
          )}

          {phase === "failed" && (
            <OutcomePanel
              mood={mood}
              title={t("practice.failed.title")}
              body={failureMessage ?? t("results.failure.internal")}
              hint={t("practice.failed.hint")}
              actions={
                <>
                  <Button variant="primary" onClick={handleRetry}>
                    {t("common.retry")}
                  </Button>
                  <NextActions onNext={handleNext} onBackToDaily={onBackToDaily} quiet />
                </>
              }
            />
          )}
        </section>
      </div>
      </main>

      {/* The bottom action bar. While answering, the Recorder portals its controls
          in here; a locked task only offers Skip. Empty = hidden (CSS :empty). */}
      <footer ref={setDockEl} className={styles.dock}>
        {task.premiumLocked && skipButton && (
          <div className={styles.dockSolo}>{skipButton}</div>
        )}
      </footer>
    </div>
  );
}

function CloseGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Task card (mockup B2)                                                      */
/* -------------------------------------------------------------------------- */

/** Seconds → a short, unit-labelled duration ("30 s", "2 daq", "1:30"). */
function useShortDuration() {
  const { t } = useTranslation();
  return (ms: number) => {
    const sec = Math.round(ms / 1000);
    if (sec < 60) return t("practice.timing.sec", { n: sec });
    if (sec % 60 === 0) return t("practice.timing.min", { n: sec / 60 });
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  };
}

/**
 * The question itself. It used to show only the task's TITLE — the student was
 * asked to answer "Do'konda" without ever seeing the question about the shop. Now:
 * the name (small), the picture or clip, the Russian prompt (large, `lang="ru"`
 * so a screen reader reads it as Russian) and the instruction panel.
 */
function TaskCard({
  task,
  onPlayReference,
}: {
  task: PracticeTask;
  onPlayReference?: () => void;
}) {
  const { t } = useTranslation();
  const duration = useShortDuration();
  const showTitle = Boolean(task.title && task.title !== task.prompt);

  return (
    <Card variant="raised" padding="lg" className={styles.taskCard}>
      <div className={styles.taskMeta}>
        {task.band && <Badge variant="primary">{task.band}</Badge>}
        {task.style && <Badge variant="neutral">{task.style}</Badge>}
        {task.durationHint && (
          <Text as="span" variant="body-s" color="muted">
            {task.durationHint}
          </Text>
        )}
        {task.prepMs ? (
          <Text as="span" variant="body-s" color="muted">
            {t("practice.timing.prep", { time: duration(task.prepMs) })}
          </Text>
        ) : null}
        {task.maxDurationMs ? (
          <Text as="span" variant="body-s" color="muted">
            {t("practice.timing.answer", { time: duration(task.maxDurationMs) })}
          </Text>
        ) : null}
      </div>

      {showTitle && (
        <Text as="h2" variant="title-s" color="ink-soft" className={styles.taskTitle}>
          {task.title}
        </Text>
      )}

      {task.media && (
        <div className={styles.media}>
          {task.media.type === "video" ? (
            // Controls, no autoplay: sound the student did not ask for, in a
            // classroom or on a bus, is the one thing a practice screen must not do.
            <video
              className={styles.mediaEl}
              src={task.media.url}
              controls
              preload="metadata"
              playsInline
            />
          ) : (
            <img
              className={styles.mediaEl}
              src={task.media.url}
              alt={t("practice.mediaAlt", { title: task.title ?? task.prompt })}
              loading="lazy"
            />
          )}
        </div>
      )}

      <div className={styles.promptBlock}>
        {showTitle && (
          <Text as="p" variant="label" color="muted">
            {t("practice.promptLabel")}
          </Text>
        )}
        <Text as="p" variant="title-l" className={styles.prompt} lang={showTitle ? "ru" : undefined}>
          {task.prompt}
        </Text>
      </div>

      {task.instruction && (
        <div className={styles.instruction}>
          <Text variant="body-l" color="ink-soft">
            {task.instruction}
          </Text>
        </div>
      )}

      {task.hasReferenceAudio && onPlayReference && (
        <div>
          <Button variant="secondary" size="md" onClick={onPlayReference}>
            <PlayGlyph />
            {t("practice.listenModel")}
          </Button>
        </div>
      )}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Progress                                                                   */
/* -------------------------------------------------------------------------- */

/** Progress within the module: one segment per task, the current one half-lit. */
function ProgressBar({ current, total }: PracticeProgress) {
  const { t } = useTranslation();
  const segs = Array.from({ length: Math.max(total, 0) }, (_, i) => i);
  return (
    <div className={styles.progress}>
      <div className={styles.segments} aria-hidden>
        {segs.map((i) => (
          <span
            key={i}
            className={cx(
              styles.segment,
              i < current - 1 && styles.segmentDone,
              i === current - 1 && styles.segmentCurrent,
            )}
          />
        ))}
      </div>
      <Text as="span" variant="body-s" color="muted" weight="bold" numeric className={styles.counter}>
        {t("practice.taskCounter", { current, total })}
      </Text>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Grading placeholder (docs/04 §4.6 — never an empty spinner)                */
/* -------------------------------------------------------------------------- */

type StepState = "done" | "active" | "todo";

/** Two honest steps — the upload, then the grading — each with its own state. */
function GradingPanel({
  mood,
  stage = "grading",
}: {
  mood: MascotMood;
  stage?: "uploading" | "grading";
}) {
  const { t } = useTranslation();
  const uploading = stage === "uploading";
  const steps: Array<{ label: string; state: StepState }> = [
    {
      label: uploading ? t("practice.focusUploading") : t("practice.focusUploaded"),
      state: uploading ? "active" : "done",
    },
    { label: t("practice.checkingPron"), state: uploading ? "todo" : "active" },
  ];
  return (
    <div className={styles.gradeStage} role="status">
      <Mascot mood={mood} size={128} label={t("practice.gradingMascotLabel")} />
      <Text variant="title-s" align="center">
        {t("practice.grading")}
      </Text>
      <ol className={styles.gradeSteps}>
        {steps.map((s) => (
          <li key={s.label} className={cx(styles.gradeStepRow, s.state === "todo" && styles.stepTodo)}>
            <span className={styles.stepIcon} aria-hidden>
              {s.state === "active" ? (
                <Spinner size="sm" label="" />
              ) : s.state === "done" ? (
                <CheckGlyph />
              ) : (
                <span className={styles.stepDot} />
              )}
            </span>
            <Text as="span" variant="body" color={s.state === "todo" ? "muted" : "ink-soft"}>
              {s.label}
            </Text>
          </li>
        ))}
      </ol>
      <div className={styles.indeterminate} aria-hidden>
        <span />
      </div>
    </div>
  );
}

function CheckGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" fill="var(--success)" />
      <path d="M7.5 12.5l3 3 6-6.5" stroke="var(--surface)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Premium lock, pending and failure                                          */
/* -------------------------------------------------------------------------- */

/** Shown INSTEAD of the recorder on a premium-locked task (see `premiumLocked`). */
function LockedPanel({ onOpenPremium }: { onOpenPremium?: () => void }) {
  const { t } = useTranslation();
  return (
    <Card variant="tint" padding="lg" className={styles.outcome}>
      <span className={styles.lockBadge} aria-hidden>
        <LockGlyph />
      </span>
      <Text as="h2" variant="title-s" align="center">
        {t("practice.locked.title")}
      </Text>
      <Text as="p" variant="body" color="ink-soft" align="center">
        {t("practice.locked.body")}
      </Text>
      {onOpenPremium && (
        <div className={styles.actions}>
          <Button variant="primary" onClick={onOpenPremium}>
            {t("practice.locked.cta")}
          </Button>
        </div>
      )}
    </Card>
  );
}

/** The shared frame of the pending and failed states: Govo, a line, a way on. */
function OutcomePanel({
  mood,
  title,
  body,
  hint,
  actions,
}: {
  mood: MascotMood;
  title: string;
  body: string;
  hint?: string;
  actions: ReactNode;
}) {
  return (
    <Card variant="tint" padding="lg" className={styles.outcome} role="status">
      <Mascot mood={mood} size={104} label="" />
      <Text as="h2" variant="title-s" align="center">
        {title}
      </Text>
      <Text as="p" variant="body" color="ink-soft" align="center">
        {body}
      </Text>
      {hint && (
        <Text as="p" variant="body-s" color="muted" align="center">
          {hint}
        </Text>
      )}
      <div className={styles.actions}>{actions}</div>
    </Card>
  );
}

/**
 * "Keyingi vazifa", plus — only when the task came from the daily session — the
 * way back to it, which is then the primary action: the student came here to do
 * one step of today's session, and the session is where the next step is.
 */
function NextActions({
  onNext,
  onBackToDaily,
  quiet = false,
}: {
  onNext: () => void;
  onBackToDaily?: () => void;
  /** Render both as secondary (the failed state's primary action is the retry). */
  quiet?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Button variant={onBackToDaily || quiet ? "secondary" : "primary"} onClick={onNext}>
        {t("practice.nextTask")}
      </Button>
      {onBackToDaily && (
        <Button variant={quiet ? "secondary" : "primary"} onClick={onBackToDaily}>
          {t("practice.backToDaily")}
        </Button>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Feedback panel (docs/04 §4.3)                                              */
/* -------------------------------------------------------------------------- */

interface FeedbackPanelProps {
  mood: MascotMood;
  feedback: PracticeFeedback;
  onRetry: () => void;
  onNext: () => void;
  onOpenDetail?: () => void;
  onBackToDaily?: () => void;
  onPlayReference?: () => void;
  onPlayAnswer?: () => void;
}

function FeedbackPanel({
  mood,
  feedback,
  onRetry,
  onNext,
  onOpenDetail,
  onBackToDaily,
  onPlayReference,
  onPlayAnswer,
}: FeedbackPanelProps) {
  const { t } = useTranslation();
  const tone = toneForScore(feedback.score);
  const shownCorrections = feedback.corrections ?? [];
  const total = feedback.correctionTotal ?? shownCorrections.length;

  return (
    <div className={styles.feedback}>
      <Card variant="tint" padding="lg" className={styles.block}>
        <div className={styles.scoreHead}>
          <Mascot mood={mood} size={104} label={t("practice.feedbackMascotLabel")} />
          <div className={styles.scoreBlock}>
            <div className={cx(styles.scoreRing, RING_BY_TONE[tone])}>
              <Text as="span" variant="score" weight="black" numeric color={TEXT_BY_TONE[tone]}>
                {feedback.score}
              </Text>
            </div>
            <div className={styles.scoreMeta}>
              <Badge variant="accent" size="md">
                {t("practice.levelBadge", { band: feedback.band })}
              </Badge>
              {feedback.summary && (
                <Text variant="body-l" color="ink-soft">
                  {feedback.summary}
                </Text>
              )}
            </div>
          </div>
        </div>
      </Card>

      {feedback.strengths && feedback.strengths.length > 0 && (
        <Card variant="flat" padding="lg" className={styles.block}>
          <Text as="p" variant="label" color="success">
            {t("practice.strengthsTitle")}
          </Text>
          <ul className={styles.strengths}>
            {feedback.strengths.map((s, i) => (
              <li key={i}>
                <Text as="span" variant="body">
                  {s}
                </Text>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {feedback.transcript && (
        <Card variant="flat" padding="lg" className={styles.block}>
          <Text as="p" variant="label" color="muted">
            {t("practice.yourAnswer")}
          </Text>
          <Text as="p" variant="mono" className={styles.transcriptText} lang="ru">
            {feedback.transcript}
          </Text>
          {/* Only the buttons that can do something: a play button with nothing
              wired behind it reads as broken audio. */}
          {(onPlayAnswer || onPlayReference) && (
            <div className={styles.audioRow}>
              {onPlayAnswer && (
                <Button variant="ghost" size="md" onClick={onPlayAnswer}>
                  <PlayGlyph />
                  {t("practice.listenYourAudio")}
                </Button>
              )}
              {onPlayReference && (
                <Button variant="ghost" size="md" onClick={onPlayReference}>
                  <PlayGlyph />
                  {t("practice.modelAnswer")}
                </Button>
              )}
            </div>
          )}
        </Card>
      )}

      {shownCorrections.length > 0 && (
        <Card variant="flat" padding="lg" className={styles.block}>
          <div className={styles.blockHead}>
            <Text as="p" variant="label" color="muted">
              {t("practice.correctionsTitle")}
            </Text>
            {total > shownCorrections.length && (
              <Badge variant="neutral">
                {shownCorrections.length} / {total}
              </Badge>
            )}
          </div>
          <ul className={styles.corrections}>
            {shownCorrections.map((c) => (
              <li key={c.id} className={styles.correctionRow}>
                <div className={styles.correctionDiff}>
                  <Text as="span" variant="body-l" color="danger" className={styles.before}>
                    {c.before}
                  </Text>
                  <span className={styles.arrow} aria-hidden>
                    →
                  </span>
                  <Text as="span" variant="body-l" color="success" weight="semibold">
                    {c.after}
                  </Text>
                </div>
                {c.note && (
                  <Text variant="body-s" color="ink-soft">
                    {c.note}
                  </Text>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {feedback.criteria && feedback.criteria.length > 0 && (
        <Card variant="flat" padding="lg" className={styles.block}>
          <Text as="p" variant="label" color="muted">
            {t("practice.criteriaTitle")}
          </Text>
          <ul className={styles.criteria}>
            {feedback.criteria.map((cr) => {
              const critTone = toneForScore(cr.score);
              return (
                <li key={cr.id} className={styles.criterionRow}>
                  <Text as="span" variant="body" className={styles.critLabel}>
                    {cr.label}
                  </Text>
                  <div
                    className={styles.bar}
                    role="progressbar"
                    aria-label={cr.label}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={cr.score}
                  >
                    <div
                      className={cx(styles.barFill, BAR_BY_TONE[critTone])}
                      style={{ width: `${clampPct(cr.score)}%` }}
                    />
                  </div>
                  <Text
                    as="span"
                    variant="body"
                    weight="bold"
                    numeric
                    color={TEXT_BY_TONE[critTone]}
                    className={styles.critScore}
                  >
                    {cr.score}
                  </Text>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <div className={styles.actions}>
        {onOpenDetail && (
          <Button variant="ghost" onClick={onOpenDetail}>
            {t("practice.details")}
          </Button>
        )}
        <Button variant="secondary" onClick={onRetry}>
          {t("common.retry")}
        </Button>
        <NextActions onNext={onNext} onBackToDaily={onBackToDaily} />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Local helpers                                                              */
/* -------------------------------------------------------------------------- */

type Tone = "good" | "mid" | "low";

function toneForScore(score: number): Tone {
  if (score >= 75) return "good";
  if (score >= 50) return "mid";
  return "low";
}

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, n));
}

const TEXT_BY_TONE: Record<Tone, TextColor> = {
  good: "success",
  mid: "warn",
  low: "danger",
};

const RING_BY_TONE: Record<Tone, string> = {
  good: styles.ringGood,
  mid: styles.ringMid,
  low: styles.ringLow,
};

const BAR_BY_TONE: Record<Tone, string> = {
  good: styles.barGood,
  mid: styles.barMid,
  low: styles.barLow,
};

function PlayGlyph() {
  return (
    <svg className={styles.glyph} width="14" height="14" viewBox="0 0 24 24" aria-hidden>
      <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
    </svg>
  );
}

function LockGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" stroke="currentColor" strokeWidth="2" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Default export — a self-wired demo, renderable in isolation.               */
/* -------------------------------------------------------------------------- */

/**
 * PracticeScreenDemo — drop-in standalone preview. Holds the phase locally,
 * feeds the mock fixture, and simulates grading (idle → reviewing → submitted)
 * so the screen renders and animates end-to-end with no backend.
 */
export default function PracticeScreenDemo() {
  const [phase, setPhase] = useState<PracticePhase>("idle");
  const [feedback, setFeedback] = useState<PracticeFeedback | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const handleSubmit = useCallback((_audio: Blob) => {
    setFeedback(null);
    setPhase("reviewing");
    timer.current = window.setTimeout(() => {
      setFeedback(mockFeedback);
      setPhase("submitted");
    }, 2200);
  }, []);

  const reset = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    setFeedback(null);
    setPhase("idle");
  }, []);

  return (
    <PracticeScreen
      task={mockTask}
      progress={mockProgress}
      phase={phase}
      feedback={feedback}
      attemptsLeft={3}
      onSubmit={handleSubmit}
      onRetry={reset}
      onNext={reset}
      onSkip={reset}
      onPlayReference={() => undefined}
      onPlayAnswer={() => undefined}
    />
  );
}
