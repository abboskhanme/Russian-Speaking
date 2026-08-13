/**
 * PracticeHubPage (`/practice`) — the real Mashq hub, wired across its two tabs:
 * Modullar · Topshiriqlar. (AI Suhbat is its own destination, `ConversationHub
 * Page` at `/chat`, reached from the centre FAB.)
 *
 * Modullar comes from `GET /api/blocks/student` (the student's modules with
 * per-module progress); Topshiriqlar from `GET /api/assignments/mine` (one-off
 * teacher assignments). The two fetches are fault-tolerant like ProfilePage: a
 * failure in one section degrades it to an empty state rather than blanking the
 * page; only a total outage (both requests rejected) is a hard error.
 *
 * The active tab is URL-driven (`?tab=`) so a deep-link and an in-page switch
 * share one source of truth and the choice survives a data refetch.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PracticeHubScreen } from "../../screens/practice-hub";
import type {
  PracticeHubScreenProps,
  PracticeHubTabKey,
  PracticeModule,
} from "../../screens/practice-hub";
import { endpoints } from "../../shared/api";
import type { AssignmentResponse, StudentModuleResponse } from "../../shared/api";
import { PageError, PageLoading } from "../PageState";
import { useNavHandler } from "../nav";

/** Wire → presentational module. `locked` is derived: a module with no
 * actionable next task that is not yet finished is gated (freemium / sequential),
 * so the card shows the Pro lock. */
function mapModule(m: StudentModuleResponse): PracticeModule {
  return {
    id: m.id,
    name: m.name,
    level: m.level,
    total: m.total,
    done: m.done_count,
    visibility: m.visibility,
    locked: m.next_task_id === null && m.done_count < m.total,
  };
}

/** Wire → the Topshiriqlar row shape. `question_title` is nullable on the wire;
 * fall back to an empty string rather than render "null". */
function mapAssignment(a: AssignmentResponse): PracticeHubScreenProps["assignments"][number] {
  return {
    id: a.id,
    title: a.question_title ?? "",
    dueAt: a.due_at,
    completed: a.completed,
    band: a.overall_band,
    maxAttempts: a.max_attempts,
    attemptsUsed: a.attempts_used,
  };
}

export default function PracticeHubPage() {
  const onNavigate = useNavHandler();
  const navigate = useNavigate();

  const [modules, setModules] = useState<PracticeModule[]>([]);
  const [assignments, setAssignments] = useState<PracticeHubScreenProps["assignments"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // The active tab is URL-driven (`?tab=`), so one source of truth serves the
  // Mashq item (`/practice` → Modullar), a Topshiriqlar deep-link
  // (`/practice?tab=assignments`) and an in-page switch alike. Deriving it from
  // the query (rather than one-shot local state) also means the choice survives
  // the data refetch below for free.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeTab: PracticeHubTabKey = tabParam === "assignments" ? "assignments" : "modules";
  const setActiveTab = useCallback(
    (tab: PracticeHubTabKey) =>
      // Modullar is the default → keep its URL clean (drop the query).
      setSearchParams(tab === "modules" ? {} : { tab }, { replace: true }),
    [setSearchParams],
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);

    // `allSettled`, not `all`: one dead section must not blank the page.
    Promise.allSettled([endpoints.studentBlocks(), endpoints.assignmentsMine()])
      .then(([b, a]) => {
        if (!alive) return;

        // Only a total outage is a hard error; any partial success renders.
        if (b.status === "rejected" && a.status === "rejected") {
          setError(true);
          return;
        }

        setModules(b.status === "fulfilled" ? b.value.map(mapModule) : []);
        setAssignments(a.status === "fulfilled" ? a.value.map(mapAssignment) : []);
      })
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, [reloadKey]);

  if (error) return <PageError onRetry={() => setReloadKey((k) => k + 1)} />;
  if (loading) return <PageLoading />;

  return (
    <PracticeHubScreen
      modules={modules}
      onOpenModule={(id) => navigate(`/practice/module/${id}`)}
      assignments={assignments}
      onStartTask={(taskId) => navigate(`/task?task=${taskId}`)}
      activeTab={activeTab}
      onChangeTab={setActiveTab}
      activeNavKey="practice"
      onNavigate={onNavigate}
    />
  );
}
