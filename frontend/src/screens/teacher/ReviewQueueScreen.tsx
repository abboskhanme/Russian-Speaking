import { useMemo, useState } from "react";
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
  /** Whether the recording is still available (the retention job purges it). */
  hasAudio: boolean;
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
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * ReviewQueueScreen — **B1 «Tekshirish navbati»**
 * (`RussianDesign/Govori/Govorim - Teacher.dc.html`), the Navbat FAB's destination.
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
 */
export function ReviewQueueScreen({
  items,
  filter = "all",
  onFilterChange,
  activeNavKey = "queue",
  onNavigate,
  onOpen,
  onConfirm,
}: ReviewQueueProps) {
  const { t } = useTranslation();

  const shown = useMemo(
    () => (filter === "low" ? items.filter((i) => i.score != null && i.score <= LOW_BAND) : items),
    [items, filter],
  );

  const tabs: TabItem[] = [
    { key: "all", label: items.length ? `${t("teacher.qAll")} · ${items.length}` : t("teacher.qAll") },
    { key: "low", label: t("teacher.qLow") },
  ];

  return (
    <AppShell
      brand={<Brand />}
      nav={{
        items: teacherNavItems(t, items.length),
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
                <QueueCard item={item} onOpen={onOpen} onConfirm={onConfirm} />
              </li>
            ))}
          </ul>
        )}
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
}: {
  item: QueueItem;
  onOpen?: (id: string, item: QueueItem) => void;
  onConfirm?: (id: string) => Promise<void> | void;
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
        <Text as="span" variant="body-s" color="faint">
          {item.when}
        </Text>
        {item.hasAudio && (
          <span className={styles.audioCue}>
            <Text as="span" variant="body-s" weight="bold">
              ▶ {t("teacher.audio")}
            </Text>
          </span>
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
