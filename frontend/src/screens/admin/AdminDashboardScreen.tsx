import { useTranslation } from "react-i18next";
import { Card, StatTile, Text } from "../../shared/ui";
import { AppShell, Brand, NotificationsBell, adminNavItems } from "../../widgets";
import type { NavItem } from "../../widgets";
import { mockAdminStats } from "./admin.mock";
import styles from "./AdminDashboardScreen.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

/** The six counters `GET /api/admin/stats` returns. Every one is a COUNT the
 * database answers directly — nothing here is estimated or projected. */
export interface AdminStats {
  teachers: number;
  students: number;
  questions: number;
  publishedQuestions: number;
  submissions: number;
  evaluatedSubmissions: number;
}

export interface AdminDashboardProps {
  stats: AdminStats;
  activeNavKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * AdminDashboardScreen — **Boshqaruv**, the admin landing page
 * (`docs/design/mockups/Govorim - Admin.dc.html`).
 *
 * **The admin panel is its own product**, like the teacher panel: its own four-item
 * nav (`Boshqaruv · O'qituvchilar · O'quvchilar · Sozlamalar`), no centre FAB, and
 * no student or teacher screen used as a starting point. `shared/ui` primitives and
 * tokens ARE shared — that is infrastructure.
 *
 * **Half the mockup's dashboard is deliberately absent, and that is the point.**
 * The design shows revenue by plan, recent payments, teacher star ratings, daily
 * active users, a retention cohort grid and a moderation queue. None of those has
 * a table, a column or an endpoint behind it — `plans`, `subscriptions`,
 * `entitlements`, ratings and moderation simply do not exist in this schema. An
 * admin panel whose numbers are decorative is worse than a small one that is true,
 * because it is the screen people make decisions from. Each omission is recorded in
 * TEACHER-PANEL-PLAN.md rather than silently dropped.
 *
 * What IS here: how much content and activity the platform actually holds, plus the
 * one derived figure that answers a real operational question — how much of the
 * submitted work the grader has managed to score.
 */
export function AdminDashboardScreen({
  stats,
  activeNavKey = "home",
  onNavigate,
}: AdminDashboardProps) {
  const { t } = useTranslation();

  // "How far behind is grading?" — the only number here that is computed rather
  // than counted, and the only one an admin can act on today. With no submissions
  // the honest answer is a dash, not 0% or 100%.
  //
  // FLOOR, not round: 768 of 770 rounds to 100%, which sat directly above the line
  // "2 answers are still ungraded" and contradicted it. Only a genuinely complete
  // queue may read 100% here, because that is the number someone uses to decide
  // whether grading needs attention.
  const gradedPct =
    stats.submissions > 0
      ? Math.floor((stats.evaluatedSubmissions / stats.submissions) * 100)
      : null;
  const ungraded = Math.max(0, stats.submissions - stats.evaluatedSubmissions);

  return (
    <AppShell
      brand={<Brand />}
      nav={{
        items: adminNavItems(t),
        activeKey: activeNavKey,
        onNavigate,
        label: t("nav.landmark"),
      }}
      headerStart={
        <Text as="h1" variant="title-m">
          {t("nav.adminHome")}
        </Text>
      }
      headerEnd={<NotificationsBell />}
    >
      <div className={styles.page} data-density="compact">
        <section className={styles.section} aria-label={t("admin.people")}>
          <Text as="h2" variant="label" color="muted" className={styles.legend}>
            {t("admin.people")}
          </Text>
          <div className={styles.tiles}>
            <StatTile
              variant="outline"
              value={stats.teachers}
              label={t("admin.teachers")}
            />
            <StatTile
              variant="outline"
              value={stats.students}
              label={t("admin.students")}
            />
          </div>
        </section>

        <section className={styles.section} aria-label={t("admin.content")}>
          <Text as="h2" variant="label" color="muted" className={styles.legend}>
            {t("admin.content")}
          </Text>
          <div className={styles.tiles}>
            <StatTile variant="outline" value={stats.questions} label={t("admin.tasks")} />
            <StatTile
              variant="outline"
              value={stats.publishedQuestions}
              label={t("admin.published")}
            />
          </div>
          {/* A draft reaches nobody, so the gap between the two is the honest
              measure of how much authored work is actually live. */}
          <Text as="p" variant="body-s" color="muted">
            {t("admin.draftsNote", { count: Math.max(0, stats.questions - stats.publishedQuestions) })}
          </Text>
        </section>

        <section className={styles.section} aria-label={t("admin.activity")}>
          <Text as="h2" variant="label" color="muted" className={styles.legend}>
            {t("admin.activity")}
          </Text>
          <div className={styles.tiles}>
            <StatTile variant="outline" value={stats.submissions} label={t("admin.answers")} />
            <StatTile
              variant="outline"
              value={gradedPct === null ? "—" : gradedPct}
              unit={gradedPct === null ? undefined : "%"}
              label={t("admin.graded")}
            />
          </div>
          <Card variant="flat" padding="md">
            <Text as="p" variant="body-s" color={ungraded > 0 ? "warn" : "muted"}>
              {ungraded > 0
                ? t("admin.ungradedNote", { count: ungraded })
                : t("admin.allGradedNote")}
            </Text>
          </Card>
        </section>
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Default export — a self-wired demo.                                        */
/* -------------------------------------------------------------------------- */

export default function AdminDashboardDemo() {
  return <AdminDashboardScreen stats={mockAdminStats} />;
}
