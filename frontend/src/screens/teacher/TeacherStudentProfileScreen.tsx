import { useTranslation } from "react-i18next";
import { Button, Card, Text, cx } from "../../shared/ui";
import { AppShell, Brand, NotificationsBell, teacherNavItems } from "../../widgets";
import type { NavItem } from "../../widgets";
import { mockStudentProfile } from "./classes.mock";
import { BackGlyph, initialsOf } from "./TeacherGroupDetailScreen";
import styles from "./TeacherStudentProfileScreen.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

/** One skill bar. `score` 0–100; the caller supplies the localized label. */
export interface StudentSkill {
  key: string;
  label: string;
  score: number;
}

/** One attempt in "So'nggi urinishlar". */
export interface StudentAttempt {
  id: string;
  /** Task title. */
  title: string;
  /** Localized relative time ("Bugun" / "Kecha"), formatted by the caller. */
  when: string;
  /** AI band 0–100. Absent while the attempt is still being graded. */
  score?: number;
  /** True once a teacher has signed it off — drives the "tekshirilmagan" caption. */
  reviewed: boolean;
}

export interface TeacherStudentProfileProps {
  fullName: string;
  initials?: string;
  /** "Kechki-3 · A2 · qo'shilgan mart" — assembled and localized by the caller. */
  meta: string;
  /**
   * Skill averages. Pass only the skills that actually have data — a bar at 0
   * would read as "scored zero" rather than "never measured".
   */
  skills: StudentSkill[];
  attempts: StudentAttempt[];
  activeNavKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
  queuedCount?: number;
  onBack?: () => void;
  /** "Topshiriq berish" for this one student (D3 — Phase 6). */
  onAssign?: () => void;
  /** Open one attempt (B2 answer detail — Phase 4). */
  onOpenAttempt?: (id: string, attempt: StudentAttempt) => void;
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * TeacherStudentProfileScreen — **A6 «O'quvchi profili»**
 * (`RussianDesign/Govori/Govorim - Teacher.dc.html`).
 *
 * Mockup order: back + "O'QUVCHI" → avatar + name + meta line → "Topshiriq
 * berish" → "Ko'nikmalar" bars → "So'nggi urinishlar".
 *
 * The skill bars and per-attempt scores come from the AI scores now carried on
 * every `GET /api/submissions` row. Before that they were only on
 * `/submissions/{id}/detail`, so a screen like this would have needed one request
 * per attempt just to draw a number.
 *
 * Presentational and prop-driven. Full-width (docs/04 §4.10), compact density
 * (docs/03 §3.5). Teacher panel design — not a student screen restyled.
 */
export function TeacherStudentProfileScreen({
  fullName,
  initials,
  meta,
  skills,
  attempts,
  activeNavKey = "classes",
  onNavigate,
  queuedCount = 0,
  onBack,
  onAssign,
  onOpenAttempt,
}: TeacherStudentProfileProps) {
  const { t } = useTranslation();

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
          {t("nav.classes")}
        </Text>
      }
      headerEnd={<NotificationsBell />}
    >
      <div className={styles.page} data-density="compact">
        <div className={styles.crumb}>
          <button
            type="button"
            className={styles.back}
            onClick={onBack}
            aria-label={t("common.back")}
          >
            <BackGlyph />
          </button>
          <Text as="span" variant="label" color="muted">
            {t("teacher.studentLabel")}
          </Text>
        </div>

        <header className={styles.identity}>
          <span className={styles.avatar} aria-hidden>
            <Text as="span" variant="title-s" weight="black">
              {initials ?? initialsOf(fullName)}
            </Text>
          </span>
          <div className={styles.identityText}>
            <Text as="h2" variant="title-l" truncate>
              {fullName}
            </Text>
            <Text as="p" variant="body-s" color="muted">
              {meta}
            </Text>
          </div>
        </header>

        <Button variant="primary" onClick={onAssign}>
          {t("teacher.assignToStudent")}
        </Button>

        {skills.length > 0 && (
          <Card variant="outline" padding="md" className={styles.skills}>
            <Text as="h3" variant="label" color="faint">
              {t("teacher.skills")}
            </Text>
            {skills.map((s) => (
              <SkillBar key={s.key} skill={s} />
            ))}
          </Card>
        )}

        <section className={styles.section} aria-label={t("teacher.recentAttempts")}>
          <Text as="h3" variant="label" color="faint">
            {t("teacher.recentAttempts")}
          </Text>
          {attempts.length === 0 ? (
            <Card variant="flat" padding="md" className={styles.empty}>
              <Text as="p" variant="body" color="muted">
                {t("teacher.noAttempts")}
              </Text>
            </Card>
          ) : (
            <ul className={styles.list}>
              {attempts.map((a) => (
                <li key={a.id}>
                  <AttemptRow attempt={a} onOpenAttempt={onOpenAttempt} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Parts                                                                      */
/* -------------------------------------------------------------------------- */

function SkillBar({ skill }: { skill: StudentSkill }) {
  const tone = scoreTone(skill.score);
  return (
    <div className={styles.skillRow}>
      <Text as="span" variant="body-s" weight="semibold" className={styles.skillLabel}>
        {skill.label}
      </Text>
      <div
        className={styles.track}
        role="progressbar"
        aria-valuenow={skill.score}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={skill.label}
      >
        <div
          className={cx(styles.fill, styles[`fill-${tone}` as const])}
          style={{ width: `${clamp(skill.score)}%` }}
        />
      </div>
      <Text as="span" variant="body-s" weight="black" numeric className={styles.skillScore}>
        {Math.round(skill.score)}
      </Text>
    </div>
  );
}

function AttemptRow({
  attempt,
  onOpenAttempt,
}: {
  attempt: StudentAttempt;
  onOpenAttempt?: (id: string, attempt: StudentAttempt) => void;
}) {
  const { t } = useTranslation();
  const sub = [attempt.when, attempt.reviewed ? null : t("teacher.unreviewed")]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      className={styles.row}
      onClick={() => onOpenAttempt?.(attempt.id, attempt)}
    >
      <span
        className={cx(
          styles.scoreCircle,
          attempt.score != null
            ? styles[`circle-${scoreTone(attempt.score)}` as const]
            : styles.circleNone,
        )}
        aria-hidden
      >
        <Text as="span" variant="body-s" weight="black" numeric>
          {attempt.score != null ? Math.round(attempt.score) : "—"}
        </Text>
      </span>
      <span className={styles.rowBody}>
        <Text as="span" variant="body" weight="bold" truncate>
          {attempt.title}
        </Text>
        <Text as="span" variant="body-s" color="muted" truncate>
          {sub}
        </Text>
      </span>
    </button>
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

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}

/* -------------------------------------------------------------------------- */
/* Default export — a self-wired demo.                                        */
/* -------------------------------------------------------------------------- */

export default function TeacherStudentProfileDemo() {
  return <TeacherStudentProfileScreen {...mockStudentProfile} />;
}
