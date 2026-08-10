/**
 * ClassesPage (`/teacher/classes`) — the teacher's Klasslar (plan Phase 2,
 * mockup A2 + A4). Composes from three existing endpoints:
 *
 *   • `GET /api/groups`            → the group cards
 *   • `GET /api/groups/{id}`       → each group's roster (AUTHORITATIVE membership)
 *   • `GET /api/reports/gradebook` → per-student `avg_band`, merged in for scores
 *   • `GET /api/submissions`       → only for the Navbat FAB badge
 *
 * Why both the roster AND the gradebook: the gradebook is scoped server-side to
 * answers to the teacher's OWN questions, so a group member who has not attempted
 * one has no row there at all. Driving the list off the roster and treating a
 * missing gradebook row as "not scored yet" is the difference between a student
 * silently vanishing and a student showing "baholanmagan".
 *
 * Fault-tolerant: `allSettled` throughout, so one failed roster degrades that
 * group's students to absent rather than blanking the page.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ClassesScreen } from "../../screens/teacher";
import type {
  ClassGroup,
  ClassJoinRequest,
  ClassStudent,
  ClassesTabKey,
} from "../../screens/teacher";
import { endpoints } from "../../shared/api";
import type {
  GradebookRowResponse,
  GroupDetailResponse,
  GroupJoinRequestResponse,
  GroupResponse,
} from "../../shared/api";
import { relativeTime } from "../adapters";
import { PageError, PageLoading } from "../PageState";
import { TEACHER_NAV_PATH, useTeacherNavHandler } from "../nav";

/** 0–100 band → CEFR bucket. Mirrors `CefrScale.FromBand` on the server
 * (Govori.Contracts/CefrScale.cs) — same thresholds, so the level a teacher sees
 * here is the level the student sees on their own screens. */
function levelFromBand(band: number): string {
  if (band < 30) return "A1";
  if (band < 50) return "A2";
  if (band < 70) return "B1";
  if (band < 85) return "B2";
  return "C1";
}

const TABS: ClassesTabKey[] = ["groups", "requests", "students"];

