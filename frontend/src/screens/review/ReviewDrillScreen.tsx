/**
 * ReviewDrillScreen — «Xatolar ustida», the F5 xato-replay drill (docs/08 Faza
 * 6.1, behind the `review_drill_enabled` flag).
 *
 * The spaced-repetition queue has existed since Faza 3.6, but it was only ever a
 * LIST: the student could see which questions had beaten them and could do
 * nothing about it. This is the missing half — one card at a time, say the
 * answer again, then judge it and let the item move along the ladder.
 *
 * The take is recorded LOCALLY and never uploaded. That is deliberate, not a
 * shortcut: "answer this question for a score" already exists in Mashq, and
 * routing a replay through the grader would hand the schedule back to the
 * scheduler, which supersedes every open review on each graded attempt — the
 * ladder could then never climb past its first rung. Here the recorder exists so
 * the student HEARS themselves before comparing against the model answer, which
 * is what makes their own verdict worth anything.
 *
 * Presentational + prop-driven: it fetches nothing and owns no server state. The
 * only state it owns is per-card and ephemeral (has this card been spoken yet),
 * which resets by remount because {@link DrillCard} is keyed on the card id.
 * Full-width per docs/04 §4.10; every colour / space / radius / motion value is
 * a token and all copy resolves through `review.*`.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card, Mascot, Recorder, Text } from "../../shared/ui";
import type { BadgeVariant } from "../../shared/ui";
import { AppShell, Brand, NotificationsBell, studentNavItems } from "../../widgets";
import type { NavItem } from "../../widgets";
import { mockDrillCards } from "./review.mock";
import styles from "./ReviewDrillScreen.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

/** The student's verdict on their own replay — the only thing that moves an item
 * along the SRS ladder. "again" is a lapse, not a failure, and the UI treats it
 * as an ordinary choice rather than a destructive one. */
export type DrillVerdict = "good" | "again";

/** One card of the session: a question to say again, plus why it is here. */
export interface ReviewDrillCard {
  /** The `review_items` row id — what the answer is posted against. */
  id: string;
  title: string;
  /** The words to say again. */
  promptText: string;
  instructionText?: string | null;
  /** Shown only after the student has spoken, so it cannot be read out instead
   * of recalled. Null when the question has no model answer authored. */
  modelAnswerText?: string | null;
  topic?: string | null;
  level?: string | null;
  /** fluency · lexical · grammar · relevance · teacher (open-ended: an unknown
   * dimension renders as its raw value rather than dropping the card). */
  weaknessDim: string;
  /** 1-based position on the ladder, e.g. 2 of 5. */
  round: number;
  totalRounds: number;
}

