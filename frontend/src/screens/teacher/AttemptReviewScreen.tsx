import { Fragment, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, Modal, Text, cx } from "../../shared/ui";
import { AppShell, Brand, NotificationsBell, teacherNavItems } from "../../widgets";
import type { NavItem } from "../../widgets";
import type { AiCorrection, AiFeedback } from "../../app/adapters";
import { mockAttemptReview } from "./queue.mock";
import { BackGlyph } from "./TeacherGroupDetailScreen";
import styles from "./AttemptReviewScreen.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

/** One transcript word with its pronunciation accuracy. */
export interface ReviewWord {
  word: string;
  /** 0–100; absent when the provider gave none. */
  accuracy?: number;
}

/** An AI sub-skill score, shown read-only as context for the manual verdict. */
export interface ReviewCriterion {
  key: string;
  label: string;
  score: number;
}

export interface AttemptReviewProps {
  studentName: string;
  /** "Do'konda xarid · A2" — task + level, assembled by the caller. */
  taskLine: string;
  /** AI band 0–100. Absent when grading produced no score. */
  score?: number;
  /** Presigned audio URL; null once the retention job has purged the recording. */
  audioUrl?: string | null;
  /** Localized caption when the audio is gone. */
  audioExpiredLabel?: string;
  /** The plain transcript — the fallback when there is no per-word data. */
  transcript?: string | null;
  /** Per-word transcript. Empty ⇒ render `transcript` as one paragraph. */
  words: ReviewWord[];
  /** AI sub-skill scores, read-only. */
  criteria: ReviewCriterion[];
  /** The AI's targeted corrections, already parsed out of the JSON column. */
  corrections: AiCorrection[];
  /** The AI's structured feedback, already parsed. Null when there is none. */
  feedback: AiFeedback | null;
  /** Existing teacher verdict, when the attempt was already reviewed. */
  teacherBand?: number | null;
  teacherComment?: string | null;
  reviewed: boolean;
  activeNavKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
  queuedCount?: number;
  onBack?: () => void;
  /**
   * Save the verdict — ONLY the parts the teacher changed. `band` is present only
   * when the slider was moved (absent ⇒ the AI's score stands), `comment` only when
   * the note was edited. Rejects on failure so the form can surface it and keep
   * the text.
   */
  onSave?: (args: { band?: number; comment?: string }) => Promise<void>;
  /** "Tasdiqlash ✓" — accept the AI's score as it stands. Writes no comment.
   * Not offered once the attempt is reviewed (it would only re-stamp the same
   * verdict) nor on a failed attempt (there is no AI score to accept). */
  onConfirm?: () => Promise<void>;
  /** Grading FAILED for this attempt: the localized reason. Replaces the confirm
   * action with a regrade (when {@link onRegrade} is given). */
  failedReason?: string;
  /** Put a failed attempt back through grading (same recording, no new attempt).
   * Rejects with a localized message, which the screen shows inline. */
  onRegrade?: () => Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * AttemptReviewScreen — **B2 «Javob detali · so'zma-so'z»** plus **B3 «Qo'lda
 * baholash»** as a full-screen sheet (`Govorim - Teacher.dc.html`).
 *
 * Audio, the word-by-word transcript coloured by pronunciation accuracy, the AI's
 * scores and its correction/feedback, then the two bottom actions: accept the
 * AI's score, or open B3 and grade by hand.
 *
 * **The transcript is reproduced exactly as the student said it.** Words are
 * coloured and underlined by accuracy, never rewritten or replaced with the
 * expected word — the transcript's only value is that it is faithful. Corrections
 * live in their own card beside it.
 *
 * **B3 writes ONE overall band, not the mockup's three sliders.** `submissions`
 * carries a single `teacher_band`; per-criterion overrides would need three more
 * columns plus a roll-up rule. So the AI's per-criterion scores are shown
 * read-only — the information the sliders were there to convey — and the teacher
 * sets the overall band.
 *
 * **Colour is never the only signal**: each accuracy tier also carries a distinct
 * underline (solid / dotted / wavy), per docs/03 §3.3.
 */
export function AttemptReviewScreen({
  studentName,
  taskLine,
  score,
  audioUrl,
  audioExpiredLabel,
  transcript,
  words,
  criteria,
  corrections,
  feedback,
  teacherBand,
  teacherComment,
  reviewed,
  activeNavKey = "queue",
  onNavigate,
  queuedCount = 0,
  onBack,
  onSave,
  onConfirm,
  failedReason,
  onRegrade,
}: AttemptReviewProps) {
  const { t } = useTranslation();
  const [grading, setGrading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [regrading, setRegrading] = useState(false);
  const [regradeError, setRegradeError] = useState<string | null>(null);

  const regrade = async () => {
    if (regrading || !onRegrade) return;
    setRegrading(true);
    setRegradeError(null);
    try {
      await onRegrade();
    } catch (e) {
      setRegradeError(e instanceof Error ? e.message : String(e));
    } finally {
      setRegrading(false);
    }
  };

  const confirm = async () => {
    if (confirming) return;
    setConfirming(true);
    try {
      await onConfirm?.();
    } finally {
      setConfirming(false);
    }
  };

  return (
    <AppShell
      brand={<Brand />}
      nav={{
        items: teacherNavItems(t, queuedCount),
        activeKey: activeNavKey,
        onNavigate,
        label: t("nav.landmark"),
      }}
      headerStart={
        <Text as="h1" variant="title-m">
          {t("nav.queue")}
        </Text>
      }
      headerEnd={<NotificationsBell />}
    >
      <div className={styles.page} data-density="compact">
        <header className={styles.head}>
          <button
            type="button"
            className={styles.back}
            onClick={onBack}
            aria-label={t("common.back")}
          >
            <BackGlyph />
          </button>
          <div className={styles.headText}>
            <Text as="h2" variant="title-s" truncate>
              {studentName}
            </Text>
            <Text as="p" variant="body-s" color="muted" truncate>
              {taskLine}
            </Text>
          </div>
          <span
            className={cx(
              styles.scoreBox,
              score != null ? styles[`box-${scoreTone(score)}` as const] : styles.boxNone,
            )}
            aria-hidden
          >
            <Text as="span" variant="body" weight="black" numeric>
              {score != null ? Math.round(score) : "—"}
            </Text>
          </span>
        </header>

        {reviewed && (
          <Card variant="flat" padding="sm" className={styles.reviewedNote} role="status">
            <CheckGlyph />
            <Text as="p" variant="body-s" weight="semibold">
              {teacherBand != null
                ? t("teacher.alreadyReviewedBand", { band: Math.round(teacherBand) })
                : t("teacher.alreadyReviewed")}
            </Text>
          </Card>
        )}

        {failedReason && (
          <Card variant="flat" padding="sm" className={styles.failedNote} role="status">
            <Text as="p" variant="body-s" weight="semibold">
              {failedReason}
            </Text>
            {regradeError && (
              <Text as="p" variant="body-s">
                {regradeError}
              </Text>
            )}
          </Card>
        )}

        <AudioBlock url={audioUrl} expiredLabel={audioExpiredLabel} />

        <TranscriptCard transcript={transcript} words={words} />

        {criteria.length > 0 && (
          <Card variant="outline" padding="md" className={styles.criteria}>
            <Text as="h3" variant="label" color="muted">
              {t("teacher.aiScores")}
            </Text>
            {criteria.map((c) => (
              <div key={c.key} className={styles.critRow}>
                <Text as="span" variant="body-s" weight="semibold" className={styles.critLabel}>
                  {c.label}
                </Text>
                <div className={styles.track}>
                  <div
                    className={cx(styles.fill, styles[`fill-${scoreTone(c.score)}` as const])}
                    style={{ width: `${clamp(c.score)}%` }}
                  />
                </div>
                <Text as="span" variant="body-s" weight="black" numeric className={styles.critScore}>
                  {Math.round(c.score)}
                </Text>
              </div>
            ))}
          </Card>
        )}

        {corrections.length > 0 && (
          <Card variant="outline" padding="md" className={styles.aiCard}>
            <Text as="h3" variant="label" color="muted">
              {t("teacher.aiFound")}
            </Text>
            {corrections.map((c, i) => (
              <div key={i} className={styles.correction}>
                <p className={styles.correctionLine}>
                  {c.original && <span className={styles.wrong}>{c.original}</span>}
                  {c.original && c.corrected && <span className={styles.arrow}>→</span>}
                  {c.corrected && <span className={styles.right}>{c.corrected}</span>}
                </p>
                {c.explanation && (
                  <Text as="p" variant="body-s" color="ink-soft">
                    {c.explanation}
                  </Text>
                )}
              </div>
            ))}
          </Card>
        )}

        {feedback && (
          <Card variant="outline" padding="md" className={styles.aiCard}>
            <Text as="h3" variant="label" color="muted">
              {t("teacher.aiFeedback")}
            </Text>
            {feedback.summary && (
              <Text as="p" variant="body-s">
                {feedback.summary}
              </Text>
            )}
            {feedback.strengths.length > 0 && (
              <FeedbackList label={t("teacher.strengths")} items={feedback.strengths} tone="success" />
            )}
            {feedback.improvements.length > 0 && (
              <FeedbackList label={t("teacher.improvements")} items={feedback.improvements} tone="warn" />
            )}
            {feedback.vocabulary.length > 0 && (
              <div className={styles.vocabWrap}>
                <Text as="h4" variant="label" color="muted">
                  {t("teacher.vocabulary")}
                </Text>
                <div className={styles.vocabRow}>
                  {feedback.vocabulary.map((w) => (
                    <span key={w} className={styles.vocabChip}>
                      <Text as="span" variant="mono">
                        {w}
                      </Text>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </Card>
        )}

        {teacherComment && (
          <Card variant="outline" padding="md" className={styles.aiCard}>
            <Text as="h3" variant="label" color="muted">
              {t("teacher.yourComment")}
            </Text>
            <Text as="p" variant="body-s">
              {teacherComment}
            </Text>
          </Card>
        )}

        <div className={styles.bottomBar}>
          {/* The actions follow the attempt's state (bug 7). A reviewed attempt
              can only have its grade CHANGED — "Tasdiqlash" would just re-stamp the
              same verdict. A failed one has no AI score to accept, so its primary
              action is to grade it again. */}
          <Button
            variant="secondary"
            onClick={() => setGrading(true)}
            disabled={confirming || regrading}
            className={reviewed ? styles.confirmBtn : undefined}
          >
            {reviewed ? t("uiDash.review.changeGrade") : t("teacher.gradeManually")}
          </Button>
          {failedReason
            ? onRegrade && (
                <Button
                  variant="primary"
                  className={styles.confirmBtn}
                  loading={regrading}
                  onClick={() => void regrade()}
                >
                  {t("uiDash.regrade.action")}
                </Button>
              )
            : !reviewed && (
                <Button
                  variant="primary"
                  className={styles.confirmBtn}
                  loading={confirming}
                  onClick={() => void confirm()}
                >
                  {t("teacher.confirm")} ✓
                </Button>
              )}
        </div>
      </div>

      <ManualGradeSheet
        open={grading}
        onClose={() => setGrading(false)}
        initialBand={teacherBand ?? score ?? 60}
        initialComment={teacherComment ?? ""}
        criteria={criteria}
        onSave={onSave}
      />
    </AppShell>
  );
}

/** The tick on the "already reviewed" banner — the banner's tone is not only its colour. */
function CheckGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden className={styles.reviewedIcon}>
      <path
        d="m5 12.5 4.5 4.5L19 7.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Audio                                                                      */
/* -------------------------------------------------------------------------- */

function AudioBlock({ url, expiredLabel }: { url?: string | null; expiredLabel?: string }) {
  const { t } = useTranslation();
  if (!url) {
    return (
      <Card variant="flat" padding="sm" className={styles.audioGone}>
        <Text as="p" variant="body-s" color="muted">
          {expiredLabel ?? t("teacher.audioExpired")}
        </Text>
      </Card>
    );
  }
  // A plain native player: it gives seek, speed and volume for free, and works on
  // every mobile browser without a bespoke transport.
  return <audio className={styles.audio} controls preload="metadata" src={url} />;
}

/* -------------------------------------------------------------------------- */
/* Transcript                                                                 */
/* -------------------------------------------------------------------------- */

function TranscriptCard({
  transcript,
  words,
}: {
  transcript?: string | null;
  words: ReviewWord[];
}) {
  const { t } = useTranslation();
  const hasWords = words.length > 0;

  if (!hasWords && !transcript) {
    return (
      <Card variant="flat" padding="md" className={styles.audioGone}>
        <Text as="p" variant="body-s" color="muted">
          {t("teacher.noTranscript")}
        </Text>
      </Card>
    );
  }

  return (
    <Card variant="flat" padding="md" className={styles.transcriptCard}>
      <Text as="h3" variant="label" color="muted">
        {t("teacher.transcript")}
      </Text>

      {hasWords ? (
        <p className={styles.transcript}>
          {words.map((w, i) => (
            <Fragment key={`${i}-${w.word}`}>
              {/* A REAL space between words, not a margin. Spans with nothing
                  between them form one unbreakable run: the line never wrapped
                  (585px of text in a 356px card on a phone) and a copied
                  transcript came out as one glued word. */}
              {i > 0 && " "}
              <span
                className={cx(styles.word, styles[`pron-${pronTier(w.accuracy)}` as const])}
                // The number stays available to assistive tech and on hover, so the
                // colour/underline is a cue rather than the only carrier.
                title={w.accuracy != null ? `${w.word} · ${Math.round(w.accuracy)}` : w.word}
              >
                {w.word}
              </span>
            </Fragment>
          ))}
        </p>
      ) : (
        <Text as="p" variant="mono" className={styles.transcript}>
          {transcript}
        </Text>
      )}

      {hasWords && (
        <div className={styles.legend}>
          <LegendChip tier="good" label={t("teacher.pronGood")} />
          <LegendChip tier="mid" label={t("teacher.pronMid")} />
          <LegendChip tier="low" label={t("teacher.pronLow")} />
        </div>
      )}
    </Card>
  );
}

function LegendChip({ tier, label }: { tier: PronTier; label: string }) {
  return (
    <span className={styles.legendChip}>
      <span className={cx(styles.legendSwatch, styles[`pron-${tier}` as const])} aria-hidden>
        Aa
      </span>
      <Text as="span" variant="body-s" color="muted">
        {label}
      </Text>
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* B3 — Qo'lda baholash                                                       */
/* -------------------------------------------------------------------------- */

function ManualGradeSheet({
  open,
  onClose,
  initialBand,
  initialComment,
  criteria,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  initialBand: number;
  initialComment: string;
  criteria: ReviewCriterion[];
  onSave?: (args: { band?: number; comment?: string }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [band, setBand] = useState(Math.round(initialBand));
  const [comment, setComment] = useState(initialComment);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstOpen = useRef(true);

  // Re-seed when the sheet opens, so reopening after a save shows the saved state
  // rather than whatever was typed and discarded last time.
  useEffect(() => {
    if (open && firstOpen.current) {
      setBand(Math.round(initialBand));
      setComment(initialComment);
      setError(null);
    }
    firstOpen.current = !open;
  }, [open, initialBand, initialComment]);

  // Only what the teacher actually changed goes out. The slider always HAS a value
  // (it starts on the AI's band), so sending it unconditionally turned every
  // "comment only" save into a rounded manual override of the AI's score — the
  // gradebook then showed the teacher's 72 where the AI had said 71.6.
  const bandMoved = band !== Math.round(initialBand);
  const commentChanged = comment.trim() !== initialComment.trim();
  const changed = bandMoved || commentChanged;

  const save = async () => {
    if (busy || !changed) return;
    setBusy(true);
    setError(null);
    try {
      await onSave?.({
        ...(bandMoved ? { band } : {}),
        ...(commentChanged ? { comment: comment.trim() } : {}),
      });
      onClose();
    } catch {
      setError(t("teacher.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title={t("teacher.gradeManually")}
      closeLabel={t("common.close")}
      size="full"
    >
      <div className={styles.sheet}>
        <div>
          <div className={styles.bandHead}>
            <Text as="span" variant="body" weight="semibold">
              {t("teacher.overallBand")}
            </Text>
            <Text
              as="span"
              variant="title-s"
              weight="black"
              numeric
              className={styles[`band-${scoreTone(band)}` as const]}
            >
              {band}
            </Text>
          </div>
          <input
            className={styles.slider}
            type="range"
            min={0}
            max={100}
            step={1}
            value={band}
            onChange={(e) => setBand(Number(e.target.value))}
            aria-label={t("teacher.overallBand")}
          />
        </div>

        {criteria.length > 0 && (
          <div className={styles.aiRef}>
            <Text as="h3" variant="label" color="muted">
              {t("teacher.aiScores")}
            </Text>
            <div className={styles.aiRefRow}>
              {criteria.map((c) => (
                <span key={c.key} className={styles.aiChip}>
                  <Text as="span" variant="body-s" color="muted">
                    {c.label}
                  </Text>
                  <Text as="span" variant="body-s" weight="bold" numeric>
                    {Math.round(c.score)}
                  </Text>
                </span>
              ))}
            </div>
            {/* Say plainly that these are the AI's numbers and not editable —
                otherwise they read like controls that silently do nothing. */}
            <Text as="p" variant="body-s" color="muted">
              {t("teacher.aiScoresReadonly")}
            </Text>
          </div>
        )}

        <div className={styles.commentBlock}>
          <Text as="h3" variant="label" color="muted">
            {t("teacher.commentLabel")}
          </Text>
          <textarea
            className={styles.textarea}
            rows={5}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t("teacher.commentPlaceholder")}
            aria-label={t("teacher.commentLabel")}
          />
          {error && (
            <Text as="p" variant="body-s" color="danger" role="alert">
              {error}
            </Text>
          )}
        </div>

        <div className={styles.sheetActions}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={busy} disabled={!changed} onClick={() => void save()}>
            {t("teacher.saveReview")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** A titled bullet list inside the feedback card. */
function FeedbackList({
  label,
  items,
  tone,
}: {
  label: string;
  items: string[];
  tone: "success" | "warn";
}) {
  return (
    <div className={styles.fbList}>
      <Text as="h4" variant="label" color="muted">
        {label}
      </Text>
      <ul className={cx(styles.bullets, styles[`bullets-${tone}` as const])}>
        {items.map((it, i) => (
          <li key={i}>
            <Text as="span" variant="body-s" color="ink-soft">
              {it}
            </Text>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Local helpers                                                              */
/* -------------------------------------------------------------------------- */

type ScoreTone = "success" | "warn" | "danger";
type PronTier = "good" | "mid" | "low" | "none";

function scoreTone(score: number): ScoreTone {
  if (score >= 75) return "success";
  if (score >= 60) return "warn";
  return "danger";
}

/** Accuracy → the docs/03 §3.3 pronunciation tier. No score ⇒ neutral. */
function pronTier(accuracy?: number): PronTier {
  if (accuracy == null) return "none";
  if (accuracy >= 80) return "good";
  if (accuracy >= 65) return "mid";
  return "low";
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}

/* -------------------------------------------------------------------------- */
/* Default export — a self-wired demo.                                        */
/* -------------------------------------------------------------------------- */

export default function AttemptReviewDemo() {
  return <AttemptReviewScreen {...mockAttemptReview} />;
}
