/**
 * ModuleEditorPage (`/teacher/content/:blockId`) — C4 «Modul yaratish» with C5's
 * library picker and the C2 task editor (plan Phase 5).
 *
 *   • `GET /api/blocks/{id}`                → the module + its ordered tasks
 *   • `PATCH /api/blocks/{id}`              → rename / describe / publish↔draft
 *                                             (publishing also publishes its draft tasks)
 *   • `DELETE /api/blocks/{id}`             → delete the module (409 = refused as unsafe)
 *   • `GET /api/questions?unassigned=true`  → the picker's library
 *   • `PATCH /api/questions/{id}`           → attach (`block_id`) / detach / edit / publish
 *   • `POST /api/questions`                 → create straight into this module
 *   • `DELETE /api/questions/{id}`          → soft-delete a task (answers kept)
 *
 * Every mutation refetches the module rather than patching local state: sort
 * order, task counts and the publish cascade are computed server-side, so guessing
 * them here would drift from what the next load shows.
 *
 * **A refetch keeps the screen mounted.** Only the FIRST load shows the full-page
 * spinner; later ones swap the data in underneath. Unmounting on every refetch
 * would close the task editor after each media upload or publish toggle and throw
 * away whatever the teacher had typed in it.
 */
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ModuleEditorScreen } from "../../screens/teacher";
import type {
  EditorTask,
  LibraryTask,
  ModuleDeleteResult,
  NewTaskDraft,
  TaskPatch,
} from "../../screens/teacher";
import { endpoints } from "../../shared/api";
import type { TeacherBlockDetailResponse, TeacherQuestionResponse } from "../../shared/api";
import { PageError, PageLoading } from "../PageState";
import { useTeacherNavHandler } from "../nav";
import { useContentPanel } from "../contentPanel";
import {
  apiErrorStatus,
  createQuestionArgs,
  editableTaskFromQuestion,
  questionPatchArgs,
} from "../teacherAdapters";

/** Debounce for the library search, so typing does not fire a request per key. */
const SEARCH_DEBOUNCE_MS = 250;

