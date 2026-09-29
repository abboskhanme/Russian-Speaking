import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card, Input, Tabs, Text } from "../../shared/ui";
import type { TabItem } from "../../shared/ui";
import { AppShell, Brand, NotificationsBell, teacherNavItems } from "../../widgets";
import type { NavItem } from "../../widgets";
import { mockContentModules, mockContentTasks } from "./content.mock";
import { TaskEditorSheet } from "./TaskEditorSheet";
import type { EditableTask, NewTaskDraft, TaskModuleOption, TaskPatch } from "./TaskEditorSheet";
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

/** One row of the Vazifalar tab — the editor's own shape, so a tap opens the task
 * editor with nothing refetched. `prompt` is the row's truncated second line. */
export type ContentTask = EditableTask;

export type ContentTabKey = "modules" | "tasks";

export interface ContentScreenProps {
  modules: ContentModule[];
  tasks: ContentTask[];
  activeTab?: ContentTabKey;
  onTabChange?: (k: ContentTabKey) => void;
  activeNavKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
  queuedCount?: number;
  /** "+ Yaratish" on the Modullar tab — a new draft module. */
  onCreate?: () => void;
  onOpenModule?: (id: string, m: ContentModule) => void;
  /** "+ Yaratish" on the Vazifalar tab — a new TASK, into the module the teacher
   * picks in the sheet (or none). Omit and that tab's create button is hidden. */
  onCreateTask?: (draft: NewTaskDraft) => Promise<void>;
  onUpdateTask?: (taskId: string, patch: TaskPatch) => Promise<void>;
  onToggleTaskPublished?: (taskId: string, next: boolean) => Promise<void>;
  onDeleteTask?: (taskId: string) => Promise<void>;
  onSetTaskMedia?: (taskId: string, file: File) => Promise<void>;
  onRemoveTaskMedia?: (taskId: string) => Promise<void>;
  /** A partial-success message (the task saved, its cover did not upload). */
  notice?: string | null;
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * ContentScreen — **C1 «Kontent»** (`Govorim - Teacher.dc.html`).
 *
 * The mockup's segmented control is `Modullar | Vazifalar | Ssenariylar`;
 * **Ssenariylar is not rendered.** The curated roleplay scenarios live in a
 * `scenarios` table served by `/api/roleplay/scenarios`, but there is no teacher
 * AUTHORING surface for them, and the owner has deferred teacher-authored
 * scenarios (C3 · C6) until after launch (2026-09-29). An empty third tab would
 * imply the feature exists.
 *
 * **"+ Yaratish" creates what the active tab holds.** On Modullar a draft module;
 * on Vazifalar a TASK, in a sheet that lets the teacher pick its module (or none) —
 * it used to create a "Yangi modul" draft from either tab, so a teacher trying to
 * add a task collected empty modules instead.
 *
 * Tapping a task opens the same editor the module screen uses, so an unattached
 * task — which has no module screen — can still be edited, published or deleted.
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
  queuedCount = 0,
  onCreate,
  onOpenModule,
  onCreateTask,
  onUpdateTask,
  onToggleTaskPublished,
  onDeleteTask,
  onSetTaskMedia,
  onRemoveTaskMedia,
  notice,
}: ContentScreenProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [creatingTask, setCreatingTask] = useState(false);
  // An id, never a copy: the list refetches after a publish toggle or a media
  // change, and the open editor must show what the server now holds.
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = useMemo(() => tasks.find((x) => x.id === editingId) ?? null, [tasks, editingId]);

  const moduleOptions = useMemo<TaskModuleOption[]>(
    () => modules.map((m) => ({ id: m.id, name: m.name, published: m.published })),
    [modules],
  );

  const onTasksTab = activeTab === "tasks";
  const create = () => {
    if (onTasksTab) setCreatingTask(true);
    else onCreate?.();
  };

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
        items: teacherNavItems(t, queuedCount),
        activeKey: activeNavKey,
        onNavigate,
        label: t("nav.landmark"),
      }}
      headerStart={
        <Text as="h1" variant="title-m">
          {t("nav.content")}
        </Text>
      }
      headerEnd={<NotificationsBell />}
    >
      <div className={styles.page} data-density="compact">
        <header className={styles.head}>
          <Text as="h2" variant="title-l" className={styles.grow}>
            {t("nav.content")}
          </Text>
          <Button variant="primary" size="sm" onClick={create}>
            {onTasksTab ? t("teacher.createTask") : t("teacher.create")}
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
            <EmptyCard text={t("teacher.noModules")} />
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
            {notice && (
              <Text as="p" variant="body-s" color="warn" role="status">
                {notice}
              </Text>
            )}
            {shownTasks.length === 0 ? (
              <EmptyCard text={tasks.length === 0 ? t("teacher.noTasks") : t("teacher.noMatches")} />
            ) : (
              <ul className={styles.list}>
                {shownTasks.map((x) => (
                  <li key={x.id}>
                    <button
                      type="button"
                      className={styles.row}
                      onClick={() => setEditingId(x.id)}
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

      <TaskEditorSheet
        open={creatingTask}
        onClose={() => setCreatingTask(false)}
        modules={moduleOptions}
        onCreate={onCreateTask}
      />

      <TaskEditorSheet
        open={editing !== null}
        onClose={() => setEditingId(null)}
        task={editing}
        onSave={onUpdateTask}
        onTogglePublished={onToggleTaskPublished}
        onDelete={onDeleteTask}
        onSetMedia={onSetTaskMedia}
        onRemoveMedia={onRemoveTaskMedia}
      />
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
