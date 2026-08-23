/**
 * DailyScreen — «Bugungi 5 daqiqa», the F3 daily session (docs/01 F3, docs/04
 * §4.5, docs/08 Faza 6.3, behind the `daily_five_enabled` flag).
 *
 * **It is a guide, not a container.** Two of the three steps happen on screens
 * that already exist — the task is answered in Mashq, the correction is done in
 * «Xatolar ustida» — and this screen sends the student there rather than
 * rebuilding a recorder and a grading flow inside itself. Reimplementing them
 * would have meant a second submit path to keep in step with the first, and the
 * value F3 adds was never a new way to practise: it is that the student is not
 * asked to CHOOSE. So the screen's whole job is to say what today is, hold the
 * place while they go and do it, and know when it is finished.
 *
 * The warm-up is the one step that lives here, because it is the one that has
 * nowhere else to be: three phrases read aloud, nothing recorded, nothing
 * uploaded, nothing graded — so it costs neither a vendor call nor one of a free
 * student's three attempts.
 *
 * **Nothing is awarded here.** The task inside the session already grants XP and
 * moves the streak on its own path; a second reward for finishing the session
 * would pay twice for one piece of work. «Bajarildi» is a state, not a prize.
 *
 * Presentational + prop-driven: it fetches nothing and owns no server state. The
 * only state it owns is which phrase is being spoken aloud, which is local by
 * nature. Full-width per docs/04 §4.10; every colour / space / radius / motion
 * value is a token and all copy resolves through `daily.*`.
 */
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card, Mascot, Text, cx } from "../../shared/ui";
import { AppShell, Brand, NotificationsBell, studentNavItems } from "../../widgets";
import type { NavItem } from "../../widgets";
import { mockDailySteps } from "./daily.mock";
import { useRussianVoice } from "./useRussianVoice";
import styles from "./DailyScreen.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

/** The three step kinds the server can send. Treated as an open string at the
 * edges: an unrecognised kind is skipped rather than crashing the session. */
export type DailyStepKind = "warmup" | "task" | "drill";

/** One warm-up line. `level` is a free-text CEFR label ("A1–A2"), shown as-is. */
export interface DailyPhrase {
  id: string;
  text: string;
  level: string;
}

/** One step of today's session. Steps the student cannot do today are absent
 * from the array entirely — never present-but-empty (see the screen header). */
export interface DailyStep {
  kind: DailyStepKind;
  done: boolean;
  /** The step's advertised length. They sum to the five minutes in the name. */
  estSeconds: number;
  /** Warm-up only. */
  phrases?: DailyPhrase[];
  /** Task step only — what «Gapirishga o'tish» opens. */
  taskId?: string | null;
  taskTitle?: string | null;
  moduleName?: string | null;
  level?: string | null;
  /** Drill step only: cards due right now. */
  dueCount?: number | null;
}

