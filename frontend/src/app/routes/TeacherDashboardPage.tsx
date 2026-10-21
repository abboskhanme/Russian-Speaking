/**
 * TeacherDashboardPage (`/teacher`) — the teacher's **A1 «Obzor»**, wired to the
 * API (Teacher panel plan, Phase 1). Composes from existing endpoints — no
 * bespoke aggregate endpoint:
 *
 *   • `GET /api/groups`          → the teacher's groups (Guruh tile)
 *   • `GET /api/groups/{id}`     → each roster, so the O'quvchi tile counts DISTINCT
 *                                  students (one in two groups is one student)
 *   • `GET /api/submissions`     → the roster's attempts → the grading-queue count,
 *                                  which drives both the Navbatda tile and the
 *                                  "N ta javob tekshiruvingizni kutmoqda" card. (The
 *                                  mockup words it "AI ishonchi past"; there is no
 *                                  AI-confidence value anywhere, so the card says
 *                                  what it counts: graded answers not yet reviewed.)
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
  TeacherBehindItem,
  TeacherProfile,
  TeacherQuickAction,
  TeacherRecentItem,
  TeacherStats,
} from "../../screens/teacher";
import type { MiniBar } from "../../shared/ui/Chart";
import { endpoints } from "../../shared/api";
import type {
  GradebookRowResponse,
  GroupDetailResponse,
  GroupJoinRequestResponse,
  GroupResponse,
  InsightsResponse,
  SubmissionResponse,
} from "../../shared/api";
import { useAuth } from "../../shared/auth";
import { firstName } from "../adapters";
import { distinctStudentCount } from "../teacherAdapters";
import { PageError, PageLoading } from "../PageState";
import { TEACHER_NAV_PATH, useTeacherNavHandler } from "../nav";
import { useTranslation } from "react-i18next";

/** How far a student must have fallen before the Obzor says so. A roster always
 * has someone a fraction down, and a card that fires every morning is one a
 * teacher learns to scroll past. */
const DROP_POINTS = 5;
/** Days without an answer before a student counts as "falling behind". */
const IDLE_DAYS = 7;
/** How many waiting answers / falling-behind students the Obzor lists. */
const LIST_MAX = 5;

