/**
 * GroupDetailPage (`/teacher/classes/:groupId`) — A5 «Guruh detali» (plan Phase 3).
 *
 *   • `GET /api/groups/{id}`       → name, join code, roster
 *   • `GET /api/reports/gradebook?group_id` → per-member avg_band → levels + group average
 *   • `GET /api/assignments`       → the teacher's assignment rows, grouped BY QUESTION
 *                                    into "11/18 completed" progress lines
 *   • `GET /api/groups/requests`   → how many are waiting (badges "A'zo qo'shish")
 *   • `GET /api/submissions`       → only for the Navbat FAB badge
 *
 * The assignments endpoint returns ONE ROW PER STUDENT, so the group-level
 * "Faol topshiriqlar" view has to fold them: group by question, count completed
 * over total, and keep only questions actually assigned to THIS group's members.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { TeacherGroupDetailScreen } from "../../screens/teacher";
import type {
  GroupActiveAssignment,
  GroupRosterStudent,
} from "../../screens/teacher";
import { endpoints } from "../../shared/api";
import type {
  AssignmentResponse,
  GradebookRowResponse,
  GroupDetailResponse,
} from "../../shared/api";
import { PageError, PageLoading } from "../PageState";
import { TEACHER_NAV_PATH, useTeacherNavHandler } from "../nav";
import { dateParts } from "../adapters";
import { levelFromBand } from "../teacherAdapters";

export default function GroupDetailPage() {
  const { groupId = "" } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const onNavigate = useTeacherNavHandler();

  const [detail, setDetail] = useState<GroupDetailResponse | null>(null);
  const [gradebook, setGradebook] = useState<GradebookRowResponse[]>([]);
  const [assignments, setAssignments] = useState<AssignmentResponse[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [queued, setQueued] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);

    Promise.allSettled([
      endpoints.teacherGroupDetail(groupId),
      endpoints.teacherGradebook(groupId),
      endpoints.teacherAssignments(),
      endpoints.teacherJoinRequests(),
      endpoints.teacherSubmissions(),
    ])
      .then(([d, gb, asg, req, subs]) => {
        if (!alive) return;
        // The group detail is load-bearing: a 404 here means "not your group".
        if (d.status !== "fulfilled") {
          setFailed(true);
          return;
        }
        setDetail(d.value);
        setGradebook(gb.status === "fulfilled" ? gb.value : []);
        setAssignments(asg.status === "fulfilled" ? asg.value : []);
        setPendingCount(
          req.status === "fulfilled"
            ? req.value.filter((r) => r.group_id === groupId).length
            : 0,
        );
        setQueued(
          subs.status === "fulfilled"
            ? subs.value.filter((s) => s.status === "done" && s.reviewed_at === null).length
            : 0,
        );
      })
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, [groupId, reloadKey]);

  const bandById = useMemo(() => {
    const m = new Map<string, number>();
    for (const row of gradebook) if (row.avg_band != null) m.set(row.student_id, row.avg_band);
    return m;
  }, [gradebook]);

  const roster = useMemo<GroupRosterStudent[]>(
    () =>
      (detail?.members ?? []).map((m) => {
        const band = bandById.get(m.id);
        return {
          id: m.id,
          fullName: m.full_name,
          level: band != null ? levelFromBand(band) : undefined,
          score: band != null ? Math.round(band) : undefined,
        };
      }),
    [detail, bandById],
  );

  const avgScore = useMemo(() => {
    const bands = (detail?.members ?? [])
      .map((m) => bandById.get(m.id))
      .filter((b): b is number => b != null);
    return bands.length ? Math.round(bands.reduce((a, b) => a + b, 0) / bands.length) : undefined;
  }, [detail, bandById]);

  const activeAssignments = useMemo<GroupActiveAssignment[]>(() => {
    const memberIds = new Set((detail?.members ?? []).map((m) => m.id));
    if (memberIds.size === 0) return [];

    // One row per (student, question) → fold to one row per question.
    type Agg = { title: string; dueAt: string | null; completed: number; total: number };
    const byQuestion = new Map<string, Agg>();
    for (const a of assignments) {
      if (!memberIds.has(a.student_id)) continue;
      const agg = byQuestion.get(a.question_id) ?? {
        title: a.question_title ?? "",
        // Keep the EARLIEST deadline across the group — that is the one that
        // actually bites, and a per-student due date would be meaningless here.
        dueAt: a.due_at,
        completed: 0,
        total: 0,
      };
      agg.total += 1;
      if (a.completed) agg.completed += 1;
      if (a.due_at && (!agg.dueAt || a.due_at < agg.dueAt)) agg.dueAt = a.due_at;
      byQuestion.set(a.question_id, agg);
    }

    const now = Date.now();
    return [...byQuestion.entries()]
      // Incomplete first, then the least-complete — the teacher's attention goes
      // where work is outstanding, not to what is already finished.
      .sort((a, b) => a[1].completed / a[1].total - b[1].completed / b[1].total)
      .map(([questionId, agg]) => {
        const dueMs = agg.dueAt ? new Date(agg.dueAt).getTime() : null;
        return {
          id: questionId,
          title: agg.title,
          due: agg.dueAt ? formatDue(agg.dueAt, t) : null,
          // Urgent = already past, or inside the next 24h.
          dueUrgent: dueMs != null && dueMs - now < 86_400_000,
          completed: agg.completed,
          total: agg.total,
        };
      });
  }, [assignments, detail, t]);

  if (loading) return <PageLoading />;
  if (failed || !detail) return <PageError onRetry={() => setReloadKey((k) => k + 1)} />;

  return (
    <TeacherGroupDetailScreen
      groupName={detail.name}
      level={avgScore != null ? levelFromBand(avgScore) : undefined}
      memberCount={detail.member_count}
      avgScore={avgScore}
      assignments={activeAssignments}
      roster={roster}
      pendingCount={pendingCount}
      activeNavKey="classes"
      onNavigate={onNavigate}
      queuedCount={queued}
      onBack={() => navigate(TEACHER_NAV_PATH.classes)}
      onAssign={() => navigate(`/teacher/assign?group=${encodeURIComponent(groupId)}`)}
      onInvite={() =>
        navigate(`${TEACHER_NAV_PATH.classes}/${encodeURIComponent(groupId)}/invite`)
      }
      onOpenStudent={(id) =>
        navigate(`/teacher/students/${encodeURIComponent(id)}?group=${encodeURIComponent(groupId)}`)
      }
    />
  );
}

/**
 * A deadline → "30-iyul 21:00" in the active language.
 *
 * Built from `time.month*` + the per-language `time.dayMonthTime` pattern rather
 * than `Intl.DateTimeFormat`: Chromium's reduced ICU has no Uzbek month names and
 * renders `{ month: "short" }` as `"M07"`.
 */
function formatDue(iso: string, t: TFunction): string {
  const p = dateParts(iso);
  if (!p) return "";
  return t("time.dayMonthTime", {
    day: p.day,
    month: t(`time.month${p.month}`),
    time: p.time,
  });
}
