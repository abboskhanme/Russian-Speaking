/**
 * GroupInvitePage (`/teacher/classes/:groupId/invite`) — A7 «A'zo qo'shish»
 * (plan Phase 3). The group's join code + a shareable link, plus the students
 * waiting on THIS group with approve/reject.
 *
 * The invite link is built from the join code against the CURRENT origin, so a
 * teacher testing on a LAN address hands out a link that actually resolves for
 * them; hard-coding the production host would produce a link nobody on the LAN
 * can open.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { GroupInviteScreen } from "../../screens/teacher";
import type { InvitePendingStudent } from "../../screens/teacher";
import { endpoints } from "../../shared/api";
import type { GroupDetailResponse, GroupJoinRequestResponse } from "../../shared/api";
import { relativeTime } from "../adapters";
import { PageError, PageLoading } from "../PageState";
import { TEACHER_NAV_PATH, useTeacherNavHandler } from "../nav";

export default function GroupInvitePage() {
  const { groupId = "" } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const onNavigate = useTeacherNavHandler();

  const [group, setGroup] = useState<GroupDetailResponse | null>(null);
  const [requests, setRequests] = useState<GroupJoinRequestResponse[]>([]);
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
      endpoints.teacherJoinRequests(),
      endpoints.teacherSubmissions(),
    ])
      .then(([g, req, subs]) => {
        if (!alive) return;
        if (g.status !== "fulfilled") {
          setFailed(true);
          return;
        }
        setGroup(g.value);
        setRequests(
          req.status === "fulfilled" ? req.value.filter((r) => r.group_id === groupId) : [],
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

  const pending = useMemo<InvitePendingStudent[]>(
    () =>
      requests.map((r) => {
        const rel = relativeTime(r.created_at);
        return {
          id: r.id,
          studentName: r.student_name,
          when: t(rel.key, { count: rel.count }),
        };
      }),
    [requests, t],
  );

  const decide = useCallback(async (id: string, approve: boolean) => {
    if (approve) await endpoints.approveJoinRequest(id);
    else await endpoints.rejectJoinRequest(id);
    // Either decision removes the row; an approval also changes the roster, so
    // refetch rather than guess.
    setRequests((prev) => prev.filter((r) => r.id !== id));
    if (approve) setReloadKey((k) => k + 1);
  }, []);

  if (loading) return <PageLoading />;
  if (failed || !group) return <PageError onRetry={() => setReloadKey((k) => k + 1)} />;

  return (
    <GroupInviteScreen
      groupName={group.name}
      joinCode={group.join_code}
      inviteLink={`${window.location.origin}/j/${group.join_code}`}
      pending={pending}
      activeNavKey="classes"
      onNavigate={onNavigate}
      queuedCount={queued}
      onBack={() => navigate(`${TEACHER_NAV_PATH.classes}/${encodeURIComponent(groupId)}`)}
      onDecideRequest={decide}
    />
  );
}
