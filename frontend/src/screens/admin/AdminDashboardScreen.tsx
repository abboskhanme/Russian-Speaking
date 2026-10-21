import { useTranslation } from "react-i18next";
import { Button, Card, StatTile, Text } from "../../shared/ui";
import { AppShell, Brand, NotificationsBell, adminNavItems } from "../../widgets";
import type { NavItem } from "../../widgets";
import { AdminAccountButton } from "./AdminChrome";
import { mockAdminStats } from "./admin.mock";
import styles from "./AdminDashboardScreen.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

/** The counters `GET /api/admin/stats` returns. Every one is a COUNT the database
 * answers directly — nothing here is estimated or projected. */
export interface AdminStats {
  teachers: number;
  students: number;
  questions: number;
  publishedQuestions: number;
  submissions: number;
  evaluatedSubmissions: number;
  /** Queued or being graded right now. Null when the API predates the field. */
  pendingSubmissions: number | null;
  /** Grading ended in an error. Null when the API predates the field. */
  failedSubmissions: number | null;
}

export interface AdminDashboardProps {
  stats: AdminStats;
  /** Opens Jurnal (the audit trail). The nav lists it in the sidebar only, so on a
   * phone this is the way in; absent (a demo, a test), the card is not rendered. */
  onOpenAudit?: () => void;
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
 * **The admin panel is its own product**, like the teacher panel: its own nav
 * (`Boshqaruv · O'qituvchilar · O'quvchilar · Kontent · Tariflar · Sozlamalar`), no
 * centre FAB, and no student or teacher screen used as a starting point. `shared/ui`
 * primitives and tokens ARE shared — that is infrastructure.
 *
 * **Half the mockup's dashboard is deliberately absent, and that is the point.**
 * The design shows revenue by plan, recent payments, teacher star ratings, daily
 * active users, a retention cohort grid and a moderation queue. Ratings, activity
 * tracking and moderation have no table behind them at all. Plans and subscriptions
 * DO exist now (Tariflar), but no payment provider is connected, so every revenue
 * figure would be zero dressed up as a chart — the Tariflar screen states that
 * plainly instead. An admin panel whose numbers are decorative is worse than a small
 * one that is true, because it is the screen people make decisions from. Each
 * omission is recorded in TEACHER-PANEL-PLAN.md rather than silently dropped.
 *
 * What IS here: how much content and activity the platform actually holds, plus the
 * one derived figure that answers a real operational question — how much of the
 * submitted work the grader has managed to score, and what is still in flight or
 * has failed.
 */
export function AdminDashboardScreen({
  stats,
  onOpenAudit,
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
  // Not graded is two different things, and they used to be one sentence: "2 answers
  // are still ungraded" counted FAILED answers too, which read as "wait a bit" about
  // work that will never finish on its own. In flight and failed are now separate
  // lines, and failed is a warning, not a to-do — nothing on this screen retries it.
  const legacy = stats.pendingSubmissions === null || stats.failedSubmissions === null;
  const pending = Math.max(0, stats.pendingSubmissions ?? 0);
  const failed = Math.max(0, stats.failedSubmissions ?? 0);
  // The coarse gap — the whole sentence for an API that predates the split, and the
  // fallback when neither split count explains it.
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
      headerEnd={
        <>
          <NotificationsBell />
          <AdminAccountButton />
        </>
      }
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
          <Card variant="flat" padding="md" className={styles.notes}>
            {legacy ? (
              <Text as="p" variant="body-s" color={ungraded > 0 ? "warn" : "muted"}>
                {ungraded > 0
                  ? t("admin.ungradedNote", { count: ungraded })
                  : t("admin.allGradedNote")}
              </Text>
            ) : (
              <>
                {pending > 0 && (
                  <Text as="p" variant="body-s" color="muted">
                    {t("admin.pendingNote", { count: pending })}
                  </Text>
                )}
                {failed > 0 && (
                  <Text as="p" variant="body-s" color="warn">
                    {t("admin.failedNote", { count: failed })}
                  </Text>
                )}
                {/* "All graded" only when the arithmetic agrees. An answer that is
                    neither in flight nor failed nor graded is not something this card
                    may round away. */}
                {pending === 0 && failed === 0 && (
                  <Text as="p" variant="body-s" color={ungraded > 0 ? "warn" : "muted"}>
                    {ungraded > 0
                      ? t("admin.ungradedNote", { count: ungraded })
                      : t("admin.allGradedNote")}
                  </Text>
                )}
              </>
            )}
          </Card>
        </section>

        {onOpenAudit && (
          <section className={styles.section} aria-label={t("admin.audit.title")}>
            <Text as="h2" variant="label" color="muted" className={styles.legend}>
              {t("admin.audit.title")}
            </Text>
            <Card variant="flat" padding="md" className={styles.notes}>
              <Text as="p" variant="body-s" color="muted">
                {t("admin.audit.dashboardHint")}
              </Text>
              <div>
                <Button variant="secondary" size="sm" onClick={onOpenAudit}>
                  {t("admin.audit.open")}
                </Button>
              </div>
            </Card>
          </section>
        )}
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
