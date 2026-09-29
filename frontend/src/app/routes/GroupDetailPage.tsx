/**
 * GroupDetailPage (`/teacher/classes/:groupId`) — A5 «Guruh detali» (plan Phase 3).
 *
 *   • `GET /api/groups/{id}`       → name, join code, roster
 *   • `GET /api/reports/gradebook?group_id` → per-member avg_band → levels + group average
 *   • `GET /api/assignments`       → the teacher's assignment rows, grouped BY QUESTION
 *                                    into "11/18 completed" progress lines
 *   • `GET /api/groups/requests`   → how many are waiting (badges "A'zo qo'shish")
 *   • `GET /api/reports/insights?group_id` → "Guruh xatolari" (D1's error rows, this group)
 *   • `GET /api/submissions`       → only for the Navbat FAB badge
 *
 * Writes (the row menu and «Sozlama»):
 *   • `PATCH /api/assignments/group` · `POST /api/assignments/cancel`
 *   • `PATCH /api/groups/{id}` (name) · `POST …/regenerate-code`
 *   • `DELETE /api/groups/{id}/members/{studentId}` · `DELETE /api/groups/{id}`
 *
 * The assignments endpoint returns ONE ROW PER STUDENT, so the group-level
 * "Faol topshiriqlar" view has to fold them: group by question, count completed
 * over total, and keep only questions actually assigned to THIS group's members.
 *
 * A refetch keeps the screen mounted (only the first load shows the spinner), so
 * the settings sheet survives its own writes and shows the new name / code.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { TeacherGroupDetailScreen } from "../../screens/teacher";
import type {
  AnalyticsRemediation,
  AnalyticsErrorRow,
  GroupActiveAssignment,
  GroupRosterStudent,
} from "../../screens/teacher";
import type { DueChangeResult } from "../../screens/teacher";
import { endpoints } from "../../shared/api";
import type {
  AssignmentResponse,
  GradebookRowResponse,
  GroupDetailResponse,
  InsightsResponse,
} from "../../shared/api";
import { PageError, PageLoading } from "../PageState";
import { TEACHER_NAV_PATH, useTeacherNavHandler } from "../nav";
import { formatDayMonth } from "../adapters";
import { apiErrorCode, errorRowsFromInsights, levelFromBand } from "../teacherAdapters";

export default function GroupDetailPage() {
  const { groupId = "" } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const onNavigate = useTeacherNavHandler();

  const [detail, setDetail] = useState<GroupDetailResponse | null>(null);
  const [gradebook, setGradebook] = useState<GradebookRowResponse[]>([]);
  const [assignments, setAssignments] = useState<AssignmentResponse[]>([]);
  const [insights, setInsights] = useState<InsightsResponse | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [queued, setQueued] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);

    Promise.allSettled([
      endpoints.teacherGroupDetail(groupId),
      endpoints.teacherGradebook(groupId),
      endpoints.teacherAssignments(),
      endpoints.teacherJoinRequests(),
      endpoints.teacherReviewCount(),
      endpoints.teacherInsights(groupId),
    ])
      .then(([d, gb, asg, req, subs, ins]) => {
        if (!alive) return;
        // The group detail is load-bearing: a 404 here means "not your group".
        if (d.status !== "fulfilled") {
          setFailed(true);
          return;
        }
        setDetail(d.value);
        setGradebook(gb.status === "fulfilled" ? gb.value : []);
        setAssignments(asg.status === "fulfilled" ? asg.value : []);
        // A failed insights read hides the card; it never blanks the page.
        setInsights(ins.status === "fulfilled" ? ins.value : null);
        setPendingCount(
          req.status === "fulfilled"
            ? req.value.filter((r) => r.group_id === groupId).length
            : 0,
        );
        setQueued(
          subs.status === "fulfilled"
            ? subs.value.count
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
          dueAt: agg.dueAt,
          // Urgent = already past, or inside the next 24h.
          dueUrgent: dueMs != null && dueMs - now < 86_400_000,
          completed: agg.completed,
          total: agg.total,
        };
      });
  }, [assignments, detail, t]);

  const groupErrors = useMemo<AnalyticsErrorRow[] | null>(
    () =>
      insights
        ? errorRowsFromInsights(insights, (type) =>
            t(`teacher.errorType.${type}`, { defaultValue: type }),
          )
        : null,
    [insights, t],
  );

  /* ---- Row menu ---- */

  const changeDue = useCallback(
    async (questionId: string, dueAt: string | null): Promise<DueChangeResult> => {
      try {
        const res = await endpoints.updateGroupAssignmentsDue({
          question_id: questionId,
          group_id: groupId,
          due_at: dueAt,
        });
        refetch();
        return { ok: true, updated: res.updated };
      } catch (e) {
        return { ok: false, reason: apiErrorCode(e) === "due_in_past" ? "due_in_past" : "failed" };
      }
    },
    [groupId, refetch],
  );

  const cancelAssignment = useCallback(
    async (questionId: string) => {
      const res = await endpoints.cancelGroupAssignments({ question_id: questionId, group_id: groupId });
      if (res.cancelled > 0) refetch();
      return res.cancelled;
    },
    [groupId, refetch],
  );

  /* ---- «Sozlama» ---- */

  const rename = useCallback(
    async (name: string) => {
      const updated = await endpoints.updateGroup(groupId, { name });
      // The response is the stored group — show THAT, then refresh the rest.
      setDetail((d) => (d ? { ...d, name: updated.name, join_code: updated.join_code } : d));
      refetch();
    },
    [groupId, refetch],
  );

  const regenerateCode = useCallback(async () => {
    const updated = await endpoints.regenerateGroupCode(groupId);
    setDetail((d) => (d ? { ...d, join_code: updated.join_code } : d));
  }, [groupId]);

  const removeMember = useCallback(
    async (studentId: string) => {
      await endpoints.removeGroupMember(groupId, studentId);
      refetch();
    },
    [groupId, refetch],
  );

  const deleteGroup = useCallback(async () => {
    await endpoints.deleteGroup(groupId);
    navigate(TEACHER_NAV_PATH.classes, { replace: true });
  }, [groupId, navigate]);

  /** F6 from the group card — the SAME endpoint and the server's own plan, exactly
   * as Analitika sends it. */
  const assignRemediation = useCallback(
    async (_row: AnalyticsErrorRow, plan: AnalyticsRemediation) => {
      const created = await endpoints.createAssignments({
        question_id: plan.questionId,
        student_ids: plan.students.map((s) => s.id),
      });
      refetch();
      return created.length;
    },
    [refetch],
  );

  if (loading && !detail) return <PageLoading />;
  if (failed || !detail) return <PageError onRetry={refetch} />;

  return (
    <TeacherGroupDetailScreen
      groupName={detail.name}
      joinCode={detail.join_code}
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
      onChangeDue={changeDue}
      onCancelAssignment={cancelAssignment}
      groupErrors={groupErrors}
      errorsMinStudents={insights?.remediation_min_students ?? 0}
      onAssignRemediation={assignRemediation}
      onRename={rename}
      onRegenerateCode={regenerateCode}
      onRemoveMember={removeMember}
      onDeleteGroup={deleteGroup}
    />
  );
}

/**
 * A deadline → "30-iyul 21:00" in the active language.
 *
 * Built by `formatDayMonth` rather than `Intl.DateTimeFormat`: Chromium's reduced
 * ICU has no Uzbek month names and renders `{ month: "short" }` as `"M07"`. It also
 * puts Russian in the genitive ("30 июля"), which `time.month*` could not.
 */
function formatDue(iso: string, t: TFunction): string {
  return formatDayMonth(iso, t, true);
}
