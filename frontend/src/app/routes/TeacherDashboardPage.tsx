/**
 * TeacherDashboardPage (`/teacher`) — the teacher's **A1 «Obzor»**, wired to the
 * API (Teacher panel plan, Phase 1). Composes from existing endpoints — no
 * bespoke aggregate endpoint:
 *
 *   • `GET /api/groups`          → the teacher's groups (Guruh + O'quvchi tiles)
 *   • `GET /api/submissions`     → the roster's attempts → the grading-queue count,
 *                                  which drives both the Navbatda tile and the
 *                                  "AI ishonchi past" attention card
 *   • `GET /api/groups/requests` → the "qo'shilish so'rovi" card
 *   • `GET /api/reports/gradebook` → per-student `trend_delta` → the "ball tushdi" card
 *   • `GET /api/reports/insights`  → `errors[0]` → the "sinf xatosi" card
 *
 * Fault-tolerant like {@link HomePage}: `allSettled`, so a dead section degrades
 * to empty instead of blanking the page.
 *
 * **All four attention cards are real now** (plan Phase 6b). Three of them were
 * held back through Phases 1–5 because nothing behind them existed, and a faked
 * count on a teacher's triage screen is worse than a missing card; Phase 2b's
 * join-request model and Phase 6's insights + per-student trend supplied the last
 * of the missing data.
 *
 * The one deliberate narrowing that remains: the drop card counts students whose
 * trend is at or below {@link DROP_POINTS} points, not anyone drifting a fraction.
 * Every roster has someone half a point down on any given day, and a card that
 * fires every morning is one a teacher learns to ignore.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TeacherDashboardScreen } from "../../screens/teacher";
import type {
  TeacherAttentionItem,
  TeacherProfile,
  TeacherStats,
} from "../../screens/teacher";
import { endpoints } from "../../shared/api";
import type {
  GradebookRowResponse,
  GroupJoinRequestResponse,
  GroupResponse,
  InsightsResponse,
  SubmissionResponse,
} from "../../shared/api";
import { useAuth } from "../../shared/auth";
import { firstName } from "../adapters";
import { PageError, PageLoading } from "../PageState";
import { TEACHER_NAV_PATH, useTeacherNavHandler } from "../nav";
import { useTranslation } from "react-i18next";

/** How far a student must have fallen before the Obzor says so. A roster always
 * has someone a fraction down, and a card that fires every morning is one a
 * teacher learns to scroll past. */
const DROP_POINTS = 5;

