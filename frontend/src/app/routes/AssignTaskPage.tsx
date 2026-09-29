/**
 * AssignTaskPage (`/teacher/assign`) — D3 «Topshiriq berish» (plan Phase 6).
 *
 * Reads three lists the teacher already owns, and writes through whichever
 * assignment endpoint the selection calls for:
 *
 *   • `GET  /api/groups`         → the "Kimga" list, with the roster counts
 *   • `GET  /api/questions`      → the task library (and which module tasks are live)
 *   • `GET  /api/blocks`         → the modules
 *   • `GET  /api/classroom/students/{id}` → the one student, for `?student=`
 *   • `POST /api/assignments`         ← a single task
 *   • `POST /api/assignments/module`  ← a whole module's published tasks
 *
 * `?group=<id>` preselects a group (A2 cards, A5). `?student=<id>` targets ONE
 * student (A6's "Topshiriq berish"): the write goes out as `student_ids`, and the
 * screen names that student instead of offering groups. It used to ignore the
 * param and show the group picker, so A6's button assigned to nobody in particular.
 *
 * **Only PUBLISHED content is offered.** A draft reaches no student, so assigning
 * one would write rows that silently resolve to nothing. A published module with no
 * published task is shown DISABLED with the reason — `/assignments/module` refuses
 * it, and the server's English "Module has no published tasks" used to reach the
 * teacher verbatim.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AssignTaskScreen } from "../../screens/teacher";
import type {
  AssignGroupOption,
  AssignOutcome,
  AssignSelection,
  AssignStudentTarget,
} from "../../screens/teacher";
import { endpoints } from "../../shared/api";
import type {
  GroupResponse,
  TeacherBlockResponse,
  TeacherQuestionResponse,
} from "../../shared/api";
import { PageError, PageLoading } from "../PageState";
import { useTeacherNavHandler } from "../nav";
import { apiErrorCode, apiErrorStatus, assignableTasks } from "../teacherAdapters";

/** The library read's ceiling. Below it the list is COMPLETE, and a module's
 * published-task count computed from it is a fact; at it, the count may be short
 * and a module is never disabled on that basis. */
const QUESTION_LIMIT = 200;

