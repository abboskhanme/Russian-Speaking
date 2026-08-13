import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Button, Card, Text } from "../../../shared/ui";
import styles from "./AssignmentsTab.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract — imported by the hub shell (Agent 1).                     */
/* -------------------------------------------------------------------------- */

/** One teacher-assigned, one-off task row. */
export interface Assignment {
  id: string;
  title: string;
  /** ISO-8601 due timestamp, or null when the assignment has no deadline. */
  dueAt: string | null;
  completed: boolean;
  /** Best overall band once graded (0..100); null while not done. */
  band: number | null;
  /** Attempts the teacher allowed, or null for unlimited (the default). */
  maxAttempts?: number | null;
  /** Attempts already spent. Only meaningful beside `maxAttempts`. */
  attemptsUsed?: number;
}

export interface AssignmentsTabProps {
  assignments: Assignment[];
  /** "Boshlash" on a not-done assignment → the task recording screen. */
  onStart: (assignmentId: string) => void;
}

/* -------------------------------------------------------------------------- */
/* Tab                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * AssignmentsTab — the "Topshiriqlar" tab body of the practice hub.
 *
 * Presentational and prop-driven: a flat list of one-off teacher assignments.
 * Each row carries a title, a due line (bugun/ertaga/sana · muddati o'tgan ·
 * muddatsiz), the "O'qituvchidan" caption, and a trailing state — a "Boshlash"
 * button while it is open, or a green check + "{{band}} ball" once done. An empty
 * list degrades to a muted note. Every colour / space / radius is a token; the
 * hub shell owns the `role="tabpanel"` wrapper.
 */
export function AssignmentsTab({ assignments, onStart }: AssignmentsTabProps) {
  const { t } = useTranslation();

  // A single "now" for the whole render keeps every due line consistent.
  const now = useMemo(() => new Date(), []);

  if (assignments.length === 0) {
    return (
      <div className={styles.tab}>
        <Card variant="outline" padding="lg" className={styles.emptyCard}>
          <Text as="p" variant="body-s" color="muted" className={styles.empty}>
            {t("mashq.assignments.empty")}
          </Text>
        </Card>
      </div>
    );
  }

  return (
    <div className={styles.tab}>
      <ul className={styles.list}>
        {assignments.map((a) => (
          <li key={a.id}>
            <AssignmentRow assignment={a} now={now} onStart={onStart} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Row                                                                        */
/* -------------------------------------------------------------------------- */

function AssignmentRow({
  assignment,
  now,
  onStart,
}: {
  assignment: Assignment;
  now: Date;
  onStart: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const { id, title, dueAt, completed, band, maxAttempts, attemptsUsed = 0 } = assignment;

  const due = formatDue(t, i18n.language, dueAt, completed, now);
  // Shown ONLY when the teacher set a budget. With no limit there is no number
  // worth carrying: "3 attempts used" on an unlimited task is noise that looks
  // like a rule.
  const spent = maxAttempts != null;
  const exhausted = spent && attemptsUsed >= maxAttempts;

  return (
    <Card variant="panel" padding="md" className={styles.row}>
      <div className={styles.body}>
        <Text as="p" variant="title-s" className={styles.title}>
          {title}
        </Text>

        <div className={styles.meta}>
          <span className={styles.due} data-overdue={due.overdue || undefined}>
            <span aria-hidden>🗓</span>
            <Text as="span" variant="body-s" color={due.overdue ? "danger" : "muted"}>
              {due.text}
            </Text>
          </span>
          <Text as="span" variant="body-s" color="faint" className={styles.from}>
            {t("mashq.assignments.from")}
          </Text>
          {spent && (
            <Text
              as="span"
              variant="body-s"
              numeric
              color={exhausted ? "danger" : "muted"}
              className={styles.attempts}
            >
              {t("mashq.assignments.attempts", { used: attemptsUsed, max: maxAttempts })}
            </Text>
          )}
        </div>
      </div>

      <div className={styles.trailing}>
        {completed ? (
          <span className={styles.done}>
            <span className={styles.check} aria-hidden>
              <CheckGlyph />
            </span>
            {band !== null && (
              <Text as="span" variant="title-s" numeric color="success" className={styles.score}>
                {t("mashq.assignments.score", { band: Math.round(band) })}
              </Text>
            )}
          </span>
        ) : (
          // Exhausted-but-open is rare (the first answer already marks it done),
          // but when it happens the button must not lead to a submit the server
          // will refuse.
          <Button
            variant="primary"
            size="sm"
            disabled={exhausted}
            onClick={() => onStart(id)}
          >
            {exhausted ? t("mashq.assignments.noAttempts") : t("mashq.assignments.start")}
          </Button>
        )}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Due-date formatting                                                        */
/* -------------------------------------------------------------------------- */

interface DueLine {
  text: string;
  overdue: boolean;
}

/**
 * Turn a due timestamp into a localised line:
 *   • null                       → "muddatsiz"
 *   • past & not yet done         → "muddati o'tgan" (danger)
 *   • today / tomorrow / a date   → "bugun HH:mm" / "ertaga HH:mm" / "12 iyul, HH:mm"
 * The day bucket is measured by LOCAL calendar boundary (an 23:00 due today is
 * still "bugun"), and unparseable input falls back to "muddatsiz".
 */
function formatDue(
  t: TFunction,
  lang: string,
  dueAt: string | null,
  completed: boolean,
  now: Date,
): DueLine {
  if (!dueAt) return { text: t("mashq.assignments.noDue"), overdue: false };

  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) {
    return { text: t("mashq.assignments.noDue"), overdue: false };
  }

  const time = new Intl.DateTimeFormat(lang, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(due);

  const days = calendarDaysBetween(now, due);

  // An open assignment whose deadline has passed reads as overdue; a finished one
  // never does — it simply shows when it had been due.
  if (days < 0 && !completed) {
    return { text: t("mashq.assignments.overdue"), overdue: true };
  }

  if (days === 0) {
    return { text: t("mashq.assignments.when.today", { time }), overdue: false };
  }
  if (days === 1) {
    return { text: t("mashq.assignments.when.tomorrow", { time }), overdue: false };
  }

  const date = new Intl.DateTimeFormat(lang, {
    day: "numeric",
    month: "short",
  }).format(due);
  return { text: t("mashq.assignments.when.date", { date, time }), overdue: false };
}

/** Local midnight for a date — the boundary day buckets are measured from. */
function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Whole calendar days from `from` to `to`, counted by LOCAL day boundary. */
function calendarDaysBetween(from: Date, to: Date): number {
  const MS_PER_DAY = 86_400_000;
  return Math.round((startOfLocalDay(to) - startOfLocalDay(from)) / MS_PER_DAY);
}

/* -------------------------------------------------------------------------- */
/* Glyph                                                                      */
/* -------------------------------------------------------------------------- */

function CheckGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden focusable="false">
      <path
        d="M5 12.5l4.2 4.2L19 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