export default function TeacherDashboardPage() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const onNavigate = useTeacherNavHandler();

  const [groups, setGroups] = useState<GroupResponse[]>([]);
  const [rosters, setRosters] = useState<GroupDetailResponse[]>([]);
  const [queued, setQueued] = useState(0);
  const [requests, setRequests] = useState<GroupJoinRequestResponse[]>([]);
  const [gradebook, setGradebook] = useState<GradebookRowResponse[]>([]);
  const [insights, setInsights] = useState<InsightsResponse | null>(null);
  const [waiting, setWaiting] = useState<SubmissionResponse[] | null>(null);
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
    (async () => {
      const [g, s, r, gb, ins, w] = await Promise.allSettled([
        endpoints.teacherGroups(),
        endpoints.teacherReviewCount(),
        endpoints.teacherJoinRequests(),
        endpoints.teacherGradebook(),
        endpoints.teacherInsights(),
        endpoints.teacherReviewQueue(LIST_MAX),
      ]);
      if (!alive) return;
      if (g.status === "fulfilled") setGroups(g.value);
      else setFailed(true);
      setQueued(s.status === "fulfilled" ? s.value.count : 0);
      setRequests(r.status === "fulfilled" ? r.value : []);
      setGradebook(gb.status === "fulfilled" ? gb.value : []);
      setInsights(ins.status === "fulfilled" ? ins.value : null);
      setWaiting(w.status === "fulfilled" ? w.value : null);

      // The rosters, for a DISTINCT student count. One request per group — a
      // teacher runs a handful — and a failed one only costs that group's dedup.
      if (g.status === "fulfilled") {
        const rs = await Promise.allSettled(g.value.map((grp) => endpoints.teacherGroupDetail(grp.id)));
        if (!alive) return;
        setRosters(
          rs
            .filter((x): x is PromiseFulfilledResult<GroupDetailResponse> => x.status === "fulfilled")
            .map((x) => x.value),
        );
      }
      setLoading(false);
    })();

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

  const stats = useMemo<TeacherStats>(
    () => ({
      groups: groups.length,
      // DISTINCT students across the teacher's groups — summing `member_count`
      // counted a student who sits in two of this teacher's groups twice.
      students: distinctStudentCount(groups, rosters),
      queued,
    }),
    [groups, rosters, queued],
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
        id: "queue",
        tone: "danger",
        title: t("teacher.queueWaiting", { count: queued }),
        hint: t("teacher.queueWaitingHint"),
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
      if (id === "queue") navigate(TEACHER_NAV_PATH.queue);
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

  // The first few answers waiting for review — each opens straight into B2.
  const recent = useMemo<TeacherRecentItem[] | undefined>(
    () =>
      waiting?.map((s) => ({
        id: s.id,
        studentName: s.student_name ?? "—",
        taskTitle: s.question_title ?? t("results.attempt"),
        score: s.overall_band,
        when: relativeWhen(t, s.created_at),
      })),
    [waiting, t],
  );

  // Falling behind: a big score drop first (it is a signal about the work), then
  // the students who have gone quiet, then the ones who never started.
  const behind = useMemo<TeacherBehindItem[]>(() => {
    const now = Date.now();
    const rows: Array<TeacherBehindItem & { rank: number }> = [];
    for (const r of gradebook) {
      if (r.trend_delta != null && r.trend_delta <= -DROP_POINTS) {
        rows.push({
          id: r.student_id,
          name: r.full_name,
          reason: t("uiDash.teacher.reasonDrop", { points: Math.abs(Math.round(r.trend_delta)) }),
          tone: "danger",
          rank: 0,
        });
        continue;
      }
      if (r.attempts === 0 || !r.last_activity) {
        rows.push({ id: r.student_id, name: r.full_name, reason: t("uiDash.teacher.reasonNever"), tone: "warn", rank: 2 });
        continue;
      }
      const days = Math.floor((now - Date.parse(r.last_activity)) / 86_400_000);
      if (days >= IDLE_DAYS)
        rows.push({
          id: r.student_id,
          name: r.full_name,
          reason: t("uiDash.teacher.reasonIdle", { count: days }),
          tone: days >= 2 * IDLE_DAYS ? "danger" : "warn",
          rank: 1,
        });
    }
    return rows
      .sort((a, b) => a.rank - b.rank)
      .slice(0, LIST_MAX)
      .map(({ rank: _rank, ...item }) => item);
  }, [gradebook, t]);

  // The class's week: 7 product days ending today (the last entry IS today).
  const week = useMemo<MiniBar[] | undefined>(() => {
    if (!insights) return undefined;
    const last = insights.week.length - 1;
    return insights.week.map((d, i) => {
      const idx = weekdayIndex(d.date);
      const label = idx == null ? "" : t(`time.wd${idx + 1}`);
      return {
        label,
        value: d.attempts,
        title: t("uiDash.teacher.weekBarTitle", { day: label, count: d.attempts }),
        current: i === last,
      };
    });
  }, [insights, t]);

  const quickAction = useCallback(
    (a: TeacherQuickAction) => {
      if (a === "assign") navigate("/teacher/assign");
      else if (a === "new-group") navigate("/teacher/classes?new=1");
      else navigate(TEACHER_NAV_PATH.queue);
    },
    [navigate],
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
      onOpenProfile={() => navigate("/teacher/profile")}
      recent={recent}
      behind={groups.length > 0 ? behind : undefined}
      week={week}
      onOpenSubmission={(id) => navigate(`${TEACHER_NAV_PATH.queue}/${encodeURIComponent(id)}`)}
      onOpenStudent={(id) => navigate(`/teacher/students/${encodeURIComponent(id)}`)}
      onQuickAction={quickAction}
    />
  );
}

/** Monday-first weekday index 0–6 of a `YYYY-MM-DD`, parsed as a LOCAL date. */
function weekdayIndex(isoDate: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : (d.getDay() + 6) % 7;
}

/** "5 daqiqa oldin" / "3 soat oldin" / "2 kun oldin" — short, for a list row. */
function relativeWhen(t: (k: string, o?: Record<string, unknown>) => string, iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (Number.isNaN(mins)) return "";
  if (mins < 60) return t("uiDash.teacher.agoMin", { count: Math.max(1, mins) });
  const hours = Math.round(mins / 60);
  if (hours < 24) return t("uiDash.teacher.agoHour", { count: hours });
  return t("uiDash.teacher.agoDay", { count: Math.round(hours / 24) });
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
