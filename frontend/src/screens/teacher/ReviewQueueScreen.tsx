import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card, Tabs, Text, cx } from "../../shared/ui";
import type { TabItem } from "../../shared/ui";
import { AppShell, Brand, NotificationsBell, teacherNavItems } from "../../widgets";
import type { NavItem } from "../../widgets";
import { mockReviewQueue } from "./queue.mock";
import { initialsOf } from "./TeacherGroupDetailScreen";
import styles from "./ReviewQueueScreen.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

export interface QueueItem {
  id: string;
  studentName: string;
  initials?: string;
  /** Task title. */
  task: string;
  /** CEFR level of the task (e.g. "A2"). */
  level?: string;
  /** AI band 0–100. Absent when grading produced no score. */
  score?: number;
  /** Localized relative time, formatted by the caller. */
  when: string;
  /** Presigned url of the recording; null once the retention job has purged it. */
  audioUrl?: string | null;
}

/**
 * Which slice of the queue is showing.
 *
 *   all → everything awaiting review
 *   low → the weakest answers first (band below the LOW_BAND threshold)
 */
export type QueueFilter = "all" | "low";

/** Answers at or below this band surface under the "Past ball" filter. */
export const LOW_BAND = 60;

export interface ReviewQueueProps {
  items: QueueItem[];
  filter?: QueueFilter;
  onFilterChange?: (f: QueueFilter) => void;
  activeNavKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
  /** Open one attempt (B2). */
  onOpen?: (id: string, item: QueueItem) => void;
  /**
   * "✓ Tasdiqlash" — accept the AI's score as-is. Resolves once the server has
   * recorded the review, so the row can leave the list.
   */
  onConfirm?: (id: string) => Promise<void> | void;
  /**
   * The queue's TRUE size (`GET /api/submissions/review-count`). `items` is one
   * page of it, so the tab label and the FAB badge read this, never
   * `items.length` — a 100-row page printed "100" over a 125-answer queue.
   * Omitted → falls back to `items.length` (mock / story use).
   */
  total?: number;
  /** Fetch the next page. Offered only while `items` is shorter than `total`. */
  onLoadMore?: () => void;
  loadingMore?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * ReviewQueueScreen — **B1 «Tekshirish navbati»**
 * (`docs/design/mockups/Govorim - Teacher.dc.html`), the Navbat FAB's destination.
 *
 * Cards carry the student, the task + level, the AI band, an audio cue, and the
 * two gestures the mockup gives them: confirm the AI's score outright, or open
 * the attempt to look closer.
 *
 * **The mockup's `Ishonch past` and `Shikoyat` filter chips are NOT these
 * filters.** Neither concept exists in the data: there is no AI-confidence value
 * anywhere on `Evaluation`, and no complaint/flag model at all — a chip labelled
 * "Ishonch past" would be sorting by a number we do not have. What IS real is the
 * band itself, so the second filter is **`Past ball`** and says so. The
 * confidence and complaint signals are recorded as backend work rather than
 * mimicked.
 *
 * **"▶ Audio" plays.** It was a styled span that looked exactly like a play
 * button and did nothing. Every list row carries the recording's presigned url,
 * so it is now a real play/pause toggle — ONE shared player for the whole list, so
 * starting a second answer stops the first rather than playing two students at
 * once.
 */
export function ReviewQueueScreen({
  items,
  filter = "all",
  onFilterChange,
  activeNavKey = "queue",
  onNavigate,
  onOpen,
  onConfirm,
  total,
  onLoadMore,
  loadingMore = false,
}: ReviewQueueProps) {
  const { t } = useTranslation();
  const count = total ?? items.length;
  const player = useRef<HTMLAudioElement>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const togglePlay = (item: QueueItem) => {
    const el = player.current;
    if (!el || !item.audioUrl) return;
    if (playingId === item.id) {
      el.pause();
      setPlayingId(null);
      return;
    }
    el.src = item.audioUrl;
    setPlayingId(item.id);
    // play() is a promise in browsers (rejects on autoplay policy / a dead url);
    // either way the button must not stay in "pause" for audio that isn't playing.
    const started = el.play() as Promise<void> | undefined;
    started?.catch(() => setPlayingId(null));
  };

  // Stop playback when the screen goes away (navigating to B2, for instance).
  useEffect(() => () => player.current?.pause(), []);

  const shown = useMemo(
    () => (filter === "low" ? items.filter((i) => i.score != null && i.score <= LOW_BAND) : items),
    [items, filter],
  );

  const tabs: TabItem[] = [
    { key: "all", label: count ? `${t("teacher.qAll")} · ${count}` : t("teacher.qAll") },
    { key: "low", label: t("teacher.qLow") },
  ];

  return (
    <AppShell
      brand={<Brand />}
      nav={{
        items: teacherNavItems(t, count),
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
          <Text as="h2" variant="title-l">
            {t("teacher.answers")}
          </Text>
          <Text as="p" variant="body-s" color="ink-soft">
            {t("teacher.queueIntro")}
          </Text>
        </header>

        <Tabs
          items={tabs}
          activeKey={filter}
          onChange={(k) => onFilterChange?.(k as QueueFilter)}
          aria-label={t("nav.queue")}
        />

        {shown.length === 0 ? (
          <Card variant="flat" padding="md" className={styles.empty}>
            <Text as="p" variant="body" color="muted">
              {items.length === 0 ? t("teacher.queueClear") : t("teacher.noMatches")}
            </Text>
          </Card>
        ) : (
          <ul className={styles.list}>
            {shown.map((item) => (
              <li key={item.id}>
                <QueueCard
                  item={item}
                  onOpen={onOpen}
                  onConfirm={onConfirm}
                  playing={playingId === item.id}
                  onTogglePlay={() => togglePlay(item)}
                />
              </li>
            ))}
          </ul>
        )}
        {onLoadMore && items.length < count && (
          <div className={styles.more}>
            <Text as="p" variant="body-s" color="muted">
              {t("teacher.queueShown", { shown: items.length, total: count })}
            </Text>
            <Button variant="secondary" onClick={onLoadMore} disabled={loadingMore}>
              {t("teacher.queueMore")}
            </Button>
          </div>
        )}
        {/* The one shared player. No controls of its own — each card's button
            drives it — and hidden from the accessibility tree for that reason. */}
        <audio
          ref={player}
          preload="none"
          className={styles.player}
          onEnded={() => setPlayingId(null)}
          onError={() => setPlayingId(null)}
          aria-hidden
        />
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Card                                                                      */
/* -------------------------------------------------------------------------- */

function QueueCard({
  item,
  onOpen,
  onConfirm,
  playing,
  onTogglePlay,
}: {
  item: QueueItem;
  onOpen?: (id: string, item: QueueItem) => void;
  onConfirm?: (id: string) => Promise<void> | void;
  playing: boolean;
  onTogglePlay: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm?.(item.id);
    } finally {
      setBusy(false);
    }
  };

  const sub = [item.task, item.level].filter(Boolean).join(" · ");

  return (
    <Card variant="outline" padding="md" className={styles.card}>
      <div className={styles.cardTop}>
        <span className={styles.avatar} aria-hidden>
          <Text as="span" variant="body-s" weight="bold">
            {item.initials ?? initialsOf(item.studentName)}
          </Text>
        </span>
        <span className={styles.cardBody}>
          <Text as="span" variant="body" weight="bold" truncate>
            {item.studentName}
          </Text>
          <Text as="span" variant="body-s" color="muted" truncate>
            {sub}
          </Text>
        </span>
        <span
          className={cx(
            styles.scoreBox,
            item.score != null ? styles[`box-${scoreTone(item.score)}` as const] : styles.boxNone,
          )}
          aria-label={item.score != null ? t("teacher.scoreAria", { score: Math.round(item.score) }) : undefined}
        >
          <Text as="span" variant="body" weight="black" numeric>
            {item.score != null ? Math.round(item.score) : "—"}
          </Text>
        </span>
      </div>

      <div className={styles.meta}>
        {item.score != null && item.score <= LOW_BAND && (
          <Badge variant="danger" size="sm">
            {t("teacher.qLow")}
          </Badge>
        )}
        <Text as="span" variant="body-s" color="muted">
          {item.when}
        </Text>
        {item.audioUrl && (
          <button
            type="button"
            className={styles.audioCue}
            aria-pressed={playing}
            aria-label={
              playing
                ? t("teacher.audioPause", { name: item.studentName })
                : t("teacher.audioPlay", { name: item.studentName })
            }
            onClick={onTogglePlay}
          >
            {playing ? <PauseGlyph /> : <PlayGlyph />}
            <Text as="span" variant="body-s" weight="bold">
              {t("teacher.audio")}
            </Text>
          </button>
        )}
      </div>

      <div className={styles.actions}>
        <Button
          variant="primary"
          size="sm"
          className={styles.confirmBtn}
          disabled={busy}
          onClick={() => void confirm()}
        >
          ✓ {t("teacher.confirm")}
        </Button>
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => onOpen?.(item.id, item)}>
          {t("teacher.edit")}
        </Button>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Local helpers                                                              */
/* -------------------------------------------------------------------------- */

type ScoreTone = "success" | "warn" | "danger";

function PlayGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M7 4.5v15l13-7.5z" />
    </svg>
  );
}

function PauseGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="6" y="4.5" width="4" height="15" rx="1" />
      <rect x="14" y="4.5" width="4" height="15" rx="1" />
    </svg>
  );
}

function scoreTone(score: number): ScoreTone {
  if (score >= 75) return "success";
  if (score >= 60) return "warn";
  return "danger";
}

/* -------------------------------------------------------------------------- */
/* Default export — a self-wired demo.                                        */
/* -------------------------------------------------------------------------- */

export default function ReviewQueueDemo() {
  const [filter, setFilter] = useState<QueueFilter>("all");
  return (
    <ReviewQueueScreen items={mockReviewQueue} filter={filter} onFilterChange={setFilter} />
  );
}
