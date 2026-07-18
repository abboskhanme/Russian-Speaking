import { useCallback, useEffect, useRef, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Mascot,
  Recorder,
  Skeleton,
  Spinner,
  Text,
  cx,
} from "../../shared/ui";
import type { MascotMood, TextColor } from "../../shared/ui";
import { AppShell, Brand, ThemeToggle, studentNavItems } from "../../widgets";
import type { NavItem, ThemeMode } from "../../widgets";
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
 *   submitted  — the result is ready (Govo is proud)
 */
export type PracticePhase = "idle" | "recording" | "reviewing" | "submitted";

/** Govo's mood is a pure function of the phase (the one wiring the task asks for). */
const MOOD_BY_PHASE: Record<PracticePhase, MascotMood> = {
  idle: "idle",
  recording: "listening",
  reviewing: "thinking",
  submitted: "proud",
};

export interface PracticeTask {
  id: string;
  /** The Russian phrase / question the student answers. */
  prompt: string;
  /** The instruction (shart) — shown in a tinted panel. */
  instruction?: string;
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
  /** One short, encouraging sentence (≤ 12 words). */
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
  /** Skip this task. */
  onSkip?: () => void;
  /** Try this task again (from the result panel). */
  onRetry?: () => void;
  /** Play the reference / model answer. */
  onPlayReference?: () => void;
  /** Play back the student's own recorded answer. */
  onPlayAnswer?: () => void;
  /** Active nav key (defaults to "practice"). */
  activeNavKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
  onToggleTheme?: (mode: ThemeMode) => void;
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * PracticeScreen — the core practice loop, composed entirely from `shared/ui`
 * + `widgets` + tokens (docs/03, docs/04 §4.2–4.6). Presentational and
 * prop-driven: it fetches nothing and owns only the phase (when uncontrolled).
 *
 * Layout is full-width (docs/04 §4.10): AppShell frame → task-prompt card →
 * a "stage" that swaps Recorder / grading placeholder / feedback panel by
 * phase → progress → result actions. Govo's mood is derived from the phase via
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
  activeNavKey = "practice",
  onNavigate,
  onToggleTheme,
}: PracticeScreenProps) {
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

  return (
    <AppShell
      brand={<Brand />}
      nav={{ items: studentNavItems, activeKey: activeNavKey, onNavigate }}
      headerStart={
        <Text as="h1" variant="title-m">
          Mashq
        </Text>
      }
      headerEnd={<ThemeToggle onChange={onToggleTheme} />}
    >
      <div className={styles.page}>
        <div className={styles.head}>
          <ProgressPips current={progress.current} total={progress.total} />
          {attemptsLeft !== undefined && (
            <Badge variant={attemptsLeft > 0 ? "neutral" : "warn"}>
              {attemptsLeft} urinish qoldi
            </Badge>
          )}
        </div>

        <Card variant="raised" padding="lg" className={styles.taskCard}>
          <div className={styles.taskMeta}>
            {task.band && <Badge variant="primary">{task.band}</Badge>}
            {task.style && <Badge variant="neutral">{task.style}</Badge>}
            {task.durationHint && (
              <Text as="span" variant="body-s" color="muted">
                {task.durationHint}
              </Text>
            )}
          </div>

          <Text as="p" variant="title-l" className={styles.prompt}>
            {task.prompt}
          </Text>

          {task.instruction && (
            <div className={styles.instruction}>
              <Text variant="body-l" color="ink-soft">
                {task.instruction}
              </Text>
            </div>
          )}

          {task.hasReferenceAudio && (
            <div>
              <Button variant="secondary" size="sm" onClick={onPlayReference}>
                <PlayGlyph />
                Namunani eshit
              </Button>
            </div>
          )}
        </Card>

        <section className={styles.stage} aria-live="polite">
          {answering && (
            <Recorder
              key={task.id}
              onComplete={handleComplete}
              onCancel={() => setPhase("idle")}
              maxDurationMs={task.maxDurationMs}
            />
          )}

          {phase === "reviewing" && <GradingPanel mood={mood} />}

          {phase === "submitted" &&
            (feedback ? (
              <FeedbackPanel
                mood={mood}
                feedback={feedback}
                onRetry={handleRetry}
                onNext={handleNext}
                onPlayReference={onPlayReference}
                onPlayAnswer={onPlayAnswer}
              />
            ) : (
              <GradingPanel mood="thinking" />
            ))}
        </section>

        {answering && onSkip && (
          <div className={styles.answerActions}>
            <Button variant="ghost" onClick={onSkip}>
              O&apos;tkazib yuborish →
            </Button>
          </div>
        )}
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Progress                                                                   */
/* -------------------------------------------------------------------------- */

function ProgressPips({ current, total }: PracticeProgress) {
  const pips = Array.from({ length: Math.max(total, 0) }, (_, i) => i);
  return (
    <div className={styles.progress}>
      <div className={styles.pips} aria-hidden>
        {pips.map((i) => (
          <span
            key={i}
            className={cx(
              styles.pip,
              i < current - 1 && styles.pipDone,
              i === current - 1 && styles.pipCurrent,
            )}
          />
        ))}
      </div>
      <Text as="span" variant="body-s" color="muted" weight="semibold" numeric>
        Vazifa {current} / {total}
      </Text>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Grading placeholder (docs/04 §4.6 — never an empty spinner)                */
/* -------------------------------------------------------------------------- */

function GradingPanel({ mood }: { mood: MascotMood }) {
  return (
    <div className={styles.gradeStage} role="status">
      <Mascot mood={mood} size={140} label="Govo javobingni baholayapti" />
      <Text variant="title-s" align="center">
        Javobingni baholayapman…
      </Text>
      <div className={styles.gradeSteps}>
        <div className={styles.gradeStepRow}>
          <Spinner size="sm" label="" />
          <Text as="span" variant="body-s" color="ink-soft">
            Talaffuzni tekshiryapman
          </Text>
        </div>
        <Skeleton width={220} height={12} />
        <Skeleton width={180} height={12} />
      </div>
    </div>
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
  onPlayReference?: () => void;
  onPlayAnswer?: () => void;
}

function FeedbackPanel({
  mood,
  feedback,
  onRetry,
  onNext,
  onPlayReference,
  onPlayAnswer,
}: FeedbackPanelProps) {
  const tone = toneForScore(feedback.score);
  const shownCorrections = feedback.corrections ?? [];
  const total = feedback.correctionTotal ?? shownCorrections.length;

  return (
    <div className={styles.feedback}>
      <Card variant="tint" padding="lg" className={styles.block}>
        <div className={styles.scoreHead}>
          <Mascot mood={mood} size={104} label="Govo — natijangdan xursand" />
          <div className={styles.scoreBlock}>
            <div className={cx(styles.scoreRing, RING_BY_TONE[tone])}>
              <Text as="span" variant="score" weight="black" numeric color={TEXT_BY_TONE[tone]}>
                {feedback.score}
              </Text>
            </div>
            <div className={styles.scoreMeta}>
              <Badge variant="accent" size="md">
                Daraja {feedback.band}
              </Badge>
              <Text variant="body-l" color="ink-soft">
                {feedback.summary}
              </Text>
            </div>
          </div>
        </div>
      </Card>

      {feedback.strengths && feedback.strengths.length > 0 && (
        <Card variant="flat" padding="lg" className={styles.block}>
          <Text as="p" variant="label" color="success">
            Yaxshi bo&apos;ldi
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
            Sening javobing
          </Text>
          <Text as="p" variant="mono" className={styles.transcriptText}>
            {feedback.transcript}
          </Text>
          <div className={styles.audioRow}>
            <Button variant="ghost" size="sm" onClick={onPlayAnswer}>
              <PlayGlyph />
              Audiongni eshit
            </Button>
            <Button variant="ghost" size="sm" onClick={onPlayReference}>
              <PlayGlyph />
              Namuna javob
            </Button>
          </div>
        </Card>
      )}

      {shownCorrections.length > 0 && (
        <Card variant="flat" padding="lg" className={styles.block}>
          <div className={styles.blockHead}>
            <Text as="p" variant="label" color="muted">
              Tuzatamiz
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
            Mezonlar
          </Text>
          <ul className={styles.criteria}>
            {feedback.criteria.map((cr) => {
              const t = toneForScore(cr.score);
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
                      className={cx(styles.barFill, BAR_BY_TONE[t])}
                      style={{ width: `${clampPct(cr.score)}%` }}
                    />
                  </div>
                  <Text
                    as="span"
                    variant="body"
                    weight="bold"
                    numeric
                    color={TEXT_BY_TONE[t]}
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
        <Button variant="secondary" onClick={onRetry}>
          Qayta urinish
        </Button>
        <Button variant="primary" onClick={onNext}>
          Keyingi vazifa →
        </Button>
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
      onNavigate={() => undefined}
    />
  );
}