export default function ClassesPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const onNavigate = useTeacherNavHandler();
  const [params, setParams] = useSearchParams();

  const raw = params.get("tab");
  const tab: ClassesTabKey = TABS.includes(raw as ClassesTabKey)
    ? (raw as ClassesTabKey)
    : "groups";

  const [groups, setGroups] = useState<GroupResponse[]>([]);
  const [details, setDetails] = useState<GroupDetailResponse[]>([]);
  const [gradebook, setGradebook] = useState<GradebookRowResponse[]>([]);
  const [requests, setRequests] = useState<GroupJoinRequestResponse[]>([]);
  const [queued, setQueued] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);

    (async () => {
      const [g, gb, req, subs] = await Promise.allSettled([
        endpoints.teacherGroups(),
        endpoints.teacherGradebook(),
        endpoints.teacherJoinRequests(),
        endpoints.teacherSubmissions(),
      ]);
      if (!alive) return;

      if (g.status !== "fulfilled") {
        setFailed(true);
        setLoading(false);
        return;
      }
      setGroups(g.value);
      setGradebook(gb.status === "fulfilled" ? gb.value : []);
      setRequests(req.status === "fulfilled" ? req.value : []);
      setQueued(
        subs.status === "fulfilled"
          ? subs.value.filter((s) => s.status === "done" && s.reviewed_at === null).length
          : 0,
      );

      // Rosters, one request per group. Teachers run a handful of groups, so the
      // fan-out is small; a failed one just drops that group's students.
      const rosters = await Promise.allSettled(
        g.value.map((grp) => endpoints.teacherGroupDetail(grp.id)),
      );
      if (!alive) return;
      setDetails(
        rosters
          .filter((r): r is PromiseFulfilledResult<GroupDetailResponse> => r.status === "fulfilled")
          .map((r) => r.value),
      );
      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [reloadKey]);

  /** student_id → their gradebook row, for the score merge. */
  const scoreById = useMemo(() => {
    const m = new Map<string, GradebookRowResponse>();
    for (const row of gradebook) m.set(row.student_id, row);
    return m;
  }, [gradebook]);

  const groupCards = useMemo<ClassGroup[]>(
    () =>
      groups.map((g) => {
        const roster = details.find((d) => d.id === g.id);
        // Group average = mean of its members' average bands, over the members
        // that actually have one. No graded member ⇒ no average shown.
        const bands = (roster?.members ?? [])
          .map((m) => scoreById.get(m.id)?.avg_band)
          .filter((b): b is number => b != null);
        const avg = bands.length
          ? Math.round(bands.reduce((a, b) => a + b, 0) / bands.length)
          : undefined;

        return {
          id: g.id,
          name: g.name,
          level: avg != null ? levelFromBand(avg) : undefined,
          memberCount: g.member_count,
          avgScore: avg,
          joinCode: g.join_code,
        };
      }),
    [groups, details, scoreById],
  );

  const students = useMemo<ClassStudent[]>(() => {
    const rows: ClassStudent[] = [];
    for (const d of details) {
      for (const m of d.members) {
        const row = scoreById.get(m.id);
        const band = row?.avg_band ?? undefined;
        rows.push({
          id: m.id,
          fullName: m.full_name,
          groupName: d.name,
          level: band != null ? levelFromBand(band) : undefined,
          score: band != null ? Math.round(band) : undefined,
          // Left undefined below four graded answers, which is what the server
          // returns — the row then shows no arrow rather than claiming a plateau.
          trend: row?.trend_delta ?? undefined,
        });
      }
    }
    // Scored students first (highest first), then the not-yet-scored by name —
    // the teacher's eye should land on real numbers, not on empty rows.
    return rows.sort((a, b) => {
      if (a.score == null && b.score == null) return a.fullName.localeCompare(b.fullName);
      if (a.score == null) return 1;
      if (b.score == null) return -1;
      return b.score - a.score;
    });
  }, [details, scoreById]);

  const joinRequests = useMemo<ClassJoinRequest[]>(
    () =>
      requests.map((r) => {
        const rel = relativeTime(r.created_at);
        return {
          id: r.id,
          studentName: r.student_name,
          joinCode: r.join_code,
          when: t(rel.key, { count: rel.count }),
        };
      }),
    [requests, t],
  );

  const createGroup = useCallback(async (name: string) => {
    const created = await endpoints.createGroup(name);
    // Optimistic: the new group has no members yet, so no roster fetch is needed.
    setGroups((prev) => [...prev, created]);
  }, []);

  const decideRequest = useCallback(async (id: string, approve: boolean) => {
    if (approve) await endpoints.approveJoinRequest(id);
    else await endpoints.rejectJoinRequest(id);
    // Drop the row immediately — either decision removes it from the queue.
    setRequests((prev) => prev.filter((r) => r.id !== id));
    // An approval changes the roster (and so the counts, averages and student
    // list), so refetch rather than guess at the new membership locally.
    if (approve) setReloadKey((k) => k + 1);
  }, []);

  const setTab = useCallback(
    (key: ClassesTabKey) => {
      const next = new URLSearchParams(params);
      if (key === "groups") next.delete("tab");
      else next.set("tab", key);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  if (loading) return <PageLoading />;
  if (failed) return <PageError onRetry={() => setReloadKey((k) => k + 1)} />;

  return (
    <ClassesScreen
      groups={groupCards}
      students={students}
      requests={joinRequests}
      activeTab={tab}
      onTabChange={setTab}
      activeNavKey="classes"
      onNavigate={onNavigate}
      queuedCount={queued}
      onCreateGroup={createGroup}
      onDecideRequest={decideRequest}
      // A5 / A6 / D3 land in later phases; until then they resolve back here.
      onOpenGroup={(id) => navigate(`${TEACHER_NAV_PATH.classes}/${encodeURIComponent(id)}`)}
      onAssignGroup={(id) => navigate(`/teacher/assign?group=${encodeURIComponent(id)}`)}
      onOpenStudent={(id) => navigate(`/teacher/students/${encodeURIComponent(id)}`)}
    />
  );
}
