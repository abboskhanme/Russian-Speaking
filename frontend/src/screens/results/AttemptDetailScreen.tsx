import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { AiCorrection, AiFeedback } from "../../app/adapters";
import { Badge, Button, Card, Text, cx } from "../../shared/ui";
import { AppShell, Brand, NotificationsBell, studentNavItems } from "../../widgets";
import type { NavItem } from "../../widgets";
import { FeedbackLangNote } from "../../widgets/FeedbackLangNote";
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
  activeNavKey = "profile",
  onNavigate,
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
    <AppShell
      brand={<Brand />}
      nav={{
        items: studentNavItems(t),
        activeKey: activeNavKey,
        onNavigate,
        label: t("nav.landmark"),
      }}
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
      headerEnd={<NotificationsBell />}
    >
      <div className={styles.page}>
        {/* ---- Hero: band · question · level · date ---- */}
        <Card variant="panel" padding="lg" className={styles.hero}>
          <span className={cx(styles.bandRing, !graded && styles.bandRingMuted)} aria-hidden>
            <Text as="span" variant="display" numeric className={styles.bandNum}>
              {graded ? detail.band : "—"}
            </Text>
          </span>
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

        {!graded && (
          <Text as="p" variant="body-s" color="muted">
            {t(`results.status.${detail.status}`, { defaultValue: t("results.status.pending") })}
          </Text>
        )}

        {/* ---- Recorded audio ---- */}
        <Section title={t("results.audio")}>
          {detail.audioUrl ? (
            <audio className={styles.audio} controls preload="metadata" src={detail.audioUrl} />
          ) : detail.audioExpired ? (
            <Text as="p" variant="body-s" color="muted">
              {t("results.audioExpired")}
            </Text>
          ) : (
            <Text as="p" variant="body-s" color="muted">
              {t("results.audioNone")}
            </Text>
          )}
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
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Bits                                                                        */
/* -------------------------------------------------------------------------- */

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

function formatDate(lang: string, iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // Numeric parts are unambiguous across locales (the `uz` ICU data has no long
  // month names, which renders as "M07"); this reads "23.07.2026, 11:15".
  return new Intl.DateTimeFormat(lang, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
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
