import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, Text, cx } from "../../shared/ui";
import { MiniBars } from "../../shared/ui/Chart";
import type { MiniBar } from "../../shared/ui/Chart";
import { AppShell, Brand, NotificationsBell, teacherNavItems } from "../../widgets";
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

/** One answer waiting for this teacher's review (newest first). */
export interface TeacherRecentItem {
  id: string;
  studentName: string;
  taskTitle: string;
  /** AI band 0–100, null when the attempt has none. */
  score: number | null;
  /** Localized "when", already formatted. */
  when: string;
}

/** A student who is falling behind, and why (already localized). */
export interface TeacherBehindItem {
  id: string;
  name: string;
  /** "8 kundan beri mashq qilmadi" / "Ball 7 ga tushdi" / "Hali boshlamagan". */
  reason: string;
  tone: "warn" | "danger";
}

export type TeacherQuickAction = "new-group" | "assign" | "queue";

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
  /** Answers waiting for review (the first few). Absent ⇒ section hidden. */
  recent?: TeacherRecentItem[];
  /** Students falling behind. Absent ⇒ section hidden. */
  behind?: TeacherBehindItem[];
  /** This week's class activity, 7 days oldest first. Absent ⇒ no chart. */
  week?: MiniBar[];
  onOpenSubmission?: (id: string) => void;
  onOpenStudent?: (id: string) => void;
  onQuickAction?: (action: TeacherQuickAction) => void;
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
  activeNavKey = "home",
  onNavigate,
  onOpenAttention,
  onOpenProfile,
  recent,
  behind,
  week,
  onOpenSubmission,
  onOpenStudent,
  onQuickAction,
}: TeacherDashboardProps) {
  const { t } = useTranslation();
  return (
    <AppShell
      brand={<Brand />}
      nav={{
        items: teacherNavItems(t, stats.queued),
        activeKey: activeNavKey,
        onNavigate,
        label: t("nav.landmark"),
      }}
      headerStart={
        <Text as="h1" variant="title-m">
          {t("nav.teacherHome")}
        </Text>
      }
      headerEnd={<NotificationsBell />}
    >
      {/* data-density mirrors the DS compact contract; the scale is also set on
          .page so it stays scoped to this screen (docs/03 §3.5). */}
      <div className={styles.page} data-density="compact">
        <ObzorHeader teacher={teacher} onOpenProfile={onOpenProfile} />
        {onQuickAction && <QuickActions onQuickAction={onQuickAction} />}
        <AttentionSection attention={attention} onOpenAttention={onOpenAttention} />
        {(recent || behind) && (
          <div className={styles.grid}>
            {recent && (
              <RecentSection
                items={recent}
                total={stats.queued}
                onOpen={onOpenSubmission}
                onOpenQueue={onQuickAction ? () => onQuickAction("queue") : undefined}
              />
            )}
            {behind && <BehindSection items={behind} onOpen={onOpenStudent} />}
          </div>
        )}
        {week && week.length > 0 && (
          <section className={styles.section} aria-label={t("uiDash.teacher.weekTitle")}>
            <Text as="h2" variant="label" color="muted">
              {t("uiDash.teacher.weekTitle")}
            </Text>
            <Card variant="outline" padding="md">
              <MiniBars
                bars={week}
                label={t("uiDash.teacher.weekAria", {
                  values: week.map((b) => `${b.label} ${b.value}`).join(", "),
                })}
              />
            </Card>
          </section>
        )}
        <StatsRow stats={stats} />
      </div>
    </AppShell>
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
/* Quick actions                                                              */
/* -------------------------------------------------------------------------- */

function QuickActions({ onQuickAction }: { onQuickAction: (a: TeacherQuickAction) => void }) {
  const { t } = useTranslation();
  return (
    <nav className={styles.quick} aria-label={t("uiDash.teacher.quickAria")}>
      <Button variant="primary" size="sm" className={styles.quickBtn} onClick={() => onQuickAction("assign")}>
        <PlusGlyph />
        {t("uiDash.teacher.assign")}
      </Button>
      <Button variant="secondary" size="sm" className={styles.quickBtn} onClick={() => onQuickAction("new-group")}>
        <GroupGlyph />
        {t("uiDash.teacher.newGroup")}
      </Button>
    </nav>
  );
}

/* -------------------------------------------------------------------------- */
/* Waiting for review · Falling behind                                        */
/* -------------------------------------------------------------------------- */

function RecentSection({
  items,
  total,
  onOpen,
  onOpenQueue,
}: {
  items: TeacherRecentItem[];
  total: number;
  onOpen?: (id: string) => void;
  onOpenQueue?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <section className={styles.section} aria-label={t("uiDash.teacher.recentTitle")}>
      <div className={styles.sectionHead}>
        <Text as="h2" variant="label" color="muted">
          {t("uiDash.teacher.recentTitle")}
        </Text>
        {onOpenQueue && total > items.length && (
          <button type="button" className={styles.linkBtn} onClick={onOpenQueue}>
            {t("uiDash.teacher.seeAll", { count: total })}
          </button>
        )}
      </div>
      <Card variant="outline" padding="none" className={styles.listCard}>
        {items.length === 0 ? (
          <Text as="p" variant="body-s" color="muted" className={styles.listEmpty}>
            {t("uiDash.teacher.recentEmpty")}
          </Text>
        ) : (
          <ul className={styles.list}>
            {items.map((it) => (
              <li key={it.id}>
                <button type="button" className={styles.row} onClick={() => onOpen?.(it.id)}>
                  <span className={cx(styles.scoreDot, it.score === null && styles.scoreDotNone)} aria-hidden>
                    <Text as="span" variant="body-s" weight="black" numeric>
                      {it.score === null ? "—" : Math.round(it.score)}
                    </Text>
                  </span>
                  <span className={styles.rowText}>
                    <Text as="span" variant="body-s" weight="bold" truncate>
                      {it.studentName}
                    </Text>
                    <Text as="span" variant="body-s" color="muted" truncate>
                      {it.taskTitle} · {it.when}
                    </Text>
                  </span>
                  <span className={styles.chevron} aria-hidden>
                    <ChevronGlyph />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

function BehindSection({ items, onOpen }: { items: TeacherBehindItem[]; onOpen?: (id: string) => void }) {
  const { t } = useTranslation();
  return (
    <section className={styles.section} aria-label={t("uiDash.teacher.behindTitle")}>
      <div className={styles.sectionHead}>
        <Text as="h2" variant="label" color="muted">
          {t("uiDash.teacher.behindTitle")}
        </Text>
      </div>
      <Card variant="outline" padding="none" className={styles.listCard}>
        {items.length === 0 ? (
          <Text as="p" variant="body-s" color="muted" className={styles.listEmpty}>
            {t("uiDash.teacher.behindEmpty")}
          </Text>
        ) : (
          <ul className={styles.list}>
            {items.map((it) => (
              <li key={it.id}>
                <button type="button" className={styles.row} onClick={() => onOpen?.(it.id)}>
                  <span className={cx(styles.initials, styles[`initials-${it.tone}` as const])} aria-hidden>
                    <Text as="span" variant="body-s" weight="black">
                      {deriveInitials(it.name)}
                    </Text>
                  </span>
                  <span className={styles.rowText}>
                    <Text as="span" variant="body-s" weight="bold" truncate>
                      {it.name}
                    </Text>
                    <Text as="span" variant="body-s" color={it.tone === "danger" ? "danger" : "muted"}>
                      {it.reason}
                    </Text>
                  </span>
                  <span className={styles.chevron} aria-hidden>
                    <ChevronGlyph />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

function PlusGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function GroupGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="9" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.9" />
      <path
        d="M3 19c.8-3 3.2-4.5 6-4.5s5.2 1.5 6 4.5M16 5.5a3 3 0 0 1 0 5.5M18 14.5c1.6.6 2.6 2 3 4.5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
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
