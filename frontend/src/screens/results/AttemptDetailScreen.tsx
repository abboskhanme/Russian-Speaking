import { Suspense, lazy, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { AiCorrection, AiFeedback } from "../../app/adapters";
import { Badge, Button, Card, Mascot, ProgressRing, Text } from "../../shared/ui";
import { useCountUp } from "../../shared/ui/utils/motion";
import { scoreBand, scoreTone } from "../../shared/score/scoreBand";
import { Page } from "../../widgets";
import type { NavItem } from "../../widgets";
import { FeedbackLangNote } from "../../widgets/FeedbackLangNote";
import { formatDateTime } from "../../shared/format/date";
import { AudioPlayer } from "../../shared/ui/AudioPlayer";
import { RegradeButton } from "./RegradeButton";
import styles from "./AttemptDetailScreen.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

/** One graded attempt, mapped from `AttemptDetailResponse`. Scores are 0..100. */
export interface AttemptDetail {
  id: string;
  status: string;
  createdAt: string;
  questionTitle: string | null;
  questionLevel: string | null;
  questionTopic: string | null;
  audioUrl: string | null;
  audioDurationSec: number | null;
  audioExpired: boolean;
  transcript: string | null;
  band: number | null;
  fluency: number | null;
  lexical: number | null;
  grammar: number | null;
  pronunciation: number | null;
  relevance: number | null;
  /** The AI's structured feedback, ALREADY PARSED by the page. The API column
   * holds a JSON `GraderResult`, so passing the raw string here rendered a blob. */
  feedback: AiFeedback | null;
  /** The AI's targeted corrections, already parsed for the same reason. */
  corrections: AiCorrection[];
  modelAnswer: string | null;
  teacherBand: number | null;
  teacherComment: string | null;
  /**
   * When a teacher signed the attempt off, or null. A teacher's quick confirm
   * writes neither a band nor a comment — only this — so it is shown as a
   * "O'qituvchi tekshirdi" badge rather than as an empty comment block.
   */
  reviewedAt?: string | null;
}

export interface AttemptDetailScreenProps {
  detail: AttemptDetail;
  /** Header back → returns to the results list. */
  onBack: () => void;
  activeNavKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
  /** Why grading failed, already localized — shown instead of the bare status. */
  failedReason?: string;
  /** Retry a failed attempt's grading (same recording, no attempt spent). Rejects
   * with an already-localized Error. Absent ⇒ no retry control. */
  onRegrade?: () => Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * AttemptDetailScreen (`/results/:id`) — one attempt's full detail: the recorded
 * audio, the transcript of what the student said, the AI score breakdown (overall
 * band + per-criterion bars), the feedback/corrections, and any teacher review.
 * The deepest level of the results drill-down (Profile → Barcha natijalar → here).
 * Presentational + prop-driven; the page fetches. Full-width; tokens only.
 */
export function AttemptDetailScreen({
  detail,
  onBack,
  failedReason,
  onRegrade,
}: AttemptDetailScreenProps) {
  const { t, i18n } = useTranslation();
  const graded = detail.status === "done" && detail.band !== null;

  const scores: Array<{ key: string; value: number }> = [
    ["fluency", detail.fluency],
    ["lexical", detail.lexical],
    ["grammar", detail.grammar],
    ["pronunciation", detail.pronunciation],
    ["relevance", detail.relevance],
  ]
    .filter((s): s is [string, number] => typeof s[1] === "number")
    .map(([key, value]) => ({ key, value }));

  return (
    <Page
      headerStart={
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          aria-label={t("common.back")}
          className={styles.back}
        >
          <BackGlyph />
        </Button>
      }
    >
      <div className={styles.page}>
        {/* ---- Hero: band · question · level · date ---- */}
        <Card variant="panel" padding="lg" className={styles.hero}>
          <ScoreRing band={graded ? detail.band : null} />
          <div className={styles.heroBody}>
            <Text as="h1" variant="title-m" className={styles.heroTitle}>
              {detail.questionTitle ?? t("results.attempt")}
            </Text>
            <div className={styles.heroMeta}>
              {detail.questionLevel && (
                <Badge variant="accent" size="sm">
                  {detail.questionLevel}
                </Badge>
              )}
              <Text as="span" variant="body-s" color="muted">
                {formatDate(i18n.language, detail.createdAt)}
              </Text>
              {detail.reviewedAt && (
                <Badge variant="success" size="sm">
                  {t("results.teacherChecked")}
                </Badge>
              )}
            </div>
          </div>
        </Card>

        {graded && detail.band !== null && (
          <MascotReaction band={detail.band} attemptId={detail.id} />
        )}

        {!graded && (
          <Text as="p" variant="body-s" color={detail.status === "failed" ? "danger" : "muted"}>
            {detail.status === "failed" && failedReason
              ? t("results.notGradedReason", { reason: failedReason })
              : t(`results.status.${detail.status}`, { defaultValue: t("results.status.pending") })}
          </Text>
        )}
        {detail.status === "failed" && onRegrade && <RegradeButton onRegrade={onRegrade} />}

        {/* ---- Recorded audio ---- */}
        <Section title={t("results.audio")}>
          <AudioPlayer
            src={detail.audioUrl}
            label={t("results.audio")}
            unavailableLabel={detail.audioExpired ? t("results.audioExpired") : t("results.audioNone")}
          />
        </Section>

        {/* ---- Transcript ---- */}
        {detail.transcript && (
          <Section title={t("results.transcript")}>
            <Card variant="tint" padding="md">
              <Text as="p" variant="body">
                {detail.transcript}
              </Text>
            </Card>
          </Section>
        )}

        {/* ---- Score breakdown ---- */}
        {scores.length > 0 && (
          <Section title={t("results.scores")}>
            <div className={styles.scores}>
              {scores.map((s) => (
                <ScoreBar key={s.key} label={t(`results.criteria.${s.key}`)} value={s.value} />
              ))}
            </div>
          </Section>
        )}

        {/* ---- AI feedback ---- */}
        {detail.feedback && (
          <Section title={t("results.feedback")}>
            <div className={styles.fbBlock}>
              <FeedbackLangNote lang={detail.feedback.lang} />
              {detail.feedback.summary && (
                <Text as="p" variant="body" className={styles.prose}>
                  {detail.feedback.summary}
                </Text>
              )}
              {detail.feedback.strengths.length > 0 && (
                <ul className={styles.fbBullets}>
                  {detail.feedback.strengths.map((s, i) => (
                    <li key={i}>
                      <Text as="span" variant="body-s" color="ink-soft">{s}</Text>
                    </li>
                  ))}
                </ul>
              )}
              {detail.feedback.improvements.length > 0 && (
                <ul className={styles.fbBullets}>
                  {detail.feedback.improvements.map((s, i) => (
                    <li key={i}>
                      <Text as="span" variant="body-s" color="ink-soft">{s}</Text>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Section>
        )}

        {/* ---- Corrections ---- */}
        {detail.corrections.length > 0 && (
          <Section title={t("results.corrections")}>
            <div className={styles.fbBlock}>
              {detail.corrections.map((c, i) => (
                <div key={i}>
                  <p className={styles.corrLine}>
                    {c.original && <span className={styles.corrWrong}>{c.original}</span>}
                    {c.original && c.corrected && <span>→</span>}
                    {c.corrected && <span className={styles.corrRight}>{c.corrected}</span>}
                  </p>
                  {c.explanation && (
                    <Text as="p" variant="body-s" color="ink-soft">{c.explanation}</Text>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ---- Model answer ---- */}
        {detail.modelAnswer && (
          <Section title={t("results.modelAnswer")}>
            <Card variant="tint" padding="md">
              <Text as="p" variant="body">
                {detail.modelAnswer}
              </Text>
            </Card>
          </Section>
        )}

        {/* ---- Teacher review ---- */}
        {(detail.teacherComment || detail.teacherBand !== null) && (
          <Section title={t("results.teacher")}>
            {detail.teacherBand !== null && (
              <Text as="p" variant="title-s" numeric>
                {t("results.teacherBand", { band: Math.round(detail.teacherBand) })}
              </Text>
            )}
            {detail.teacherComment && (
              <Text as="p" variant="body" className={styles.prose}>
                {detail.teacherComment}
              </Text>
            )}
          </Section>
        )}
      </div>
    </Page>
  );
}

/* -------------------------------------------------------------------------- */
/* Bits                                                                        */
/* -------------------------------------------------------------------------- */

/** The confetti is its own lazy chunk: only a great score ever downloads it. */
const Confetti = lazy(() => import("../../shared/ui/Confetti/Confetti"));

/** The band as a ring that fills while the number counts up (--dur-countup),
 * coloured by the score's band. Reduced motion: both land at once. */
function ScoreRing({ band }: { band: number | null }) {
  const shown = useCountUp(band === null ? null : Math.round(band));
  return (
    <ProgressRing
      value={shown === null ? 0 : shown / 100}
      size={88}
      stroke={8}
      tone={band === null ? "primary" : scoreTone(band)}
      className={styles.scoreRing}
    >
      <Text as="span" variant="title-l" numeric className={styles.bandNum}>
        {shown === null ? "—" : shown}
      </Text>
    </ProgressRing>
  );
}

/**
 * Govo reacts to the score: proud and cheering on a good one, kind and
 * encouraging on a weak one — never sad, never mocking (docs/03 §3.2). A great
 * score also gets a short confetti burst, once per attempt per session.
 */
function MascotReaction({ band, attemptId }: { band: number; attemptId: string }) {
  const { t } = useTranslation();
  const b = scoreBand(band);
  const [celebrate] = useState(() => {
    if (b !== "great") return false;
    const key = `govori-cheered:${attemptId}`;
    try {
      if (sessionStorage.getItem(key)) return false;
      sessionStorage.setItem(key, "1");
    } catch {
      /* storage blocked — celebrating once more is harmless */
    }
    return true;
  });
  return (
    <div className={styles.reaction} data-band={b}>
      <Mascot mood={b === "great" || b === "good" ? "proud" : "idle"} size={64} label="" />
      <p className={styles.bubble}>{t(`motivation.react.${b}`)}</p>
      {celebrate && (
        <Suspense fallback={null}>
          <Confetti />
        </Suspense>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <Text as="h2" variant="label" color="muted" className={styles.sectionLabel}>
        {title}
      </Text>
      {children}
    </section>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={styles.scoreRow}>
      <div className={styles.scoreHead}>
        <Text as="span" variant="body-s">
          {label}
        </Text>
        <Text as="span" variant="body-s" numeric weight="bold" className={styles.scoreVal}>
          {Math.round(value)}
        </Text>
      </div>
      <span className={styles.scoreTrack} aria-hidden>
        <span className={styles.scoreFill} style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}

/** "23.07.2026, 11:15" — the shared helper (24-hour, same in every language). */
function formatDate(_lang: string, iso: string): string {
  return formatDateTime(iso);
}

function BackGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
      <path
        d="M15 5l-7 7 7 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
