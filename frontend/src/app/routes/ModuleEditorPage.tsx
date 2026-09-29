/**
 * ModuleEditorPage (`/teacher/content/:blockId`) — C4 «Modul yaratish» with C5's
 * library picker and C2's new-task sheet (plan Phase 5).
 *
 *   • `GET /api/blocks/{id}`                → the module + its ordered tasks
 *   • `PATCH /api/blocks/{id}`              → rename / describe / publish↔draft
 *   • `GET /api/questions?unassigned=true`  → the picker's library
 *   • `PATCH /api/questions/{id}`           → attach (`block_id`) / detach
 *   • `POST /api/questions`                 → create straight into this module
 *
 * Every mutation refetches the module rather than patching local state: sort
 * order and task counts are computed server-side, so guessing them here would
 * drift from what the next load shows.
 */
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ModuleEditorScreen } from "../../screens/teacher";
import type { EditorTask, LibraryTask, NewTaskDraft } from "../../screens/teacher";
import { endpoints } from "../../shared/api";
import type { TeacherBlockDetailResponse, TeacherQuestionResponse } from "../../shared/api";
import { PageError, PageLoading } from "../PageState";
import { useTeacherNavHandler } from "../nav";
import { useContentPanel } from "../contentPanel";

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
      endpoints.teacherReviewQueue(100),
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
        setQueued(q.status === "fulfilled" ? q.value.length : 0);
      })
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, [blockId, reloadKey]);

  // Cancel a pending search when the page goes away.
  useEffect(() => () => window.clearTimeout(searchTimer.current), []);

  const tasks = useMemo<EditorTask[]>(
    () =>
      (block?.tasks ?? []).map((q) => ({
        id: q.id,
        title: q.title,
        level: q.level ?? undefined,
        published: q.is_published,
        submissionCount: q.submission_count,
        mediaUrl: q.media_url,
      })),
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
      const created = await endpoints.createQuestion({
        title: draft.title,
        prompt_text: draft.prompt,
        level: draft.level || null,
        block_id: blockId,
      });
      // The cover can only be uploaded once the task has an id, so it is a second
      // request. If it fails the task still exists and is saved — reporting "save
      // failed" would be a lie and would tempt the teacher into a duplicate. The
      // row's own media control is where they retry.
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

  const setTaskMedia = useCallback(
    async (taskId: string, file: File) => {
      setMediaNotice(null);
      // Rejections propagate: the row shows the server's own detail, which says
      // WHICH rule was broken (wrong type vs too big).
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

  if (loading) return <PageLoading />;
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
      onSetTaskMedia={setTaskMedia}
      onRemoveTaskMedia={removeTaskMedia}
      notice={mediaNotice}
      onSearchLibrary={searchLibrary}
      // A dedicated per-task editor screen is not part of this phase; the module
      // editor is where a task's module membership and order are changed.
      onOpenTask={() => undefined}
    />
  );
}
