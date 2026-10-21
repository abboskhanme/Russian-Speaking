import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card, Input, Modal, Switch, Text } from "../../shared/ui";
import { Page } from "../../widgets";
import type { NavItem } from "../../widgets";
import { mockModuleEditor } from "./content.mock";
import { BackGlyph } from "./TeacherGroupDetailScreen";
import { LevelChips } from "./ChoiceChips";
import { TaskEditorSheet } from "./TaskEditorSheet";
import type { EditableTask, NewTaskDraft, TaskPatch } from "./TaskEditorSheet";
import styles from "./ModuleEditorScreen.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

/** A task row inside the editor's ordered list — the same shape the task editor
 * sheet edits, so a tap on the row opens it with nothing refetched. */
export type EditorTask = EditableTask;

export type { NewTaskDraft, TaskPatch } from "./TaskEditorSheet";

/** A library row offered by the C5 picker (unattached tasks only). */
export interface LibraryTask {
  id: string;
  title: string;
  prompt: string;
  level?: string;
}

/** Why a module delete did not happen. `conflict` is the server's 409 — it judged
 * the delete unsafe — and is worded differently from a plain failure, because
 * retrying will not help and the teacher needs the alternative instead. */
export type ModuleDeleteResult = { ok: true } | { ok: false; reason: "conflict" | "failed" };

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
  /** Another panel's frame (the admin's `/admin/content/:id` reuses this screen).
   * Absent = the teacher nav and header. */
  shell?: { navItems: NavItem[]; headerEnd?: ReactNode };
  /** Rendered under the name/topic/level form — the admin's visibility picker. */
  metaExtra?: ReactNode;
  queuedCount?: number;
  onBack?: () => void;
  /** Save name/topic/level. Rejects on failure so the form can surface it. */
  onSaveMeta?: (args: { name: string; topic?: string; level?: string }) => Promise<void>;
  /** Publish ↔ draft. Publishing a module also publishes its draft tasks (server). */
  onTogglePublished?: (next: boolean) => Promise<void>;
  /** C5 — attach an existing task to this module. */
  onAttachTask?: (taskId: string) => Promise<void>;
  /** Remove a task from this module (it survives in the library). */
  onDetachTask?: (taskId: string) => Promise<void>;
  /** C2 — create a task directly into this module. */
  onCreateTask?: (draft: NewTaskDraft) => Promise<void>;
  /** Save an edit from the task editor sheet — only the changed fields. */
  onUpdateTask?: (taskId: string, patch: TaskPatch) => Promise<void>;
  /** One task's own publish switch (`PATCH /api/questions/{id} {is_published}`). */
  onToggleTaskPublished?: (taskId: string, next: boolean) => Promise<void>;
  /** Soft-delete a task. Omit and the editor offers no delete. */
  onDeleteTask?: (taskId: string) => Promise<void>;
  /** Set or REPLACE an existing task's media. Omit and the editor's media control
   * is not rendered, so a read-only host stays read-only. */
  onSetTaskMedia?: (taskId: string, file: File) => Promise<void>;
  /** Clear an existing task's media. */
  onRemoveTaskMedia?: (taskId: string) => Promise<void>;
  /** Delete the whole module. Omit and the control is not rendered. */
  onDeleteModule?: () => Promise<ModuleDeleteResult>;
  /** A partial-success message from the host (e.g. the task saved but its cover
   * did not upload). Shown above the task list; null hides it. */
  notice?: string | null;
  /** Library search, debounced by the caller. */
  onSearchLibrary?: (term: string) => void;
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
 * **What students see is TWO switches, and both are on screen.** A student sees a
 * task only when its module is published AND the task itself is. Each row
 * therefore states its own Faol / Qoralama and carries its own switch, and the
 * status line under the list reports the real reach — it says "your students see
 * this module" only when at least one published task is actually in it, and
 * otherwise says why not. Before this the line promised reach for a published
 * module whose every task was still a draft.
 *
 * **Tapping a row opens the task editor** (the C2 form, extended): every field,
 * media, the publish switch and a soft delete.
 *
 * **The picker offers only UNATTACHED tasks.** A task belongs to at most one
 * module (`questions.block_id` is a single column), so listing already-attached
 * tasks would invite a silent move out of another module.
 *
 * **Detach keeps the task.** "Olib tashlash" unsets its module link rather than
 * deleting it — the work returns to the library. Deleting is a separate, confirmed
 * action inside the task editor.
 */
