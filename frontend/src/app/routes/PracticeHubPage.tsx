/**
 * PracticeHubPage (`/practice`) — the real Mashq hub, wired across its two tabs:
 * Modullar · Topshiriqlar. (AI Suhbat is its own destination, `ConversationHub
 * Page` at `/chat`, reached from the centre FAB.)
 *
 * Modullar comes from `GET /api/blocks/student` (the student's modules with
 * per-module progress); Topshiriqlar from `GET /api/assignments/mine` (one-off
 * teacher assignments). A third, non-load-bearing call to `GET /api/review/drill`
 * decides whether the «Xatolar ustida» entry appears — it 404s while the drill
 * flag is off, and that rejection is the whole flag check on this screen. The
 * fetches are fault-tolerant like ProfilePage: a failure in one section degrades
 * it to an empty state rather than blanking the page; only a total outage of the
 * two real sections is a hard error.
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
 * fall back to an empty string rather than render "null". `id` keys the row;
 * `taskId` is what "Boshlash" opens — the assignment's QUESTION, never the
 * assignment row's own id (which the task screen cannot resolve). */
function mapAssignment(a: AssignmentResponse): PracticeHubScreenProps["assignments"][number] {
  return {
    id: a.id,
    taskId: a.question_id,
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
  const [reviewDue, setReviewDue] = useState(0);
  const [soundsDrill, setSoundsDrill] = useState(false);
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

    // `allSettled`, not `all`: one dead section must not blank the page. The
    // drill probe rides along on the same rule and rejects with a 404 whenever
    // `review_drill_enabled` is off — which is precisely how a flagged-off
    // feature should read here: its entry simply never appears.
    Promise.allSettled([
      endpoints.studentBlocks(),
      endpoints.assignmentsMine(),
      endpoints.reviewDrill(),
      endpoints.drillPairs(),
    ])
      .then(([b, a, r, d]) => {
        if (!alive) return;

        // Only a total outage of the two REAL sections is a hard error; any
        // partial success renders. The drill is never load-bearing here.
        if (b.status === "rejected" && a.status === "rejected") {
          setError(true);
          return;
        }

        setModules(b.status === "fulfilled" ? b.value.map(mapModule) : []);
        setAssignments(a.status === "fulfilled" ? a.value.map(mapAssignment) : []);
        setReviewDue(r.status === "fulfilled" ? r.value.due_count : 0);
        // Tovushlar mashqi had a route and a screen but no way in. Its availability is a
        // 200 with a state, not a 404, so the entry reads the state: shown when the drill
        // can be practised today or its budget is merely spent (the screen says so);
        // hidden when the flag is off or no STT key is set, where it could only refuse.
        setSoundsDrill(
          d.status === "fulfilled" &&
            d.value.pairs.length > 0 &&
            (d.value.state === "Ready" || d.value.state === "BudgetSpent"),
        );
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
      reviewDrill={{ dueCount: reviewDue, onStart: () => navigate("/review") }}
      soundsDrill={soundsDrill ? { onStart: () => navigate("/drill") } : null}
      activeTab={activeTab}
      onChangeTab={setActiveTab}
      activeNavKey="practice"
      onNavigate={onNavigate}
    />
  );
}
