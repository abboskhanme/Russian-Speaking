/**
 * AssignTaskPage (`/teacher/assign`) — D3 «Topshiriq berish» (plan Phase 6).
 *
 * Reads three lists the teacher already owns, and writes through whichever
 * assignment endpoint the selection calls for:
 *
 *   • `GET  /api/groups`         → the "Kimga" list, with the roster counts
 *   • `GET  /api/questions`      → the task library
 *   • `GET  /api/blocks`         → the modules
 *   • `POST /api/assignments`         ← a single task
 *   • `POST /api/assignments/module`  ← a whole module's published tasks
 *
 * `?group=<id>` preselects a group; both the A2 group cards and the A5 group
 * detail already navigate here that way.
 *
 * **Only PUBLISHED content is offered.** A draft reaches no student — Kontent
 * (Phase 5) creates everything as a draft on purpose — so assigning one would
 * write rows that silently resolve to nothing. `/assignments/module` enforces the
 * same rule server-side and 400s on a module with no published tasks; filtering
 * here means the teacher never gets that far.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AssignTaskScreen } from "../../screens/teacher";
import type { AssignGroupOption, AssignOutcome, AssignSelection } from "../../screens/teacher";
import { endpoints } from "../../shared/api";
import type {
  GroupResponse,
  TeacherBlockResponse,
  TeacherQuestionResponse,
} from "../../shared/api";
import { PageError, PageLoading } from "../PageState";
import { useTeacherNavHandler } from "../nav";

export default function AssignTaskPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const onNavigate = useTeacherNavHandler();
  const [params] = useSearchParams();
  const initialGroupId = params.get("group");

  const [groups, setGroups] = useState<GroupResponse[]>([]);
  const [questions, setQuestions] = useState<TeacherQuestionResponse[]>([]);
  const [blocks, setBlocks] = useState<TeacherBlockResponse[]>([]);
  const [queued, setQueued] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);

    (async () => {
      const [g, q, b, rq] = await Promise.allSettled([
        endpoints.teacherGroups(),
        endpoints.teacherQuestions(),
        endpoints.teacherBlocks(),
        endpoints.teacherReviewQueue(100),
      ]);
      if (!alive) return;

      // Groups are load-bearing: with no roster there is nobody to assign to, and
      // the screen's own empty state says so. The content lists degrade to their
      // own empty state instead.
      if (g.status !== "fulfilled") {
        setFailed(true);
        setLoading(false);
        return;
      }
      setGroups(g.value);
      setQuestions(q.status === "fulfilled" ? q.value : []);
      setBlocks(b.status === "fulfilled" ? b.value : []);
      setQueued(rq.status === "fulfilled" ? rq.value.length : 0);
      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const groupOptions = useMemo<AssignGroupOption[]>(
    () => groups.map((g) => ({ id: g.id, name: g.name, memberCount: g.member_count })),
    [groups],
  );

  const tasks = useMemo<AssignSelection[]>(
    () =>
      questions
        .filter((q) => q.is_published)
        .map((q) => ({
          id: q.id,
          kind: "task" as const,
          title: q.title,
          // Level and module, whichever exist — the same secondary line C1 shows.
          subtitle: [q.level, q.block_name].filter(Boolean).join(" · ") || undefined,
        })),
    [questions],
  );

  const modules = useMemo<AssignSelection[]>(
    () =>
      blocks
        // A published module with zero published tasks would 400 on submit, so it
        // is not offered at all.
        .filter((b) => b.is_published && b.task_count > 0)
        .map((b) => ({
          id: b.id,
          kind: "module" as const,
          title: b.name,
          subtitle: [b.level, t("teacher.taskCount", { count: b.task_count })]
            .filter(Boolean)
            .join(" · "),
          taskCount: b.task_count,
        })),
    [blocks, t],
  );

  const assign = useCallback(
    async ({
      selection,
      groupId,
      dueAt,
    }: {
      selection: AssignSelection;
      groupId: string;
      dueAt: string | null;
    }): Promise<AssignOutcome> => {
      try {
        const rows =
          selection.kind === "module"
            ? await endpoints.createModuleAssignments({
                block_id: selection.id,
                group_id: groupId,
                ...(dueAt ? { due_at: dueAt } : {}),
              })
            : await endpoints.createAssignments({
                question_id: selection.id,
                group_id: groupId,
                ...(dueAt ? { due_at: dueAt } : {}),
              });
        // The RESPONSE is the count: the server drops targets outside the
        // teacher's roster and skips tasks a student already has.
        return { created: rows.length };
      } catch (e) {
        const detail =
          e && typeof e === "object" && "message" in e ? String((e as Error).message) : "";
        // The server's own `detail` is preferred — "Module has no published tasks"
        // tells the teacher what to do; a generic failure line does not.
        return { created: 0, error: detail || t("teacher.assignTask.failed") };
      }
    },
    [t],
  );

  if (loading) return <PageLoading />;
  if (failed) return <PageError onRetry={() => setReloadKey((k) => k + 1)} />;

  return (
    <AssignTaskScreen
      tasks={tasks}
      modules={modules}
      groups={groupOptions}
      initialGroupId={initialGroupId}
      activeNavKey="classes"
      onNavigate={onNavigate}
      queuedCount={queued}
      onBack={() => navigate(-1)}
      onAssign={assign}
      onGoToClasses={() => navigate("/teacher/classes")}
      onGoToContent={() => navigate("/teacher/content")}
    />
  );
}