export function ModuleEditorScreen({
  name,
  topic,
  level,
  published,
  tasks,
  library,
  librarySearching,
  metaExtra,
  onBack,
  onSaveMeta,
  onTogglePublished,
  onAttachTask,
  onDetachTask,
  onCreateTask,
  onUpdateTask,
  onToggleTaskPublished,
  onDeleteTask,
  onSetTaskMedia,
  onRemoveTaskMedia,
  onDeleteModule,
  notice,
  onSearchLibrary,
}: ModuleEditorProps) {
  const { t } = useTranslation();

  const [draftName, setDraftName] = useState(name);
  const [draftTopic, setDraftTopic] = useState(topic ?? "");
  const [draftLevel, setDraftLevel] = useState(level?.trim() ?? "");
  const [savingMeta, setSavingMeta] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [picking, setPicking] = useState(false);
  const [creating, setCreating] = useState(false);
  // An id, not a copy of the row: after a publish toggle or a media change the
  // host refetches, and the open editor must show the NEW state, not the one it
  // opened with (the admin sheet once held a snapshot and lied about premium).
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = useMemo(() => tasks.find((x) => x.id === editingId) ?? null, [tasks, editingId]);
  const [deletingModule, setDeletingModule] = useState(false);

  // Re-seed when the loaded module changes (a fresh fetch after save/publish).
  useEffect(() => {
    setDraftName(name);
    setDraftTopic(topic ?? "");
    setDraftLevel(level?.trim() ?? "");
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

  const liveCount = tasks.filter((x) => x.published).length;
  const draftCount = tasks.length - liveCount;

  return (
    <Page title={t("nav.content")}>
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
          <LevelChips
            label={t("teacher.moduleLevel")}
            value={draftLevel}
            stored={level}
            onChange={setDraftLevel}
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

        {metaExtra}

        <section className={styles.section} aria-label={t("teacher.tabTasks")}>
          <div className={styles.sectionHead}>
            <Text as="h3" variant="label" color="muted">
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
                  <TaskRow
                    task={task}
                    ordinal={i + 1}
                    onOpen={() => setEditingId(task.id)}
                    onTogglePublished={onToggleTaskPublished}
                    onDetach={onDetachTask}
                  />
                </li>
              ))}
            </ol>
          )}

          {notice && (
            <Text as="p" variant="body-s" color="warn" role="status">
              {notice}
            </Text>
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
          <ReachLine published={published} total={tasks.length} live={liveCount} drafts={draftCount} />
        </div>

        {onDeleteModule && (
          <div className={styles.dangerRow}>
            <Button
              variant="ghost"
              size="sm"
              className={styles.dangerBtn}
              onClick={() => setDeletingModule(true)}
            >
              {t("teacher.module.delete")}
            </Button>
          </div>
        )}
      </div>

      <LibrarySheet
        open={picking}
        onClose={() => setPicking(false)}
        library={library}
        searching={librarySearching}
        onSearch={onSearchLibrary}
        onAttach={onAttachTask}
      />

      <TaskEditorSheet
        open={creating}
        onClose={() => setCreating(false)}
        fixedModule={{ name: name || t("teacher.newModule"), published }}
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

      {onDeleteModule && (
        <DeleteModuleDialog
          open={deletingModule}
          name={name || t("teacher.newModule")}
          taskCount={tasks.length}
          onClose={() => setDeletingModule(false)}
          onDelete={onDeleteModule}
        />
      )}
    </Page>
  );
}

/* -------------------------------------------------------------------------- */
/* Parts                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One task in the module. The title opens the editor; the state is BOTH a labelled
 * badge and a switch, so the row says "Qoralama" in words (colour is never the
 * only signal) and changes it in one tap. No press-scale on the row: it holds its
 * own edge controls, and a row that shrinks under the pointer moves them out from
 * under the click.
 */
