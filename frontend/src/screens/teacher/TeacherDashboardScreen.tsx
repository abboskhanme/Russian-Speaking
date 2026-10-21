import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Card, Text, cx } from "../../shared/ui";
import { Page } from "../../widgets";
import type { NavItem } from "../../widgets";
import { mockTeacher, mockTeacherAttention, mockTeacherStats } from "./teacher.mock";
import styles from "./TeacherDashboardScreen.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

export interface TeacherProfile {
  /** The teacher's display name shown in the greeting. */
  name: string;
  /**
   * Localized, time-of-day greeting line above the name (e.g. "Xayrli tong,").
   * The caller localizes; the screen just renders it.
   */
  greeting: string;
  /** Avatar initials (e.g. "DK"). Derived from the name when omitted. */
  initials?: string;
}

/** The three counters on the bottom tile row: Guruh · O'quvchi · Navbatda. */
export interface TeacherStats {
  /** Number of groups the teacher runs. */
  groups: number;
  /** Distinct students across those groups. */
  students: number;
  /** Attempts waiting in the grading queue. */
  queued: number;
}

/**
 * Tone of an "E'tibor talab qiladi" card — drives the 4px left border, the icon
 * tile tint and the glyph, exactly as the mockup pairs them.
 *
 *   danger → low AI confidence, needs a human now
 *   warn   → a downward trend worth a look
 *   accent → an approval waiting on the teacher
 */
export type AttentionTone = "danger" | "warn" | "accent";

export interface TeacherAttentionItem {
  id: string;
  tone: AttentionTone;
  /** Headline, already localized + counted (e.g. "3 ta javob — AI ishonchi past"). */
  title: string;
  /** Second line — what to do about it (e.g. "Tekshirish navbatiga o'ting"). */
  hint: string;
}

