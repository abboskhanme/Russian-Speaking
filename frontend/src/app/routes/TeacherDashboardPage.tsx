/**
 * TeacherDashboardPage (`/teacher`) — the teacher's **A1 «Obzor»**, wired to the
 * API (Teacher panel plan, Phase 1). Composes from existing endpoints — no
 * bespoke aggregate endpoint:
 *
 *   • `GET /api/groups`       → the teacher's groups (Guruh + O'quvchi tiles)
 *   • `GET /api/submissions`  → the roster's attempts → the grading-queue count,
 *                               which drives both the Navbatda tile and the
 *                               "AI ishonchi past" attention card
 *
 * Fault-tolerant like {@link HomePage}: `allSettled`, so a dead section degrades
 * to empty instead of blanking the page.
 *
 * **Two of the mockup's three attention cards are deliberately absent**, because
 * nothing behind them is real yet and a faked count on a teacher's triage screen
 * is worse than a missing one:
 *   • "N ta guruhga qo'shilish so'rovi" — there is no join-request model; today
 *     students join instantly by code (plan Phase 2b).
 *   • "N o'quvchi X punkt tushdi" — `SubmissionResponse` carries no AI score and
 *     `/api/reports/gradebook` exposes only a lifetime `avg_band`, so there is no
 *     windowed trend to compare against (plan Phase 6/D1).
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
import type { GroupResponse, SubmissionResponse } from "../../shared/api";
import { useAuth } from "../../shared/auth";
import { firstName } from "../adapters";
import { PageError, PageLoading } from "../PageState";
import { TEACHER_NAV_PATH, useTeacherNavHandler } from "../nav";
import { useTranslation } from "react-i18next";

export default function TeacherDashboardPage() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const onNavigate = useTeacherNavHandler();

  const [groups, setGroups] = useState<GroupResponse[]>([]);
  const [subs, setSubs] = useState<SubmissionResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);

    // allSettled, not all: one dead section must not blank the page. Groups is the
    // load-bearing fetch — if it fails the page is empty, so we surface an error.
    Promise.allSettled([endpoints.teacherGroups(), endpoints.teacherSubmissions()])
      .then(([g, s]) => {
        if (!alive) return;
        if (g.status === "fulfilled") setGroups(g.value);
        else setFailed(true);
        setSubs(s.status === "fulfilled" ? s.value : []);
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

  const attention = useMemo<TeacherAttentionItem[]>(() => {
    const items: TeacherAttentionItem[] = [];
    if (queued > 0) {
      items.push({
        id: "low-confidence",
        tone: "danger",
        title: t("teacher.lowConfidence", { count: queued }),
        hint: t("teacher.lowConfidenceHint"),
      });
    }
    return items;
  }, [queued, t]);

  const openAttention = useCallback(
    (id: string) => {
      if (id === "low-confidence") navigate(TEACHER_NAV_PATH.queue);
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