function TaskRow({
  task,
  ordinal,
  onOpen,
  onTogglePublished,
  onDetach,
}: {
  task: EditorTask;
  ordinal: number;
  onOpen: () => void;
  onTogglePublished?: (taskId: string, next: boolean) => Promise<void>;
  onDetach?: (taskId: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const toggle = async (next: boolean) => {
    if (!onTogglePublished || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await onTogglePublished(task.id, next);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const meta = [
    task.level,
    // Warn when students have already answered it.
    task.submissionCount > 0 ? t("teacher.answered", { count: task.submissionCount }) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Card variant="outline" padding="sm" className={styles.taskRow}>
      <span className={styles.ordinal} aria-hidden>
        <Text as="span" variant="body-s" weight="bold" numeric>
          {ordinal}
        </Text>
      </span>
      <button type="button" className={styles.taskBody} onClick={onOpen}>
        <Text as="span" variant="body" weight="semibold" truncate>
          {task.title}
        </Text>
        {meta && (
          <Text as="span" variant="body-s" color="muted">
            {meta}
          </Text>
        )}
      </button>
      <span className={styles.taskActions}>
        <Badge variant={task.published ? "success" : "neutral"} size="sm">
          {task.published ? t("teacher.statusActive") : t("teacher.statusDraft")}
        </Badge>
        {onTogglePublished && (
          <Switch
            checked={task.published}
            disabled={busy}
            onChange={(next) => void toggle(next)}
            aria-label={t("teacher.task.publishAria", { task: task.title })}
          />
        )}
        {onDetach && (
          <Button
            variant="ghost"
            size="sm"
            className={styles.detachBtn}
            onClick={() => void onDetach(task.id)}
          >
            {t("teacher.removeFromModule")}
          </Button>
        )}
      </span>
      {failed && (
        <Text as="p" variant="body-s" color="danger" role="alert" className={styles.rowError}>
          {t("teacher.saveFailed")}
        </Text>
      )}
    </Card>
  );
}

/**
 * The line under the publish button — who actually sees this module right now.
 *
 * It only claims reach when there is reach: a published module with zero
 * published tasks shows students an empty module, and "O'quvchilaringiz bu modulni
 * ko'rmoqda" there was a promise the data did not keep.
 */
function ReachLine({
  published,
  total,
  live,
  drafts,
}: {
  published: boolean;
  total: number;
  live: number;
  drafts: number;
}) {
  const { t } = useTranslation();
  let text: string;
  let tone: "muted" | "warn" = "muted";
  if (!published) {
    text = drafts > 0 ? t("teacher.module.draftWithTasks") : t("teacher.draftHint");
  } else if (total === 0) {
    text = t("teacher.module.liveEmpty");
    tone = "warn";
  } else if (live === 0) {
    text = t("teacher.module.liveNoPublished");
    tone = "warn";
  } else if (drafts > 0) {
    text = t("teacher.module.liveSomeDrafts", { live, drafts });
  } else {
    text = t("teacher.publishedHint");
  }
  return (
    <Text as="p" variant="body-s" color={tone} role="status">
      {text}
    </Text>
  );
}

/**
 * Module delete. The module goes; its tasks are soft-deleted with it, and every
 * answer and grade students already have is kept — the dialog says both before the
 * tap, not after. A 409 means the server judged it unsafe: that reads as a reason
 * and an alternative (take it back to a draft), not as "try again".
 */
function DeleteModuleDialog({
  open,
  name,
  taskCount,
  onClose,
  onDelete,
}: {
  open: boolean;
  name: string;
  taskCount: number;
  onClose: () => void;
  onDelete: () => Promise<ModuleDeleteResult>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setError(null);
    onClose();
  };

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await onDelete();
    setBusy(false);
    if (result.ok) {
      onClose();
      return;
    }
    setError(
      result.reason === "conflict" ? t("teacher.module.deleteConflict") : t("teacher.module.deleteFailed"),
    );
  };

  return (
    <Modal open={open} onClose={close} title={t("teacher.module.deleteTitle")} closeLabel={t("common.close")}>
      <div className={styles.sheet}>
        <Text as="p" variant="body" weight="semibold">
          {t("teacher.module.deleteConfirm", { module: name })}
        </Text>
        <Text as="p" variant="body-s" color="ink-soft">
          {t("teacher.module.deleteTasks", { count: taskCount })}
        </Text>
        <Text as="p" variant="body-s" color="ink-soft">
          {t("teacher.task.deleteKeeps")}
        </Text>
        {error && (
          <Text as="p" variant="body-s" color="danger" role="alert">
            {error}
          </Text>
        )}
        <div className={styles.sheetActions}>
          <Button variant="ghost" onClick={close} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void confirm()}>
            {t("teacher.task.deleteCta")}
          </Button>
        </div>
      </div>
    </Modal>
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
          <Text as="p" variant="body-s" color="muted">
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
/* Default export — a self-wired demo.                                        */
/* -------------------------------------------------------------------------- */

export default function ModuleEditorDemo() {
  return <ModuleEditorScreen {...mockModuleEditor} />;
}