export default function AssignTaskPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const onNavigate = useTeacherNavHandler();
  const [params] = useSearchParams();
  const initialGroupId = params.get("group");
  const studentId = params.get("student");

  const [groups, setGroups] = useState<GroupResponse[]>([]);
  const [questions, setQuestions] = useState<TeacherQuestionResponse[]>([]);
  const [blocks, setBlocks] = useState<TeacherBlockResponse[]>([]);
  const [student, setStudent] = useState<AssignStudentTarget | null>(null);
  const [studentMissing, setStudentMissing] = useState(false);
  const [queued, setQueued] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);
    setStudentMissing(false);

    (async () => {
      const [g, q, b, rq, st] = await Promise.allSettled([
        endpoints.teacherGroups(),
        endpoints.teacherQuestions({ limit: QUESTION_LIMIT }),
        endpoints.teacherBlocks(),
        endpoints.teacherReviewCount(),
        studentId ? endpoints.classroomStudent(studentId) : Promise.resolve(null),
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
      setQueued(rq.status === "fulfilled" ? rq.value.count : 0);

      if (studentId) {
        let target: AssignStudentTarget | null =
          st.status === "fulfilled" && st.value ? { id: st.value.id, name: st.value.full_name } : null;
        // The student read is new; if it is not there (or failed), the rosters are
        // the other place a name lives. Teachers run a handful of groups.
        if (!target) {
          const rosters = await Promise.allSettled(
            g.value.map((grp) => endpoints.teacherGroupDetail(grp.id)),
          );
          if (!alive) return;
          for (const r of rosters) {
            if (r.status !== "fulfilled") continue;
            const m = r.value.members.find((x) => x.id === studentId);
            if (m) {
              target = { id: m.id, name: m.full_name };
              break;
            }
          }
        }
        setStudent(target);
        setStudentMissing(target === null);
      } else {
        setStudent(null);
      }
      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [reloadKey, studentId]);

  const groupOptions = useMemo<AssignGroupOption[]>(
    () => groups.map((g) => ({ id: g.id, name: g.name, memberCount: g.member_count })),
    [groups],
  );

  const tasks = useMemo<AssignSelection[]>(() => {
    return assignableTasks(questions, blocks)
        .map((q) => ({
          id: q.id,
          kind: "task" as const,
          title: q.title,
          // Level and module, whichever exist — the same secondary line C1 shows.
          subtitle: [q.level, q.block_name].filter(Boolean).join(" · ") || undefined,
        }));
  }, [questions, blocks]);

  const modules = useMemo<AssignSelection[]>(() => {
    const complete = questions.length < QUESTION_LIMIT;
    return (
      blocks
        .filter((b) => b.is_published && b.task_count > 0)
        .map((b) => {
          const live = questions.filter((q) => q.block_id === b.id && q.is_published).length;
          // `task_count` counts drafts too. Only when the library read is complete
          // is "0 live tasks" a fact worth disabling the module over.
          const empty = complete && live === 0;
          return {
            id: b.id,
            kind: "module" as const,
            title: b.name,
            subtitle: [
              b.level,
              complete
                ? t("teacher.assignTask.liveTasks", { count: live })
                : t("teacher.taskCount", { count: b.task_count }),
            ]
              .filter(Boolean)
              .join(" · "),
            taskCount: complete ? live : b.task_count,
            disabledReason: empty ? t("teacher.assignTask.moduleNoLive") : undefined,
          };
        })
    );
  }, [blocks, questions, t]);

  const assign = useCallback(
    async ({
      selection,
      groupId,
      studentId: target,
      dueAt,
      maxAttempts,
    }: {
      selection: AssignSelection;
      groupId: string | null;
      studentId: string | null;
      dueAt: string | null;
      maxAttempts: number | null;
    }): Promise<AssignOutcome> => {
      // Omitted rather than sent as null: "unlimited" is the server's default for
      // an absent field, so not sending it says the same thing with less wire.
      const budget = maxAttempts === null ? {} : { max_attempts: maxAttempts };
      const who = target ? { student_ids: [target] } : groupId ? { group_id: groupId } : {};
      const due = dueAt ? { due_at: dueAt } : {};
      try {
        if (selection.kind === "module") {
          const rows = await endpoints.createModuleAssignments({
            block_id: selection.id,
            ...who,
            ...due,
            ...budget,
          });
          // A module skips per TASK (anything the student was ever given), so the
          // rows cannot say who "already had it" — only how many rows were written.
          return { created: rows.length };
        }
        const rows = await endpoints.createAssignments({
          question_id: selection.id,
          ...who,
          ...due,
          ...budget,
        });
        // One row per student who got it. Everyone else targeted already had the
        // task OPEN — the server skips those rather than handing out a second copy.
        const got = new Set(rows.map((r) => r.student_id)).size;
        const targeted = target ? 1 : (groups.find((g) => g.id === groupId)?.member_count ?? got);
        return { created: got, alreadyHad: Math.max(0, targeted - got) };
      } catch (e) {
        // Never the server's own text. A draft task is 400 `question_not_published`;
        // a 400 on a module is its (uncoded) "no published task" refusal; anything
        // else is a plain failure.
        const status = apiErrorStatus(e);
        const code = apiErrorCode(e);
        return {
          created: 0,
          error:
            code === "question_not_published"
              ? t("teacher.assignTask.questionNotPublished")
              : selection.kind === "module" && status === 400
                ? t("teacher.assignTask.moduleNoLive")
                : t("teacher.assignTask.failed"),
        };
      }
    },
    [groups, t],
  );

  if (loading) return <PageLoading />;
  if (failed) return <PageError onRetry={() => setReloadKey((k) => k + 1)} />;

  return (
    <AssignTaskScreen
      tasks={tasks}
      modules={modules}
      groups={groupOptions}
      initialGroupId={initialGroupId}
      student={student}
      studentMissing={studentMissing}
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
