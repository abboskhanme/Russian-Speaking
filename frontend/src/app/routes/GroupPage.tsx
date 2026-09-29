/**
 * GroupPage (`/group`) — the student's group screen: classmates ranked by GROUP XP
 * (XP from this group's assigned tasks only — not their all-time total).
 *
 * Reached from the Home "O'QITUVCHINGIZ" block. Resolves the caller's group via
 * `GET /api/groups/mine` (a student is in at most one), then loads that group's
 * board with `GET /api/leaderboard?group_id=` — which the server serves only to
 * members. A student with no group is bounced back Home (the entry point only
 * exists when they're in one, but a direct visit shouldn't dead-end).
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GroupScreen } from "../../screens/group";
import type { GroupClassmate } from "../../screens/group";
import { endpoints } from "../../shared/api";
import type { GroupResponse } from "../../shared/api";
import { PageError, PageLoading } from "../PageState";
import { useNavHandler } from "../nav";

interface GroupData {
  group: GroupResponse;
  classmates: GroupClassmate[];
}

export default function GroupPage() {
  const navigate = useNavigate();
  const onNavigate = useNavHandler();

  const [data, setData] = useState<GroupData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);

    endpoints
      .myGroups()
      .then(async (groups) => {
        const group = groups[0];
        if (!group) {
          // Not in a group → nothing to show; return Home.
          if (alive) navigate("/", { replace: true });
          return;
        }
        // Board is best-effort: a failure degrades to an empty roster, not a crash.
        const board = await endpoints.leaderboard(undefined, group.id).catch(() => []);
        if (!alive) return;
        setData({
          group,
          classmates: board.map((e) => ({
            id: e.id,
            rank: e.rank,
            name: e.full_name,
            xp: e.xp,
            currentStreak: e.current_streak,
            isMe: e.is_me,
          })),
        });
      })
      .catch(() => alive && setError(true))
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, [reloadKey, navigate]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  if (loading) return <PageLoading />;
  if (error || !data) return <PageError onRetry={retry} />;

  return (
    <GroupScreen
      groupName={data.group.name}
      teacherName={data.group.teacher_name}
      memberCount={data.group.member_count}
      classmates={data.classmates}
      onBack={() => navigate("/")}
      activeNavKey="home"
      onNavigate={onNavigate}
    />
  );
}