export interface DailyScreenProps {
  /** The student's local day, `yyyy-MM-dd`. Not rendered — it keys the session. */
  day: string;
  /** Current streak, shown beside the title. Never awarded by this screen. */
  streak: number;
  /** Today's steps, in order. */
  steps: DailyStep[];
  /** Index of the step being worked on, or -1 when every step is finished. */
  activeIndex: number;
  /** The warm-up was read — advance. */
  onFinishWarmup: () => void;
  /** Go and answer today's task (the existing Mashq recording screen). */
  onOpenTask: (taskId: string) => void;
  /** Go and do one correction (the existing xato-replay drill). */
  onOpenDrill: () => void;
  /** Leave the session (back to Home). */
  onExit: () => void;
  /** Keep practising past the daily five (to Mashq). */
  onKeepPractising: () => void;
  activeNavKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A step's length in words. Under a minute it is said in seconds; above it, in
 * minutes — "180 soniya" is a true statement that nobody reads as three minutes,
 * and in a feature whose whole name is a duration that matters.
 *
 * The number is formatted through `Intl` rather than concatenated, because one of
 * the steps is a minute and a half and the three locales do not agree on how to
 * write that ("1,5" vs "1.5"). `count` still carries the raw value so plural
 * selection stays the library's job.
 */
function useDuration() {
  const { t, i18n } = useTranslation();
  return (seconds: number) => {
    if (seconds < 60) return t("daily.seconds", { count: seconds });
    const minutes = seconds / 60;
    return t("daily.minutes", {
      count: minutes,
      val: new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(minutes),
    });
  };
}

export function DailyScreen({
  day,
  streak,
  steps,
  activeIndex,
  onFinishWarmup,
  onOpenTask,
  onOpenDrill,
  onExit,
  onKeepPractising,
  activeNavKey = "home",
  onNavigate,
}: DailyScreenProps) {
  const { t } = useTranslation();
  const voice = useRussianVoice();

  // Stop any spoken phrase when the step changes or the screen goes away, so a
  // warm-up line never keeps talking over the task the student just opened.
  useEffect(() => voice.cancel, [activeIndex, day, voice.cancel]);

  const totalMinutes = Math.max(
    1,
    Math.round(steps.reduce((sum, s) => sum + s.estSeconds, 0) / 60),
  );
  const doneCount = steps.filter((s) => s.done).length;
  const active = activeIndex >= 0 ? steps[activeIndex] : null;
  const finished = steps.length > 0 && activeIndex < 0;

  return (
    <AppShell
      brand={<Brand />}
      nav={{
        items: studentNavItems(t),
        activeKey: activeNavKey,
        onNavigate,
        label: t("nav.landmark"),
      }}
      headerStart={
        <Text as="h1" variant="title-m">
          {t("daily.title", { min: totalMinutes })}
        </Text>
      }
      headerEnd={<NotificationsBell />}
    >
      <div className={styles.page}>
        {steps.length === 0 ? (
          <EmptyState onExit={onExit} />
        ) : (
          <>
            <SessionRail
              steps={steps}
              activeIndex={activeIndex}
              doneCount={doneCount}
              streak={streak}
              totalMinutes={totalMinutes}
            />

            {finished ? (
              <DoneState
                streak={streak}
                onExit={onExit}
                onKeepPractising={onKeepPractising}
              />
            ) : active?.kind === "warmup" ? (
              <WarmupStep step={active} voice={voice} onDone={onFinishWarmup} />
            ) : active?.kind === "task" ? (
              <TaskStep step={active} onOpen={onOpenTask} />
            ) : active?.kind === "drill" ? (
              <DrillStep step={active} onOpen={onOpenDrill} />
            ) : null}
          </>
        )}
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* The rail: what today is, and where in it we are                            */
/* -------------------------------------------------------------------------- */

function SessionRail({
  steps,
  activeIndex,
  doneCount,
  streak,
  totalMinutes,
}: {
  steps: DailyStep[];
  activeIndex: number;
  doneCount: number;
  streak: number;
  totalMinutes: number;
}) {
  const { t } = useTranslation();
  const duration = useDuration();

  return (
    <section className={styles.rail} aria-label={t("daily.railLabel")}>
      <div className={styles.railHead}>
        <Text variant="label" color="muted">
          {t("daily.progress", { done: doneCount, total: steps.length })}
        </Text>
        <div className={styles.railMeta}>
          {streak > 0 && (
            <Badge variant="warn">{t("daily.streak", { count: streak })}</Badge>
          )}
          <Text variant="body-s" color="muted">
            {t("daily.totalMinutes", { min: totalMinutes })}
          </Text>
        </div>
      </div>

      <ol className={styles.steps}>
        {steps.map((step, i) => {
          const state = step.done ? "done" : i === activeIndex ? "current" : "todo";
          return (
            <li
              key={step.kind}
              className={cx(styles.step, styles[state])}
              aria-current={state === "current" ? "step" : undefined}
            >
              <span className={styles.dot} aria-hidden>
                {step.done ? <CheckGlyph /> : i + 1}
              </span>
              <span className={styles.stepText}>
                <Text variant="body-s" weight="semibold">
                  {t(`daily.steps.${step.kind}.label`)}
                </Text>
                <Text variant="label" color="muted">
                  {duration(step.estSeconds)}
                </Text>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Step 1 · Isinish                                                           */
/* -------------------------------------------------------------------------- */

function WarmupStep({
  step,
  voice,
  onDone,
}: {
  step: DailyStep;
  voice: ReturnType<typeof useRussianVoice>;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const phrases = step.phrases ?? [];

  return (
    <Card variant="raised" padding="lg" className={styles.card}>
      <header className={styles.cardHead}>
        <Text as="h2" variant="title-s" weight="black">
          {t("daily.steps.warmup.title")}
        </Text>
        <Text variant="body" color="muted">
          {voice.available
            ? t("daily.steps.warmup.bodyVoice")
            : t("daily.steps.warmup.body")}
        </Text>
      </header>

      <ul className={styles.phrases}>
        {phrases.map((phrase) => (
          <li key={phrase.id} className={styles.phrase}>
            <p className={styles.phraseText} lang="ru">
              {phrase.text}
            </p>
            <div className={styles.phraseMeta}>
              <Badge variant="neutral">{phrase.level}</Badge>
              {/* Offered only when the operating system actually has a Russian
                  voice — a button that silently does nothing is worse than no
                  button, and reads as broken audio rather than a missing voice. */}
              {voice.available && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => voice.speak(phrase.text)}
                >
                  <SpeakerGlyph />
                  {t("daily.steps.warmup.listen")}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <div className={styles.cardActions}>
        <Button variant="primary" size="lg" onClick={onDone}>
          {t("daily.steps.warmup.cta")}
          <ArrowGlyph />
        </Button>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Step 2 · Gapirish                                                          */
/* -------------------------------------------------------------------------- */

function TaskStep({ step, onOpen }: { step: DailyStep; onOpen: (id: string) => void }) {
  const { t } = useTranslation();

  return (
    <Card variant="raised" padding="lg" className={styles.card}>
      <header className={styles.cardHead}>
        <Text as="h2" variant="title-s" weight="black">
          {t("daily.steps.task.title")}
        </Text>
        <Text variant="body" color="muted">
          {t("daily.steps.task.body")}
        </Text>
      </header>

      <div className={styles.target}>
        <div className={styles.targetTags}>
          {step.moduleName && <Badge variant="primary">{step.moduleName}</Badge>}
          {step.level && <Badge variant="neutral">{step.level}</Badge>}
        </div>
        <Text as="p" variant="title-s" className={styles.targetTitle}>
          {step.taskTitle ?? t("daily.steps.task.untitled")}
        </Text>
      </div>

      <div className={styles.cardActions}>
        <Button
          variant="primary"
          size="lg"
          disabled={!step.taskId}
          onClick={() => step.taskId && onOpen(step.taskId)}
        >
          {t("daily.steps.task.cta")}
          <ArrowGlyph />
        </Button>
        {/* Leaving is expected here, so the screen says so rather than letting the
            student wonder whether they have lost their place. */}
        <Text variant="body-s" color="muted">
          {t("daily.resumeHint")}
        </Text>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Step 3 · Tuzatish                                                          */
/* -------------------------------------------------------------------------- */

function DrillStep({ step, onOpen }: { step: DailyStep; onOpen: () => void }) {
  const { t } = useTranslation();
  const due = step.dueCount ?? 0;

  return (
    <Card variant="raised" padding="lg" className={styles.card}>
      <header className={styles.cardHead}>
        <Text as="h2" variant="title-s" weight="black">
          {t("daily.steps.drill.title")}
        </Text>
        <Text variant="body" color="muted">
          {t("daily.steps.drill.body", { count: due })}
        </Text>
      </header>

      <div className={styles.cardActions}>
        <Button variant="primary" size="lg" onClick={onOpen}>
          {t("daily.steps.drill.cta")}
          <ArrowGlyph />
        </Button>
        <Text variant="body-s" color="muted">
          {t("daily.resumeHint")}
        </Text>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Terminal states                                                            */
/* -------------------------------------------------------------------------- */

function DoneState({
  streak,
  onExit,
  onKeepPractising,
}: {
  streak: number;
  onExit: () => void;
  onKeepPractising: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Card variant="tint" padding="lg" className={styles.state}>
      <Mascot mood="proud" size={96} />
      <div className={styles.stateText}>
        <Text as="h2" variant="title-m" weight="black">
          {t("daily.done.title")}
        </Text>
        {/* Deliberately no XP figure and no "+1 streak". Both already happened on
            the task's own path; repeating them here would read as a second award
            for one piece of work. */}
        <Text variant="body" color="ink-soft">
          {streak > 0 ? t("daily.done.streak", { count: streak }) : t("daily.done.body")}
        </Text>
      </div>
      <div className={styles.stateActions}>
        <Button variant="primary" size="lg" onClick={onExit}>
          {t("daily.done.cta")}
        </Button>
        <Button variant="secondary" size="lg" onClick={onKeepPractising}>
          {t("daily.done.more")}
        </Button>
      </div>
    </Card>
  );
}

function EmptyState({ onExit }: { onExit: () => void }) {
  const { t } = useTranslation();
  return (
    <Card variant="tint" padding="lg" className={styles.state}>
      <Mascot mood="idle" size={96} />
      <div className={styles.stateText}>
        <Text as="h2" variant="title-m" weight="black">
          {t("daily.empty.title")}
        </Text>
        <Text variant="body" color="ink-soft">
          {t("daily.empty.body")}
        </Text>
      </div>
      <div className={styles.stateActions}>
        <Button variant="primary" size="lg" onClick={onExit}>
          {t("daily.empty.cta")}
        </Button>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Glyphs — decorative, never the only carrier of meaning                     */
/* -------------------------------------------------------------------------- */

function ArrowGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden focusable="false">
      <path
        d="M5 12h13m0 0-5-5m5 5-5 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden focusable="false">
      <path
        d="m5 13 4 4 10-10"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SpeakerGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden focusable="false">
      <path
        d="M4 9v6h4l5 4V5L8 9H4Zm12.5-.5a5 5 0 0 1 0 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Default export — a self-wired demo, renderable in isolation.               */
/* -------------------------------------------------------------------------- */

/**
 * DailyScreenDemo — drop-in standalone preview wired to the mock session, so the
 * warm-up → task → drill → done sequence renders with no backend.
 */
export default function DailyScreenDemo() {
  return (
    <DailyScreen
      day="2026-08-23"
      streak={12}
      steps={mockDailySteps}
      activeIndex={0}
      onFinishWarmup={() => undefined}
      onOpenTask={() => undefined}
      onOpenDrill={() => undefined}
      onExit={() => undefined}
      onKeepPractising={() => undefined}
      onNavigate={() => undefined}
    />
  );
}
