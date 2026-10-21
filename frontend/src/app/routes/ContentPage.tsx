/**
 * ContentPage (`/teacher/content`) — C1 «Kontent» (plan Phase 5).
 *
 *   • `GET /api/blocks`    → the Modullar tab
 *   • `GET /api/questions` → the Vazifalar tab
 *   • `POST /api/blocks`   ← "+ Yaratish" on Modullar (a draft module, then its editor)
 *   • `POST /api/questions` · `PATCH` · `DELETE /api/questions/{id}` ← the task editor
 *
 * "+ Yaratish" creates whatever the ACTIVE tab holds: on Modullar it POSTs a new
 * draft module and opens its editor; on Vazifalar it opens the task sheet, where
 * the teacher picks the module the task goes into (or none — a task does not have
 * to belong to a module; an unattached one reaches students by assignment).
 *
 * Like the module editor, a refetch keeps the screen mounted — only the first load
 * shows the full-page spinner — so the task editor survives its own saves.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ContentScreen } from "../../screens/teacher";
import type {
  ContentModule,
  ContentTabKey,
  ContentTask,
  NewTaskDraft,
  TaskPatch,
} from "../../screens/teacher";
import { endpoints } from "../../shared/api";
import { WIDE_QUERY, useMediaQuery } from "../../shared/ui";
import type { TeacherBlockResponse, TeacherQuestionResponse } from "../../shared/api";
import { PageError, PageLoading } from "../PageState";
import { useTeacherNavHandler } from "../nav";
import { useContentPanel } from "../contentPanel";
import { createQuestionArgs, editableTaskFromQuestion, questionPatchArgs } from "../teacherAdapters";

const TABS: ContentTabKey[] = ["modules", "tasks"];

export default function ContentPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  // Teacher by default; the admin's `/admin/content` runs this same page inside its
  // own shell and URL space (see app/contentPanel).
  const panel = useContentPanel();
  const teacherNavigate = useTeacherNavHandler();
  const onNavigate = panel.onNavigate ?? teacherNavigate;
  const [params, setParams] = useSearchParams();
  const wide = useMediaQuery(WIDE_QUERY);

  const raw = params.get("tab");
  const tab: ContentTabKey = TABS.includes(raw as ContentTabKey)
    ? (raw as ContentTabKey)
    : "modules";

  const [blocks, setBlocks] = useState<TeacherBlockResponse[]>([]);
  const [questions, setQuestions] = useState<TeacherQuestionResponse[]>([]);
  const [queued, setQueued] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let alive = true;
    setFailed(false);

    Promise.allSettled([
      endpoints.teacherBlocks(),
      endpoints.teacherQuestions({ limit: 200 }),
      endpoints.teacherReviewCount(),
    ])
      .then(([b, q, r]) => {
        if (!alive) return;
        if (b.status !== "fulfilled") {
          setFailed(true);
          return;
        }
        setBlocks(b.value);
        setQuestions(q.status === "fulfilled" ? q.value : []);
        setQueued(r.status === "fulfilled" ? r.value.count : 0);
      })
      .finally(() => alive && setLoaded(true));

    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const modules = useMemo<ContentModule[]>(
    () =>
      blocks.map((b) => ({
        id: b.id,
        name: b.name,
        level: b.level ?? undefined,
        taskCount: b.task_count,
        studentCount: b.student_count,
        published: b.is_published,
      })),
    [blocks],
  );

  const tasks = useMemo<ContentTask[]>(() => questions.map(editableTaskFromQuestion), [questions]);

  const setTab = useCallback(
    (k: ContentTabKey) => {
      const next = new URLSearchParams(params);
      if (k === "modules") next.delete("tab");
      else next.set("tab", k);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  /** Create a draft module and go straight to its editor — a module with no name
   * would be unidentifiable, so it is seeded with a localized placeholder the
   * teacher immediately renames in the field that has focus. */
  const createModule = useCallback(async () => {
    const created = await endpoints.createBlock({ name: t("teacher.newModule"), ...panel.createDefaults });
    navigate(`${panel.basePath}/${encodeURIComponent(created.id)}`);
  }, [navigate, t, panel]);

  const createTask = useCallback(
    async (draft: NewTaskDraft) => {
      setNotice(null);
      const created = await endpoints.createQuestion(createQuestionArgs(draft, draft.moduleId ?? null));
      // Same two-step as the module editor: the cover needs the new id. A failed
      // upload leaves a saved task, which the notice says, rather than a "failed"
      // that would invite a duplicate.
      if (draft.media) {
        try {
          await endpoints.setQuestionMedia(created.id, draft.media);
        } catch {
          setNotice(t("teacher.mediaUploadFailed"));
        }
      }
      refetch();
    },
    [refetch, t],
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
      setNotice(null);
      await endpoints.setQuestionMedia(taskId, file);
      refetch();
    },
    [refetch],
  );

  const removeTaskMedia = useCallback(
    async (taskId: string) => {
      setNotice(null);
      await endpoints.removeQuestionMedia(taskId);
      refetch();
    },
    [refetch],
  );

  const openModule = useCallback(
    (id: string) => navigate(`${panel.basePath}/${encodeURIComponent(id)}`),
    [navigate, panel.basePath],
  );

  if (!loaded) return <PageLoading />;
  if (failed) return <PageError onRetry={refetch} />;

  return (
    <ContentScreen
      modules={modules}
      tasks={tasks}
      activeTab={tab}
      onTabChange={setTab}
      activeNavKey="content"
      onNavigate={onNavigate}
      shell={panel.shell}
      moduleExtra={
        panel.renderModuleExtra
          ? (m) => {
              const block = blocks.find((b) => b.id === m.id);
              return block ? panel.renderModuleExtra?.(block) : null;
            }
          : undefined
      }
      modulesEmpty={panel.renderModulesEmpty?.(() => void createModule())}
      modulesView={wide ? panel.renderModulesTable?.(blocks, openModule) : undefined}
      queuedCount={queued}
      onCreate={() => void createModule()}
      onOpenModule={openModule}
      onCreateTask={createTask}
      onUpdateTask={updateTask}
      onToggleTaskPublished={toggleTaskPublished}
      onDeleteTask={deleteTask}
      onSetTaskMedia={setTaskMedia}
      onRemoveTaskMedia={removeTaskMedia}
      notice={notice}
    />
  );
}
