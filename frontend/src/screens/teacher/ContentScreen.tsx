import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card, Input, Tabs, Text } from "../../shared/ui";
import type { TabItem } from "../../shared/ui";
import { AppShell, Brand, NotificationsBell, teacherNavItems } from "../../widgets";
import type { NavItem } from "../../widgets";
import { mockContentModules, mockContentTasks } from "./content.mock";
import styles from "./ContentScreen.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

export interface ContentModule {
  id: string;
  name: string;
  /** CEFR label, e.g. "A1–A2". */
  level?: string;
  taskCount: number;
  /** Roster reach. 0 for a draft — a draft reaches nobody. */
  studentCount: number;
  published: boolean;
}

export interface ContentTask {
  id: string;
  title: string;
  /** The Russian prompt, shown truncated as the row's second line. */
  prompt: string;
  level?: string;
  /** Module it belongs to; absent when unattached. */
  moduleName?: string;
  published: boolean;
}

export type ContentTabKey = "modules" | "tasks";

export interface ContentScreenProps {
  modules: ContentModule[];
  tasks: ContentTask[];
  activeTab?: ContentTabKey;
  onTabChange?: (k: ContentTabKey) => void;
  activeNavKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
  /** Another panel's frame (the admin's `/admin/content` reuses this screen). Absent
   * = the teacher nav and header. */
  shell?: { navItems: NavItem[]; headerEnd?: ReactNode };
  /** An extra line under a module row's meta — the admin's owner + visibility. */
  moduleExtra?: (m: ContentModule) => ReactNode;
  /** Replaces the Modullar tab's empty line. */
  modulesEmpty?: ReactNode;
  queuedCount?: number;
  /** "+ Yaratish" — creates whatever the active tab holds. */
  onCreate?: () => void;
  onOpenModule?: (id: string, m: ContentModule) => void;
  onOpenTask?: (id: string, t: ContentTask) => void;
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * ContentScreen — **C1 «Kontent»** (`Govorim - Teacher.dc.html`).
 *
 * The mockup's segmented control is `Modullar | Vazifalar | Ssenariylar`;
 * **Ssenariylar is not rendered.** There is no scenario table anywhere in the
 * schema, and the student's own `/chat` scenario grid is static frontend data the
 * app never fetches — so a teacher-authored scenario is a whole feature (new
 * table + authoring surface + rewiring the student hub), not a tab. It also needs
 * a product call first: do teacher scenarios REPLACE the curated set or
 * supplement it? An empty third tab would imply the feature exists.
 *
 * Presentational and prop-driven. Full-width, compact density.
 */
export function ContentScreen({
  modules,
  tasks,
  activeTab = "modules",
  onTabChange,
  activeNavKey = "content",
  onNavigate,
  shell,
  moduleExtra,
  modulesEmpty,
  queuedCount = 0,
  onCreate,
  onOpenModule,
  onOpenTask,
}: ContentScreenProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");

  const tabs: TabItem[] = [
    { key: "modules", label: t("teacher.tabModules") },
    { key: "tasks", label: t("teacher.tabTasks") },
  ];

  const shownTasks = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    if (!q) return tasks;
    return tasks.filter(
      (x) =>
        x.title.toLocaleLowerCase().includes(q) || x.prompt.toLocaleLowerCase().includes(q),
    );
  }, [tasks, query]);

  return (
    <AppShell
      brand={<Brand />}
      nav={{
        items: shell?.navItems ?? teacherNavItems(t, queuedCount),
        activeKey: activeNavKey,
        onNavigate,
        label: t("nav.landmark"),
      }}
      headerStart={
        <Text as="h1" variant="title-m">
          {t("nav.content")}
        </Text>
      }
      headerEnd={shell?.headerEnd ?? <NotificationsBell />}
    >
      <div className={styles.page} data-density="compact">
        <header className={styles.head}>
          <Text as="h2" variant="title-l" className={styles.grow}>
            {t("nav.content")}
          </Text>
          <Button variant="primary" size="sm" onClick={onCreate}>
            {t("teacher.create")}
          </Button>
        </header>

        <Tabs
          items={tabs}
          activeKey={activeTab}
          onChange={(k) => onTabChange?.(k as ContentTabKey)}
          aria-label={t("nav.content")}
        />

        {activeTab === "modules" ? (
          modules.length === 0 ? (
            (modulesEmpty ?? <EmptyCard text={t("teacher.noModules")} />)
          ) : (
            <ul className={styles.list}>
              {modules.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    className={styles.row}
                    onClick={() => onOpenModule?.(m.id, m)}
                  >
                    <span className={styles.rowBody}>
                      <Text as="span" variant="body" weight="bold" truncate>
                        {m.name}
                      </Text>
                      <Text as="span" variant="body-s" color="muted" truncate>
                        {[
                          m.level,
                          t("teacher.taskCount", { count: m.taskCount }),
                          // Only claim reach for a published module.
                          m.published ? t("teacher.studentCount", { count: m.studentCount }) : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                      {moduleExtra?.(m)}
                    </span>
                    <Badge variant={m.published ? "success" : "neutral"} size="sm">
                      {m.published ? t("teacher.statusActive") : t("teacher.statusDraft")}
                    </Badge>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : (
          <>
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("teacher.searchTask")}
              aria-label={t("teacher.searchTask")}
            />
            {shownTasks.length === 0 ? (
              <EmptyCard text={tasks.length === 0 ? t("teacher.noTasks") : t("teacher.noMatches")} />
            ) : (
              <ul className={styles.list}>
                {shownTasks.map((x) => (
                  <li key={x.id}>
                    <button
                      type="button"
                      className={styles.row}
                      onClick={() => onOpenTask?.(x.id, x)}
                    >
                      <span className={styles.rowBody}>
                        <span className={styles.titleRow}>
                          <Text as="span" variant="body" weight="bold" truncate>
                            {x.title}
                          </Text>
                          {x.level && (
                            <Badge variant="primary" size="sm">
                              {x.level}
                            </Badge>
                          )}
                        </span>
                        <Text as="span" variant="body-s" color="muted" truncate>
                          {x.prompt}
                        </Text>
                        {x.moduleName && (
                          <Text as="span" variant="body-s" color="muted" truncate>
                            {x.moduleName}
                          </Text>
                        )}
                      </span>
                      <Badge variant={x.published ? "success" : "neutral"} size="sm">
                        {x.published ? t("teacher.statusActive") : t("teacher.statusDraft")}
                      </Badge>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

function EmptyCard({ text }: { text: string }) {
  return (
    <Card variant="flat" padding="md" className={styles.empty}>
      <Text as="p" variant="body" color="muted">
        {text}
      </Text>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Default export — a self-wired demo.                                        */
/* -------------------------------------------------------------------------- */

export default function ContentDemo() {
  const [tab, setTab] = useState<ContentTabKey>("modules");
  return (
    <ContentScreen
      modules={mockContentModules}
      tasks={mockContentTasks}
      activeTab={tab}
      onTabChange={setTab}
    />
  );
}