export interface TeacherDashboardProps {
  teacher: TeacherProfile;
  stats: TeacherStats;
  /**
   * The "needs attention" cards, most urgent first. Only pass items you have
   * real data for — an absent card is correct, an invented one is not.
   */
  attention: TeacherAttentionItem[];
  /** Active nav key (defaults to "home"). */
  activeNavKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
  /** Open an attention card's destination. */
  onOpenAttention?: (id: string, item: TeacherAttentionItem) => void;
  /** The header avatar — the teacher panel's profile entry (there is no nav item). */
  onOpenProfile?: () => void;
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * TeacherDashboardScreen — the teacher's **A1 «Obzor · bugun kimga yordam
 * kerak»** (`docs/design/mockups/Govorim - Teacher.dc.html`). Presentational
 * and prop-driven: it fetches nothing and owns no state.
 *
 * This is a teacher screen, not a restyled student one — the teacher panel is
 * its own design with its own nav (`Bosh · Klasslar · Navbat · Kontent ·
 * Analitika`), so there is no student mascot and no Profil nav item; the header
 * avatar is the profile entry. Layout follows the mockup top-to-bottom: greeting
 * + avatar → "E'tibor talab qiladi" cards → three stat tiles at the **bottom**
 * (the mockup deliberately leads with the work, not the numbers). Full-width
 * (docs/04 §4.10) at compact density (docs/03 §3.5 `--density-scale` ×0.75).
 * Every colour / space / radius value is a token.
 */
export function TeacherDashboardScreen({
  teacher,
  stats,
  attention,
  onOpenAttention,
  onOpenProfile,
}: TeacherDashboardProps) {
  const { t } = useTranslation();
  return (
    <Page title={t("nav.teacherHome")} width="wide">
      {/* data-density mirrors the DS compact contract; the scale is also set on
          .page so it stays scoped to this screen (docs/03 §3.5). */}
      <div className={styles.page} data-density="compact">
        <ObzorHeader teacher={teacher} onOpenProfile={onOpenProfile} />
        <AttentionSection attention={attention} onOpenAttention={onOpenAttention} />
        <StatsRow stats={stats} />
      </div>
    </Page>
  );
}

/* -------------------------------------------------------------------------- */
/* Header — greeting + avatar (the profile entry)                             */
/* -------------------------------------------------------------------------- */

function ObzorHeader({
  teacher,
  onOpenProfile,
}: {
  teacher: TeacherProfile;
  onOpenProfile?: () => void;
}) {
  const { t } = useTranslation();
  const initials = teacher.initials ?? deriveInitials(teacher.name);

  return (
    <header className={styles.head}>
      <div className={styles.headText}>
        <Text as="p" variant="body-s" color="muted" weight="semibold">
          {teacher.greeting}
        </Text>
        <Text as="span" variant="title-l">
          {teacher.name}
        </Text>
      </div>

      {/* The teacher nav has no Profil item — this avatar is that entry point. */}
      <button
        type="button"
        className={styles.avatar}
        onClick={onOpenProfile}
        aria-label={t("teacher.avatarAria")}
      >
        <Text as="span" variant="body" weight="black">
          {initials}
        </Text>
      </button>
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/* E'tibor talab qiladi                                                       */
/* -------------------------------------------------------------------------- */

function AttentionSection({
  attention,
  onOpenAttention,
}: {
  attention: TeacherAttentionItem[];
  onOpenAttention?: (id: string, item: TeacherAttentionItem) => void;
}) {
  const { t } = useTranslation();

  return (
    <section className={styles.section} aria-label={t("teacher.attentionAria")}>
      <Text as="h2" variant="label" color="muted">
        {t("teacher.attention")}
      </Text>

      {attention.length === 0 ? (
        <Card variant="flat" padding="md" className={styles.empty}>
          <Text as="p" variant="body" color="muted">
            {t("teacher.allClear")}
          </Text>
        </Card>
      ) : (
        <ul className={styles.attentionList}>
          {attention.map((item) => (
            <li key={item.id}>
              <AttentionCard item={item} onOpenAttention={onOpenAttention} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AttentionCard({
  item,
  onOpenAttention,
}: {
  item: TeacherAttentionItem;
  onOpenAttention?: (id: string, item: TeacherAttentionItem) => void;
}) {
  return (
    <button
      type="button"
      className={cx(styles.attentionCard, styles[`tone-${item.tone}` as const])}
      onClick={() => onOpenAttention?.(item.id, item)}
    >
      <span className={styles.attentionIcon} aria-hidden>
        {ATTENTION_GLYPH[item.tone]}
      </span>

      <span className={styles.attentionBody}>
        <Text as="span" variant="body" weight="bold">
          {item.title}
        </Text>
        <Text as="span" variant="body-s" color="muted">
          {item.hint}
        </Text>
      </span>

      <span className={styles.chevron} aria-hidden>
        <ChevronGlyph />
      </span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Stat tiles (bottom row)                                                    */
/* -------------------------------------------------------------------------- */

function StatsRow({ stats }: { stats: TeacherStats }) {
  const { t } = useTranslation();
  return (
    <section className={styles.stats} aria-label={t("teacher.statsAria")}>
      <StatTile value={stats.groups} label={t("teacher.statGroups")} />
      <StatTile value={stats.students} label={t("teacher.statStudents")} />
      <StatTile value={stats.queued} label={t("teacher.statQueue")} />
    </section>
  );
}

function StatTile({ value, label }: { value: number; label: string }) {
  return (
    <Card variant="outline" padding="sm" className={styles.statTile}>
      <Text as="span" variant="title-l" weight="black" numeric>
        {value}
      </Text>
      <Text as="span" variant="body-s" color="muted" weight="semibold">
        {label}
      </Text>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Local helpers                                                              */
/* -------------------------------------------------------------------------- */

function deriveInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/** Warning triangle — low AI confidence. */
function AlertGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3 2 20h20z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M12 10v4M12 17h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** Falling bars — a downward score trend. */
function TrendGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 7v10m5-10v10m5-16v16m5-10v10"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Clipboard — an approval waiting on the teacher. */
function ApprovalGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M15 7h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <rect x="9" y="3" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function ChevronGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="m9 6 6 6-6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const ATTENTION_GLYPH: Record<AttentionTone, ReactNode> = {
  danger: <AlertGlyph />,
  warn: <TrendGlyph />,
  accent: <ApprovalGlyph />,
};

/* -------------------------------------------------------------------------- */
/* Default export — a self-wired demo, renderable in isolation.               */
/* -------------------------------------------------------------------------- */

/**
 * TeacherDashboardDemo — drop-in standalone preview wired to the mock fixture,
 * so the Obzor renders end-to-end with no backend.
 */
export default function TeacherDashboardDemo() {
  return (
    <TeacherDashboardScreen
      teacher={mockTeacher}
      stats={mockTeacherStats}
      attention={mockTeacherAttention}
      onNavigate={() => undefined}
      onOpenAttention={() => undefined}
      onOpenProfile={() => undefined}
    />
  );
}