export interface ReviewDrillScreenProps {
  /** The card showing now. Null with `finished` false ⇒ nothing is due. */
  card: ReviewDrillCard | null;
  /** 1-based position within this session, for "3 / 8". */
  position: number;
  /** Cards in this session (the server caps it). */
  sessionSize: number;
  /** Everything due right now — may exceed `sessionSize`, and the done state
   * says so rather than implying the session emptied the backlog. */
  dueCount: number;
  /** Answers accepted so far in this session. */
  answered: number;
  /** True once the student has worked through every card in the session. */
  finished: boolean;
  /** An answer is in flight — both verdict buttons go busy. */
  busy?: boolean;
  /** Message for a failed answer; the card stays put so it can be retried. */
  error?: string | null;
  onAnswer: (verdict: DrillVerdict) => void;
  /** Leave the drill (back to Mashq). */
  onExit: () => void;
  activeNavKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

/** ~60s is plenty for one replayed answer; the Recorder auto-stops at the cap. */
const MAX_REPLAY_MS = 60_000;

/** Weakness dimension → badge colour. An unknown dimension falls through to
 * neutral, so a dimension a later backend adds still renders. */
const DIM_VARIANT: Record<string, BadgeVariant> = {
  fluency: "info",
  // Not a dimension the scheduler picks today (it weighs the other four), but it
  // exists in the data and is a real skill on the Progress screen — a card that
  // rendered "pronunciation" raw would look like a bug, not a rare branch.
  pronunciation: "info",
  lexical: "accent",
  grammar: "warn",
  relevance: "primary",
  teacher: "success",
};

export function ReviewDrillScreen({
  card,
  position,
  sessionSize,
  dueCount,
  answered,
  finished,
  busy = false,
  error = null,
  onAnswer,
  onExit,
  activeNavKey = "practice",
  onNavigate,
}: ReviewDrillScreenProps) {
  const { t } = useTranslation();

  // Filled bar = answers accepted, so it only ever moves on a server fact.
  const pct = sessionSize > 0 ? Math.round((answered / sessionSize) * 100) : 0;

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
          {t("review.title")}
        </Text>
      }
      headerEnd={<NotificationsBell />}
    >
      <div className={styles.page}>
        {!finished && card && (
          <div className={styles.progress}>
            <div className={styles.progressHead}>
              <Text variant="label" color="muted">
                {t("review.progress", { n: position, total: sessionSize })}
              </Text>
              <Text variant="body-s" color="muted">
                {t("review.dueCount", { count: dueCount })}
              </Text>
            </div>
            <div
              className={styles.track}
              role="progressbar"
              aria-valuenow={answered}
              aria-valuemin={0}
              aria-valuemax={sessionSize}
              aria-label={t("review.progressLabel")}
            >
              <div className={styles.fill} style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        {finished ? (
          <DoneState answered={answered} remaining={dueCount} onExit={onExit} />
        ) : card ? (
          <DrillCard
            key={card.id}
            card={card}
            busy={busy}
            error={error}
            onAnswer={onAnswer}
          />
        ) : (
          <EmptyState onExit={onExit} />
        )}
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* One card: prompt → speak → verdict                                         */
/* -------------------------------------------------------------------------- */

interface DrillCardProps {
  card: ReviewDrillCard;
  busy: boolean;
  error: string | null;
  onAnswer: (verdict: DrillVerdict) => void;
}

function DrillCard({ card, busy, error, onAnswer }: DrillCardProps) {
  const { t } = useTranslation();

  // The model answer stays hidden until the student has spoken (or has said they
  // cannot record). Revealing it first would turn a recall drill into a reading
  // exercise, and the verdict that follows would mean nothing.
  const [spoken, setSpoken] = useState(false);

  const dimLabel = t(`review.dims.${card.weaknessDim}`, {
    defaultValue: card.weaknessDim,
  });

  return (
    <Card variant="raised" padding="lg" className={styles.card}>
      <div className={styles.col}>
        <div className={styles.tags}>
          <Badge variant={DIM_VARIANT[card.weaknessDim] ?? "neutral"} dot>
            {dimLabel}
          </Badge>
          {card.level && <Badge variant="neutral">{card.level}</Badge>}
          <Text variant="label" color="muted">
            {t("review.round", { round: card.round, total: card.totalRounds })}
          </Text>
        </div>

        <Text as="h2" variant="title-s" className={styles.title}>
          {card.title}
        </Text>
        {card.topic && (
          <Text variant="body-s" color="muted">
            {card.topic}
          </Text>
        )}

        <p className={styles.prompt}>{card.promptText}</p>

        {card.instructionText && (
          <p className={styles.instruction}>{card.instructionText}</p>
        )}
      </div>

      <div className={styles.col}>
        {spoken ? (
          <div className={styles.verdict}>
            <div className={styles.model}>
              <Text variant="label" className={styles.modelLabel}>
                {t("review.modelLabel")}
              </Text>
              {card.modelAnswerText ? (
                <p className={styles.modelText}>{card.modelAnswerText}</p>
              ) : (
                <Text variant="body-s" color="ink-soft">
                  {t("review.noModel")}
                </Text>
              )}
            </div>

            <Text variant="body" weight="semibold">
              {t("review.verdictQuestion")}
            </Text>

            <div className={styles.verdictActions}>
              <Button
                variant="success"
                size="lg"
                loading={busy}
                onClick={() => onAnswer("good")}
              >
                {t("review.good")}
              </Button>
              <Button
                variant="secondary"
                size="lg"
                disabled={busy}
                onClick={() => onAnswer("again")}
              >
                {t("review.again")}
              </Button>
            </div>

            {error && (
              <Text variant="body-s" className={styles.error} role="alert">
                {error}
              </Text>
            )}
          </div>
        ) : (
          <div className={styles.speak}>
            <div className={styles.speakHead}>
              <Text variant="body" weight="semibold">
                {t("review.speakTitle")}
              </Text>
              <Text variant="body-s" color="muted">
                {t("review.speakHint")}
              </Text>
            </div>

            <Recorder
              maxDurationMs={MAX_REPLAY_MS}
              onComplete={() => setSpoken(true)}
            />

            {/* A microphone is not a precondition for revision. This is the way
                through for a denied mic, a shared room, or a student who simply
                said it out loud without pressing record. */}
            <Button
              variant="ghost"
              size="sm"
              className={styles.reveal}
              onClick={() => setSpoken(true)}
            >
              {t("review.revealCta")}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Terminal states                                                            */
/* -------------------------------------------------------------------------- */

function DoneState({
  answered,
  remaining,
  onExit,
}: {
  answered: number;
  remaining: number;
  onExit: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Card variant="tint" padding="lg" className={styles.state}>
      <Mascot mood="proud" size={96} />
      <div className={styles.stateText}>
        <Text as="h2" variant="title-m" weight="black">
          {t("review.done.title")}
        </Text>
        <Text variant="body" color="ink-soft">
          {t("review.done.body", { count: answered })}
        </Text>
        {remaining > 0 && (
          <Text variant="body-s" color="muted">
            {t("review.done.remaining", { count: remaining })}
          </Text>
        )}
      </div>
      <div className={styles.stateActions}>
        <Button variant="primary" size="lg" onClick={onExit}>
          {t("review.done.cta")}
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
          {t("review.empty.title")}
        </Text>
        <Text variant="body" color="ink-soft">
          {t("review.empty.body")}
        </Text>
      </div>
      <div className={styles.stateActions}>
        <Button variant="primary" size="lg" onClick={onExit}>
          {t("review.empty.cta")}
        </Button>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Default export — a self-wired demo, renderable in isolation.               */
/* -------------------------------------------------------------------------- */

/**
 * ReviewDrillScreenDemo — drop-in standalone preview wired to the mock cards, so
 * the whole prompt → speak → verdict loop renders with no backend.
 */
export default function ReviewDrillScreenDemo() {
  const [index, setIndex] = useState(0);
  const finished = index >= mockDrillCards.length;
  return (
    <ReviewDrillScreen
      card={finished ? null : mockDrillCards[index]}
      position={Math.min(index + 1, mockDrillCards.length)}
      sessionSize={mockDrillCards.length}
      dueCount={mockDrillCards.length - index}
      answered={index}
      finished={finished}
      onAnswer={() => setIndex((i) => i + 1)}
      onExit={() => undefined}
      onNavigate={() => undefined}
    />
  );
}
