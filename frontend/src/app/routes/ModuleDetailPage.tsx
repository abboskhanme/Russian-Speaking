/**
 * ModuleDetailPage (`/practice/module/:moduleId`) — the module DETAIL (D2), and
 * the module COMPLETE (D3) once every task is finished.
 *
 * Fetches `GET /api/blocks/student` and finds the module by the `:moduleId`
 * route param. A module id that isn't in the list redirects back to the Mashq hub
 * (`/practice`). When `done_count >= total` the finished module renders D3 — the
 * average is computed from the module's task bands, the time from `spent_sec`,
 * and the "next" card is the next not-done module in the list; otherwise D2.
 *
 * The two APPEND-ONLY catalog fields this screen consumes — `StudentTaskResponse.
 * band` and `StudentModuleResponse.spent_sec` (contract "Backend") — are read
 * defensively so the page compiles before that additive change lands and stays
 * correct after it does.
 */
import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import {
  ModuleCompleteScreen,
  ModuleDetailScreen,
} from "../../screens/module-detail";
import type {
  ModuleDetailTask,
  ModuleTaskState,
  NextModuleInfo,
} from "../../screens/module-detail";
import { endpoints } from "../../shared/api";
import type {
  StudentModuleResponse,
  StudentTaskResponse,
} from "../../shared/api";
import { PageError, PageLoading } from "../PageState";
import { useNavHandler } from "../nav";

/* The pending catalog additions (contract "Backend"): read as optional so this
 * page type-checks before they are appended to the TS mirrors, and unchanged
 * after. `band` is the student's best band for a task; `spent_sec` the total
 * practice seconds across the module. */
type TaskWithBand = StudentTaskResponse & { band?: number | null };
type ModuleWithSpent = StudentModuleResponse & { spent_sec?: number };

function taskBand(task: StudentTaskResponse): number | null {
  return (task as TaskWithBand).band ?? null;
}

function moduleSpentSec(module: StudentModuleResponse): number {
  return (module as ModuleWithSpent).spent_sec ?? 0;
}

/** Whether a task reads as done / current / locked in the D2 list. The single
 * actionable task is the one whose id equals the module's `next_task_id`; every
 * other not-done task is locked. */
function taskState(
  task: StudentTaskResponse,
  nextTaskId: string | null,
): ModuleTaskState {
  if (task.done) return "done";
  if (task.id === nextTaskId) return "current";
  return "locked";
}

/** Map a wire module's tasks (sorted) into the D2 view-model rows. */
function detailTasks(module: StudentModuleResponse): ModuleDetailTask[] {
  return [...module.tasks]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((task, i) => ({
      id: task.id,
      index: i + 1,
      title: task.title,
      state: taskState(task, module.next_task_id),
      band: taskBand(task),
    }));
}

/** Average of a module's graded task bands (0..100); null when none are graded. */
function averageBand(module: StudentModuleResponse): number | null {
  const bands = module.tasks
    .map(taskBand)
    .filter((b): b is number => b !== null);
  if (bands.length === 0) return null;
  return bands.reduce((sum, b) => sum + b, 0) / bands.length;
}

/** The next module to nudge toward on D3: the first not-done module after the
 * finished one in list order, else the earliest not-done before it, else none.
 * A not-done module with no actionable task (`next_task_id === null`) is locked
 * — the freemium / sequential gate. */
function nextModule(
  modules: StudentModuleResponse[],
  currentId: string,
): NextModuleInfo | null {
  const notDone = (m: StudentModuleResponse) =>
    m.id !== currentId && m.done_count < m.total;
  const idx = modules.findIndex((m) => m.id === currentId);
  const picked =
    modules.slice(idx + 1).find(notDone) ??
    modules.slice(0, Math.max(idx, 0)).find(notDone) ??
    null;
  if (!picked) return null;
  return {
    id: picked.id,
    name: picked.name,
    level: picked.level,
    taskCount: picked.total,
    locked: picked.next_task_id === null,
  };
}

export default function ModuleDetailPage() {
  const { moduleId } = useParams();
  const navigate = useNavigate();
  const onNavigate = useNavHandler();

  const [modules, setModules] = useState<StudentModuleResponse[] | null>(null);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setError(false);
    setModules(null);

    endpoints
      .studentBlocks()
      .then((data) => alive && setModules(data))
      .catch(() => alive && setError(true));

    return () => {
      alive = false;
    };
  }, [reloadKey]);

  if (error) return <PageError onRetry={() => setReloadKey((k) => k + 1)} />;
  if (modules === null) return <PageLoading />;

  const module = modules.find((m) => m.id === moduleId);
  // An unknown / stale module id has nowhere to render — send them to the hub.
  if (!module) return <Navigate to="/practice" replace />;

  const done = module.done_count >= module.total;

  if (done) {
    const next = nextModule(modules, module.id);
    return (
      <ModuleCompleteScreen
        name={module.name}
        done={module.done_count}
        total={module.total}
        averageBand={averageBand(module)}
        spentSec={moduleSpentSec(module)}
        next={next}
        onNextModule={(id) => navigate(`/practice/module/${id}`)}
        onBack={() => navigate("/practice")}
        activeNavKey="practice"
        onNavigate={onNavigate}
      />
    );
  }

  return (
    <ModuleDetailScreen
      name={module.name}
      total={module.total}
      doneCount={module.done_count}
      tasks={detailTasks(module)}
      onStartTask={(id) => navigate(`/task?task=${id}`)}
      onBack={() => navigate("/practice")}
      activeNavKey="practice"
      onNavigate={onNavigate}
    />
  );
}