export default function ModuleEditorPage() {
  const { blockId = "" } = useParams();
  const navigate = useNavigate();
  // Teacher by default; `/admin/content/:blockId` runs this same page inside the
  // admin shell and URL space (see app/contentPanel).
  const panel = useContentPanel();
  const teacherNavigate = useTeacherNavHandler();
  const onNavigate = panel.onNavigate ?? teacherNavigate;
  const { t } = useTranslation();

  const [block, setBlock] = useState<TeacherBlockDetailResponse | null>(null);
  const [library, setLibrary] = useState<TeacherQuestionResponse[]>([]);
  const [librarySearching, setLibrarySearching] = useState(false);
  const [queued, setQueued] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  /** Set only when a task SAVED but its cover did not upload — a partial success
   * the screen must state, since the task is really there. */
  const [mediaNotice, setMediaNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const searchTimer = useRef<number | undefined>(undefined);

  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);

    Promise.allSettled([
      endpoints.teacherBlock(blockId),
      endpoints.teacherQuestions({ unassignedOnly: true, limit: 100 }),
      endpoints.teacherReviewCount(),
    ])
      .then(([b, lib, q]) => {
        if (!alive) return;
        // A 404 here means the module is not yours — show the error, not a shell.
        if (b.status !== "fulfilled") {
          setFailed(true);
          return;
        }
        setBlock(b.value);
        setLibrary(lib.status === "fulfilled" ? lib.value : []);
        setQueued(q.status === "fulfilled" ? q.value.count : 0);
      })
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, [blockId, reloadKey]);

  // Cancel a pending search when the page goes away.
  useEffect(() => () => window.clearTimeout(searchTimer.current), []);

  const tasks = useMemo<EditorTask[]>(
    () => (block?.tasks ?? []).map(editableTaskFromQuestion),
    [block],
  );

  const libraryRows = useMemo<LibraryTask[]>(
    () =>
      library.map((q) => ({
        id: q.id,
        title: q.title,
        prompt: q.prompt_text,
        level: q.level ?? undefined,
      })),
    [library],
  );

  const searchLibrary = useCallback((term: string) => {
    window.clearTimeout(searchTimer.current);
    setLibrarySearching(true);
    searchTimer.current = window.setTimeout(() => {
      endpoints
        .teacherQuestions({ search: term || undefined, unassignedOnly: true, limit: 100 })
        .then(setLibrary)
        .catch(() => setLibrary([]))
        .finally(() => setLibrarySearching(false));
    }, SEARCH_DEBOUNCE_MS);
  }, []);

  const saveMeta = useCallback(
    async (args: { name: string; topic?: string; level?: string }) => {
      await endpoints.updateBlock(blockId, {
        name: args.name,
        // Blank clears the field server-side, which is what an emptied input means.
        topic: args.topic ?? "",
        level: args.level ?? "",
      });
      refetch();
    },
    [blockId, refetch],
  );

  const togglePublished = useCallback(
    async (next: boolean) => {
      await endpoints.updateBlock(blockId, { is_published: next });
      refetch();
    },
    [blockId, refetch],
  );

  const attachTask = useCallback(
    async (taskId: string) => {
      await endpoints.updateQuestion(taskId, { block_id: blockId });
      refetch();
    },
    [blockId, refetch],
  );

  const detachTask = useCallback(
    async (taskId: string) => {
      // detach_block, not block_id: over JSON an absent field and an explicit null
      // are indistinguishable, so removal needs its own flag.
      await endpoints.updateQuestion(taskId, { detach_block: true });
      refetch();
    },
    [refetch],
  );

  const createTask = useCallback(
    async (draft: NewTaskDraft) => {
      setMediaNotice(null);
      const created = await endpoints.createQuestion(createQuestionArgs(draft, blockId));
      // The cover can only be uploaded once the task has an id, so it is a second
      // request. If it fails the task still exists and is saved — reporting "save
      // failed" would be a lie and would tempt the teacher into a duplicate. The
      // task editor's own media control is where they retry.
      if (draft.media) {
        try {
          await endpoints.setQuestionMedia(created.id, draft.media);
        } catch {
          setMediaNotice(t("teacher.mediaUploadFailed"));
        }
      }
      refetch();
    },
    [blockId, refetch, t],
  );

  const updateTask = useCallback(
    async (taskId: string, patch: TaskPatch) => {
      await endpoints.updateQuestion(taskId, questionPatchArgs(patch));
      refetch();
    },
    [refetch],
  );

  const toggleTaskPublished = useCallback(
    async (taskId: string, next: boolean) => {
      await endpoints.updateQuestion(taskId, { is_published: next });
      refetch();
    },
    [refetch],
  );

  const deleteTask = useCallback(
    async (taskId: string) => {
      await endpoints.deleteQuestion(taskId);
      refetch();
    },
    [refetch],
  );

  const setTaskMedia = useCallback(
    async (taskId: string, file: File) => {
      setMediaNotice(null);
      await endpoints.setQuestionMedia(taskId, file);
      refetch();
    },
    [refetch],
  );

  const removeTaskMedia = useCallback(
    async (taskId: string) => {
      setMediaNotice(null);
      await endpoints.removeQuestionMedia(taskId);
      refetch();
    },
    [refetch],
  );

  const deleteModule = useCallback(async (): Promise<ModuleDeleteResult> => {
    try {
      await endpoints.deleteBlock(blockId);
      // Back to THIS panel's list — an admin deleting from /admin/content stays there.
      navigate(panel.basePath, { replace: true });
      return { ok: true };
    } catch (e) {
      // 409: the server refused because it cannot be done safely. That is a
      // different sentence from "something failed" — retrying will not help.
      return { ok: false, reason: apiErrorStatus(e) === 409 ? "conflict" : "failed" };
    }
  }, [blockId, navigate, panel.basePath]);

  if (loading && !block) return <PageLoading />;
  if (failed || !block) return <PageError onRetry={refetch} />;

  return (
    <ModuleEditorScreen
      name={block.name}
      topic={block.topic}
      level={block.level}
      published={block.is_published}
      tasks={tasks}
      library={libraryRows}
      librarySearching={librarySearching}
      activeNavKey="content"
      onNavigate={onNavigate}
      shell={panel.shell}
      metaExtra={panel.renderEditorExtra?.(block, refetch)}
      queuedCount={queued}
      onBack={() => navigate(panel.basePath)}
      onSaveMeta={saveMeta}
      onTogglePublished={togglePublished}
      onAttachTask={attachTask}
      onDetachTask={detachTask}
      onCreateTask={createTask}
      onUpdateTask={updateTask}
      onToggleTaskPublished={toggleTaskPublished}
      onDeleteTask={deleteTask}
      onSetTaskMedia={setTaskMedia}
      onRemoveTaskMedia={removeTaskMedia}
      onDeleteModule={deleteModule}
      notice={mediaNotice}
      onSearchLibrary={searchLibrary}
    />
  );
}
