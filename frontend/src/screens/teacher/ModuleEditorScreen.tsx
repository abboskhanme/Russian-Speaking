import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card, Input, Modal, Text } from "../../shared/ui";
import { AppShell, Brand, NotificationsBell, teacherNavItems } from "../../widgets";
import type { NavItem } from "../../widgets";
import { mockModuleEditor } from "./content.mock";
import { BackGlyph } from "./TeacherGroupDetailScreen";
import styles from "./ModuleEditorScreen.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

/** A task row inside the editor's ordered list. */
export interface EditorTask {
  id: string;
  title: string;
  level?: string;
  published: boolean;
  /** Attempts already recorded — an edit here changes what students answered. */
  submissionCount: number;
}

/** A library row offered by the C5 picker (unattached tasks only). */
export interface LibraryTask {
  id: string;
  title: string;
  prompt: string;
  level?: string;
}

/** The C2 "new task" form's payload. */
export interface NewTaskDraft {
  title: string;
  prompt: string;
  level?: string;
  ruStyle?: string;
}

export interface ModuleEditorProps {
  /** Module name; empty on a brand-new module. */
  name: string;
  topic?: string | null;
  level?: string | null;
  published: boolean;
  tasks: EditorTask[];
  /** Unattached tasks for the picker. The caller refetches on `onSearchLibrary`. */
  library: LibraryTask[];
  /** True while a library search is in flight. */
  librarySearching?: boolean;
  activeNavKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
  queuedCount?: number;
  onBack?: () => void;
  /** Save name/topic/level. Rejects on failure so the form can surface it. */
  onSaveMeta?: (args: { name: string; topic?: string; level?: string }) => Promise<void>;
  /** Publish ↔ draft. */
  onTogglePublished?: (next: boolean) => Promise<void>;
  /** C5 — attach an existing task to this module. */
  onAttachTask?: (taskId: string) => Promise<void>;
  /** Remove a task from this module (it survives in the library). */
  onDetachTask?: (taskId: string) => Promise<void>;
  /** C2 — create a task directly into this module. */
  onCreateTask?: (draft: NewTaskDraft) => Promise<void>;
  /** Library search, debounced by the caller. */
  onSearchLibrary?: (term: string) => void;
  onOpenTask?: (taskId: string) => void;
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * ModuleEditorScreen — **C4 «Modul yaratish»**, with **C5 «Vazifa tanlash»** and
 * **C2 «Yangi vazifa»** as sheets off it (`Govorim - Teacher.dc.html`).
 *
 * Mockup order: back + title → name / description / level fields → the ordered
 * task list → "Mavjuddan tanlash" + "+ Yangi vazifa" → Qoralama / Saqlash.
 *
 * **The picker offers only UNATTACHED tasks.** A task belongs to at most one
 * module (`questions.block_id` is a single column), so listing already-attached
 * tasks would invite a silent move out of another module.
 *
 * **Detach keeps the task.** Removing a task from a module unsets its module link
 * rather than deleting it — the work returns to the library, where it can be
 * reused. Deleting content is not something this screen does by accident.
 */
export function ModuleEditorScreen({
  name,
  topic,
  level,
  published,
  tasks,
  library,
  librarySearching,
  activeNavKey = "content",
  onNavigate,
  queuedCount = 0,
  onBack,
  onSaveMeta,
  onTogglePublished,
  onAttachTask,
  onDetachTask,
  onCreateTask,
  onSearchLibrary,
  onOpenTask,
}: ModuleEditorProps) {
  const { t } = useTranslation();

  const [draftName, setDraftName] = useState(name);
  const [draftTopic, setDraftTopic] = useState(topic ?? "");
  const [draftLevel, setDraftLevel] = useState(level ?? "");
  const [savingMeta, setSavingMeta] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [picking, setPicking] = useState(false);
  const [creating, setCreating] = useState(false);

  // Re-seed when the loaded module changes (a fresh fetch after save/publish).
  useEffect(() => {
    setDraftName(name);
    setDraftTopic(topic ?? "");
    setDraftLevel(level ?? "");
  }, [name, topic, level]);

  const dirty =
    draftName.trim() !== name.trim() ||
    draftTopic.trim() !== (topic ?? "").trim() ||
    draftLevel.trim() !== (level ?? "").trim();

  const saveMeta = async () => {
    const n = draftName.trim();
    if (!n || savingMeta) return;
    setSavingMeta(true);
    setMetaError(null);
    try {
      await onSaveMeta?.({ name: n, topic: draftTopic.trim(), level: draftLevel.trim() });
    } catch {
      setMetaError(t("teacher.saveFailed"));
    } finally {
      setSavingMeta(false);
    }
  };

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
          <button
            type="button"
            className={styles.back}
            onClick={onBack}
            aria-label={t("common.back")}
          >
            <BackGlyph />
          </button>
          <Text as="h2" variant="title-l" className={styles.grow} truncate>
            {name || t("teacher.newModule")}
          </Text>
          <Badge variant={published ? "success" : "neutral"} size="md">
            {published ? t("teacher.statusActive") : t("teacher.statusDraft")}
          </Badge>
        </header>

        <Card variant="outline" padding="md" className={styles.form}>
          <Input
            label={t("teacher.moduleName")}
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder={t("teacher.moduleNamePlaceholder")}
            error={metaError ?? undefined}
          />
          <Input
            label={t("teacher.moduleTopic")}
            value={draftTopic}
            onChange={(e) => setDraftTopic(e.target.value)}
            placeholder={t("teacher.moduleTopicPlaceholder")}
          />
          <Input
            label={t("teacher.moduleLevel")}
            value={draftLevel}
            onChange={(e) => setDraftLevel(e.target.value)}
            placeholder="A1–A2"
          />
          <div className={styles.formActions}>
            <Button
              variant="secondary"
              size="sm"
              loading={savingMeta}
              disabled={!draftName.trim() || !dirty}
              onClick={() => void saveMeta()}
            >
              {t("teacher.saveModule")}
            </Button>
          </div>
        </Card>

        <section className={styles.section} aria-label={t("teacher.tabTasks")}>
          <div className={styles.sectionHead}>
            <Text as="h3" variant="label" color="faint">
              {t("teacher.tabTasks")}
            </Text>
            <Text as="span" variant="body-s" color="muted" numeric>
              {t("teacher.taskCount", { count: tasks.length })}
            </Text>
          </div>

          {tasks.length === 0 ? (
            <Card variant="flat" padding="md" className={styles.empty}>
              <Text as="p" variant="body" color="muted">
                {t("teacher.moduleNoTasks")}
              </Text>
            </Card>
          ) : (
            <ol className={styles.taskList}>
              {tasks.map((task, i) => (
                <li key={task.id}>
                  <Card variant="outline" padding="sm" className={styles.taskRow}>
                    <span className={styles.ordinal} aria-hidden>
                      <Text as="span" variant="body-s" weight="bold" numeric>
                        {i + 1}
                      </Text>
                    </span>
                    <button
                      type="button"
                      className={styles.taskBody}
                      onClick={() => onOpenTask?.(task.id)}
                    >
                      <Text as="span" variant="body" weight="semibold" truncate>
                        {task.title}
                      </Text>
                      <Text as="span" variant="body-s" color="muted">
                        {[
                          task.level,
                          task.published ? t("teacher.statusActive") : t("teacher.statusDraft"),
                          // Warn when students have already answered it.
                          task.submissionCount > 0
                            ? t("teacher.answered", { count: task.submissionCount })
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                    </button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={styles.detachBtn}
                      onClick={() => void onDetachTask?.(task.id)}
                    >
                      {t("teacher.removeFromModule")}
                    </Button>
                  </Card>
                </li>
              ))}
            </ol>
          )}

          <div className={styles.addRow}>
            <Button variant="secondary" size="sm" onClick={() => setPicking(true)}>
              {t("teacher.pickExisting")}
            </Button>
            <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
              {t("teacher.newTask")}
            </Button>
          </div>
        </section>

        <div className={styles.publishRow}>
          <Button
            variant={published ? "secondary" : "primary"}
            onClick={() => void onTogglePublished?.(!published)}
          >
            {published ? t("teacher.unpublish") : t("teacher.publish")}
          </Button>
          <Text as="p" variant="body-s" color="muted">
            {published ? t("teacher.publishedHint") : t("teacher.draftHint")}
          </Text>
        </div>
      </div>

      <LibrarySheet
        open={picking}
        onClose={() => setPicking(false)}
        library={library}
        searching={librarySearching}
        onSearch={onSearchLibrary}
        onAttach={onAttachTask}
      />

      <NewTaskSheet open={creating} onClose={() => setCreating(false)} onCreate={onCreateTask} />
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* C5 — Vazifa tanlash (library picker)                                       */
/* -------------------------------------------------------------------------- */

function LibrarySheet({
  open,
  onClose,
  library,
  searching,
  onSearch,
  onAttach,
}: {
  open: boolean;
  onClose: () => void;
  library: LibraryTask[];
  searching?: boolean;
  onSearch?: (term: string) => void;
  onAttach?: (id: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [term, setTerm] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const attach = async (id: string) => {
    if (busy) return;
    setBusy(id);
    try {
      await onAttach?.(id);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("teacher.pickTaskTitle")}
      closeLabel={t("common.close")}
      size="full"
    >
      <div className={styles.sheet}>
        <Text as="p" variant="body-s" color="muted">
          {t("teacher.pickTaskHint")}
        </Text>
        <Input
          type="search"
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            onSearch?.(e.target.value);
          }}
          placeholder={t("teacher.searchTask")}
          aria-label={t("teacher.searchTask")}
        />

        {searching ? (
          <Text as="p" variant="body-s" color="faint">
            {t("common.loading")}
          </Text>
        ) : library.length === 0 ? (
          <Card variant="flat" padding="md" className={styles.empty}>
            <Text as="p" variant="body-s" color="muted">
              {t("teacher.libraryEmpty")}
            </Text>
          </Card>
        ) : (
          <ul className={styles.libList}>
            {library.map((x) => (
              <li key={x.id}>
                <Card variant="outline" padding="sm" className={styles.libRow}>
                  <span className={styles.libBody}>
                    <span className={styles.titleRow}>
                      <Text as="span" variant="body" weight="semibold" truncate>
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
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busy === x.id}
                    onClick={() => void attach(x.id)}
                  >
                    {t("teacher.add")}
                  </Button>
                </Card>
              </li>
            ))}
          </ul>
        )}

        <div className={styles.sheetActions}>
          <Button variant="primary" onClick={onClose}>
            {t("teacher.done")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* C2 — Yangi vazifa                                                          */
/* -------------------------------------------------------------------------- */

function NewTaskSheet({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate?: (draft: NewTaskDraft) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [level, setLevel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setTitle("");
    setPrompt("");
    setLevel("");
    setError(null);
  };

  const create = async () => {
    if (!title.trim() || !prompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate?.({ title: title.trim(), prompt: prompt.trim(), level: level.trim() });
      reset();
      onClose();
    } catch {
      setError(t("teacher.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title={t("teacher.newTaskTitle")}
      closeLabel={t("common.close")}
      size="full"
    >
      <div className={styles.sheet}>
        <Input
          label={t("teacher.taskTitle")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("teacher.taskTitlePlaceholder")}
          autoFocus
        />

        <div className={styles.field}>
          <Text as="label" variant="body-s" weight="semibold">
            {t("teacher.taskPrompt")}
          </Text>
          {/* The prompt is Russian and can run to several sentences, so it needs a
              textarea rather than a single-line input. */}
          <textarea
            className={styles.textarea}
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t("teacher.taskPromptPlaceholder")}
            aria-label={t("teacher.taskPrompt")}
          />
        </div>

        <Input
          label={t("teacher.taskLevel")}
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          placeholder="A2"
        />

        {/* Media upload is not wired: Question.MediaKey and object storage exist,
            but there is no multipart endpoint for it yet. Saying so beats an
            upload control that silently does nothing. */}
        <Text as="p" variant="body-s" color="faint">
          {t("teacher.mediaLater")}
        </Text>

        {error && (
          <Text as="p" variant="body-s" color="danger" role="alert">
            {error}
          </Text>
        )}

        <div className={styles.sheetActions}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!title.trim() || !prompt.trim()}
            onClick={() => void create()}
          >
            {t("teacher.saveDraft")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Default export — a self-wired demo.                                        */
/* -------------------------------------------------------------------------- */

export default function ModuleEditorDemo() {
  return <ModuleEditorScreen {...mockModuleEditor} />;
}
