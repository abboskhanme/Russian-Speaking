/**
 * ContentPage (`/teacher/content`) — C1 «Kontent» (plan Phase 5).
 *
 *   • `GET /api/blocks`    → the Modullar tab
 *   • `GET /api/questions` → the Vazifalar tab
 *
 * "+ Yaratish" creates whatever the ACTIVE tab holds: on Modullar it POSTs a new
 * draft module and opens its editor; on Vazifalar it opens the editor of a
 * throwaway-free path — a task always belongs somewhere, so a bare task is
 * created from inside a module's editor instead (see ModuleEditorPage).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ContentScreen } from "../../screens/teacher";
import type { ContentModule, ContentTabKey, ContentTask } from "../../screens/teacher";
import { endpoints } from "../../shared/api";
import type { TeacherBlockResponse, TeacherQuestionResponse } from "../../shared/api";
import { PageError, PageLoading } from "../PageState";
import { useTeacherNavHandler } from "../nav";
import { useContentPanel } from "../contentPanel";

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

  const raw = params.get("tab");
  const tab: ContentTabKey = TABS.includes(raw as ContentTabKey)
    ? (raw as ContentTabKey)
    : "modules";

  const [blocks, setBlocks] = useState<TeacherBlockResponse[]>([]);
  const [questions, setQuestions] = useState<TeacherQuestionResponse[]>([]);
  const [queued, setQueued] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);

    Promise.allSettled([
      endpoints.teacherBlocks(),
      endpoints.teacherQuestions({ limit: 200 }),
      endpoints.teacherReviewQueue(100),
    ])
      .then(([b, q, r]) => {
        if (!alive) return;
        if (b.status !== "fulfilled") {
          setFailed(true);
          return;
        }
        setBlocks(b.value);
        setQuestions(q.status === "fulfilled" ? q.value : []);
        setQueued(r.status === "fulfilled" ? r.value.length : 0);
      })
      .finally(() => alive && setLoading(false));

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

  const tasks = useMemo<ContentTask[]>(
    () =>
      questions.map((q) => ({
        id: q.id,
        title: q.title,
        prompt: q.prompt_text,
        level: q.level ?? undefined,
        moduleName: q.block_name ?? undefined,
        published: q.is_published,
      })),
    [questions],
  );

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
  const create = useCallback(async () => {
    const created = await endpoints.createBlock({ name: t("teacher.newModule"), ...panel.createDefaults });
    navigate(`${panel.basePath}/${encodeURIComponent(created.id)}`);
  }, [navigate, t, panel]);

  if (loading) return <PageLoading />;
  if (failed) return <PageError onRetry={() => setReloadKey((k) => k + 1)} />;

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
      modulesEmpty={panel.renderModulesEmpty?.(() => void create())}
      queuedCount={queued}
      onCreate={() => void create()}
      onOpenModule={(id) => navigate(`${panel.basePath}/${encodeURIComponent(id)}`)}
      // A task's home is its module; opening one from the flat list goes to the
      // module editor when it has one, and otherwise there is nowhere better yet.
      onOpenTask={(id) => {
        const q = questions.find((x) => x.id === id);
        if (q?.block_id) {
          navigate(`${panel.basePath}/${encodeURIComponent(q.block_id)}`);
        }
      }}
    />
  );
}