export default function TeacherDashboardPage() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const onNavigate = useTeacherNavHandler();

  const [groups, setGroups] = useState<GroupResponse[]>([]);
  const [subs, setSubs] = useState<SubmissionResponse[]>([]);
  const [requests, setRequests] = useState<GroupJoinRequestResponse[]>([]);
  const [gradebook, setGradebook] = useState<GradebookRowResponse[]>([]);
  const [insights, setInsights] = useState<InsightsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);

    // allSettled, not all: one dead section must not blank the page. Groups is the
    // load-bearing fetch — if it fails the page is empty, so we surface an error.
    // Each attention card sits behind its own fetch, so a failing aggregate costs
    // exactly one card rather than the whole triage screen.
    Promise.allSettled([
      endpoints.teacherGroups(),
      endpoints.teacherSubmissions(),
      endpoints.teacherJoinRequests(),
      endpoints.teacherGradebook(),
      endpoints.teacherInsights(),
    ])
      .then(([g, s, r, gb, ins]) => {
        if (!alive) return;
        if (g.status === "fulfilled") setGroups(g.value);
        else setFailed(true);
        setSubs(s.status === "fulfilled" ? s.value : []);
        setRequests(r.status === "fulfilled" ? r.value : []);
        setGradebook(gb.status === "fulfilled" ? gb.value : []);
        setInsights(ins.status === "fulfilled" ? ins.value : null);
      })
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const teacher = useMemo<TeacherProfile>(
    () => ({
      name: user ? firstName(user.full_name) : "",
      greeting: t(`home.greeting.${timeSlot()}`),
      // Initials come from the FULL name so the avatar reads "AK", not "A" —
      // the greeting deliberately uses only the first name, so the screen's
      // own fallback would derive a single letter from it.
      initials: user ? initialsOf(user.full_name) : undefined,
    }),
    [user, t],
  );

  /** Attempts AI grading has finished (`status === "done"`) but no teacher has
   * signed off on (`reviewed_at === null`) — the Navbat queue. */
  const queued = useMemo(
    () => subs.filter((s) => s.status === "done" && s.reviewed_at === null).length,
    [subs],
  );

  const stats = useMemo<TeacherStats>(
    () => ({
      groups: groups.length,
      // Roster reach across the teacher's groups. A student in two of the same
      // teacher's groups double-counts — `GroupResponse` carries only a count, so
      // deduping would mean fetching every roster. Phase 2/3 can refine it.
      students: groups.reduce((sum, g) => sum + g.member_count, 0),
      queued,
    }),
    [groups, queued],
  );

  /** Students who have genuinely fallen back. `trend_delta` is null under four
   * graded answers, and null is NOT a drop — a student with too little history is
   * unknown, not declining. */
  const dropped = useMemo(
    () => gradebook.filter((r) => r.trend_delta != null && r.trend_delta <= -DROP_POINTS),
    [gradebook],
  );

  const attention = useMemo<TeacherAttentionItem[]>(() => {
    const items: TeacherAttentionItem[] = [];

    // Most urgent first, and the queue outranks the rest: it is work already
    // waiting on this teacher, not a situation to look into.
    if (queued > 0) {
      items.push({
        id: "low-confidence",
        tone: "danger",
        title: t("teacher.lowConfidence", { count: queued }),
        hint: t("teacher.lowConfidenceHint"),
      });
    }

    if (requests.length > 0) {
      items.push({
        id: "join-requests",
        tone: "accent",
        title: t("teacher.joinRequests", { count: requests.length }),
        hint: t("teacher.joinRequestsHint"),
      });
    }

    if (dropped.length > 0) {
      // The headline quotes the STEEPEST fall, not the average of the fallers: the
      // card exists to name the worst case a teacher should look at first.
      const worst = Math.min(...dropped.map((r) => r.trend_delta ?? 0));
      items.push({
        id: "dropped",
        tone: "warn",
        title: t("teacher.dropped", { count: dropped.length, points: Math.abs(Math.round(worst)) }),
        // The hint has to match where the tap actually goes: "Profilni ko'rish"
        // is a promise the card cannot keep when it opens a roster of several.
        hint: dropped.length === 1 ? t("teacher.droppedHint") : t("teacher.droppedHintMany"),
      });
    }

    const topError = insights?.errors[0];
    if (topError) {
      items.push({
        id: "class-errors",
        tone: "warn",
        title: t("teacher.classErrors", {
          // An error type the frontend has not learned yet shows its raw key
          // rather than blanking the card.
          error: t(`teacher.errorType.${topError.type}`, { defaultValue: topError.type }),
        }),
        hint: t("teacher.classErrorsHint", { count: topError.student_count }),
      });
    }

    return items;
  }, [queued, requests.length, dropped, insights, t]);

  const openAttention = useCallback(
    (id: string) => {
      if (id === "low-confidence") navigate(TEACHER_NAV_PATH.queue);
      else if (id === "join-requests") navigate("/teacher/classes?tab=requests");
      // With exactly one faller the card can honour the mockup's "Profilni ko'rish"
      // literally; with several there is no single profile to open, so it lands on
      // the roster where every student's arrow is visible at once.
      else if (id === "dropped")
        navigate(
          dropped.length === 1
            ? `/teacher/students/${dropped[0].student_id}`
            : "/teacher/classes?tab=students",
        );
      else if (id === "class-errors") navigate(TEACHER_NAV_PATH.analytics);
    },
    [navigate, dropped],
  );

  if (loading) return <PageLoading />;
  if (failed || !user) return <PageError onRetry={() => setReloadKey((k) => k + 1)} />;

  return (
    <TeacherDashboardScreen
      teacher={teacher}
      stats={stats}
      attention={attention}
      activeNavKey="home"
      onNavigate={onNavigate}
      onOpenAttention={openAttention}
      // The teacher nav has no Profil item — the header avatar is that entry.
      // Its screen is plan Phase 7; until then it resolves back to Obzor.
      onOpenProfile={() => navigate("/teacher/profile")}
    />
  );
}

/** "Aziz Karimov" → "AK" (up to two letters), for the header avatar. */
function initialsOf(fullName: string): string {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/** Local time-of-day → the shared `home.greeting.*` key (morning/afternoon/
 * evening/night). Reused rather than duplicating the copy under `teacher.*`. */
function timeSlot(): "morning" | "afternoon" | "evening" | "night" {
  const h = new Date().getHours();
  if (h < 6) return "night";
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}
