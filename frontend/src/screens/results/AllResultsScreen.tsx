import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Button, Card, EmptyState, Text, VisuallyHidden, cx } from "../../shared/ui";
import { scoreTone } from "../../shared/score/scoreBand";
import { Page } from "../../widgets";
import type { NavItem } from "../../widgets";
import { formatRelativeDay } from "../../shared/format/date";
import styles from "./AllResultsScreen.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

export type ResultTrend = "up" | "down" | "flat";

/** Where an attempt stands. Only a `graded` one has a band and a trend. */
export type AllResultsStatus = "graded" | "grading" | "failed";

/** One row of the full history — the Profile "recent" row shape, plus the
 * attempts that never got a score. */
export interface AllResultsItem {
  id: string;
  title: string;
  status: AllResultsStatus;
  /** Rounded band, 0..100 — null unless graded. */
  band: number | null;
  createdAt: string;
  /** Versus the previous graded attempt; absent unless graded. */
  trend?: ResultTrend;
  /** A failed attempt's reason, already localized. */
  reason?: string;
}

export interface AllResultsScreenProps {
  /** Every attempt, newest first — graded, still grading, and failed. */
  results: AllResultsItem[];
  /** Open one attempt's detail by submission id. */
  onOpenResult: (id: string) => void;
  /** Header back → returns to the Profile. */
  onBack: () => void;
  /** The empty state's one action ("start practising"). */
  onStartPractice?: () => void;
  activeNavKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * AllResultsScreen (`/results`) — the full "Barcha natijalar" history: every
 * attempt as a tappable row (band · title · when · trend), each opening the
 * attempt detail. Reached from the Profile → Natijalar "Barcha natijalar" button
 * and from the task screen when grading outlives its wait.
 *
 * Attempts that never got a score are rows too: "baholanmoqda" while grading
 * runs, "baholanmadi" + the reason when it failed. They used to be left out, so
 * the Profile counted 24 attempts over a list of 22 and a failed answer simply
 * vanished. Presentational + prop-driven; the page fetches. Full-width; every
 * colour / space / radius is a token.
 */
export function AllResultsScreen({
  results,
  onOpenResult,
  onBack,
  onStartPractice,}: AllResultsScreenProps) {
  const { t } = useTranslation();
  const now = useMemo(() => new Date(), []);

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
        <header className={styles.head}>
          <Text as="h1" variant="title-l" className={styles.title}>
            {t("results.allTitle")}
          </Text>
          <Text as="p" variant="body-s" color="muted" numeric>
            {t("results.count", { count: results.length })}
          </Text>
        </header>

        {results.length === 0 ? (
          <EmptyState
            title={t("motivation.empty.resultsTitle")}
            body={t("motivation.empty.resultsBody")}
            actionLabel={t("motivation.empty.startPractice")}
            onAction={onStartPractice}
            mood="sleepy"
          />
        ) : (
          <Card variant="panel" padding="none" className={styles.listCard}>
            <ul className={styles.list}>
              {results.map((r) => (
                <li key={r.id} className={styles.item}>
                  <button
                    type="button"
                    className={styles.rowBtn}
                    onClick={() => onOpenResult(r.id)}
                    aria-label={t("profile.results.openAria", { title: r.title })}
                  >
                    <span
                      // Coloured by the score's band — a 0 is never success green.
                      className={cx(
                        styles.bandDot,
                        r.band === null ? styles.bandDotMuted : TONE_CLASS[scoreTone(r.band)],
                      )}
                      data-tone={r.band === null ? undefined : scoreTone(r.band)}
                      aria-hidden
                    >
                      <Text as="span" variant="title-s" numeric>
                        {r.band ?? "—"}
                      </Text>
                    </span>
                    <span className={styles.text}>
                      <Text as="span" variant="title-s" truncate>
                        {r.title}
                      </Text>
                      <Text as="span" variant="body-s" color="muted">
                        {relativeDate(t, r.createdAt, now)}
                      </Text>
                      {r.status === "grading" && (
                        <Text as="span" variant="body-s" color="info">
                          {t("results.status.pending")}
                        </Text>
                      )}
                      {r.status === "failed" && (
                        <Text as="span" variant="body-s" color="danger">
                          {r.reason
                            ? t("results.notGradedReason", { reason: r.reason })
                            : t("results.notGraded")}
                        </Text>
                      )}
                    </span>
                    <span className={styles.trendCell}>
                      {r.trend && (
                        <>
                          <VisuallyHidden>{trendLabel(t, r.trend)}</VisuallyHidden>
                          <span className={cx(styles.trend, TREND_CLASS[r.trend])} aria-hidden>
                            {TREND_ARROW[r.trend]}
                          </span>
                        </>
                      )}
                      <span className={styles.chevron} aria-hidden>
                        <ChevronGlyph />
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </Page>
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

const TONE_CLASS = {
  success: styles.bandSuccess,
  warn: styles.bandWarn,
  danger: styles.bandDanger,
} as const;

const TREND_ARROW: Record<ResultTrend, string> = { up: "↑", down: "↓", flat: "→" };
const TREND_CLASS: Record<ResultTrend, string> = {
  up: styles.trendUp,
  down: styles.trendDown,
  flat: styles.trendFlat,
};

function trendLabel(t: TFunction, trend: ResultTrend): string {
  return trend === "up"
    ? t("profile.trend.up")
    : trend === "down"
      ? t("profile.trend.down")
      : t("profile.trend.flat");
}

/** "Bugun" / "Kecha" / "N kun oldin" / "N hafta oldin" / "21.10.2026" — the shared helper. */
function relativeDate(t: TFunction, iso: string, now: Date): string {
  return formatRelativeDay(iso, t, now);
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

function ChevronGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="m9 6 6 6-6 6"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
