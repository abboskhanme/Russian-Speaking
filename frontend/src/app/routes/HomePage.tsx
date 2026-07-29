/**
 * HomePage (`/`) — the real Home, rebuilt to the owner's mockup. Fetches the
 * caller's stats (`/api/profile/stats` → level, streak, today/week practice), the
 * group + teacher (`/api/groups/mine`) and the next assignment
 * (`/api/assignments/mine`), maps them to the presentational HomeScreen, and
 * routes "Boshlash" into Practice. Fault-tolerant: a failed secondary fetch
 * degrades that block, never blanks the page.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { HomeScreen } from "../../screens/home";
import type { HomeGroup, HomeStats, HomeToday, HomeUser } from "../../screens/home";
import { endpoints } from "../../shared/api";
import { useAuth } from "../../shared/auth";
import { firstName } from "../adapters";
import { PageError, PageLoading } from "../PageState";
import { useNavHandler } from "../nav";

/** Default daily goal in minutes (no per-user goal endpoint yet). */
const DAILY_GOAL_MIN = 5;

export default function HomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const onNavigate = useNavHandler();

  const [today, setToday] = useState<HomeToday>({ goalMinutes: DAILY_GOAL_MIN, doneSeconds: 0 });
  const [group, setGroup] = useState<HomeGroup | null>(null);
  const [stats, setStats] = useState<HomeStats>({ level: null, weekMinutes: 0, currentStreak: 0 });
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);

    // allSettled, not all: one dead section must not blank the page.
    Promise.allSettled([
      endpoints.profileStats(),
      endpoints.myGroups(),
      endpoints.assignmentsMine().catch(() => []),
    ])
      .then(([s, g, a]) => {
        if (!alive) return;

        if (s.status === "fulfilled") {
          setStats({
            level: s.value.level,
            weekMinutes: Math.round(s.value.week_practice_sec / 60),
            currentStreak: s.value.current_streak,
          });
          setToday({ goalMinutes: DAILY_GOAL_MIN, doneSeconds: s.value.today_practice_sec });
        }

        // A student belongs to at most one group in practice; take the first.
        const mine = g.status === "fulfilled" ? g.value[0] : undefined;
        if (mine) {
          const assignments = a.status === "fulfilled" ? a.value : [];
          // The soonest INCOMPLETE assignment: due ones first (earliest due), then undated.
          const pending = assignments
            .filter((x) => !x.completed)
            .sort((x, y) => {
              if (x.due_at && y.due_at) return x.due_at.localeCompare(y.due_at);
              if (x.due_at) return -1;
              if (y.due_at) return 1;
              return x.created_at.localeCompare(y.created_at);
            })[0];
          setGroup({
            teacherName: mine.teacher_name,
            name: mine.name,
            memberCount: mine.member_count,
            nextAssignment: pending
              ? { title: pending.question_title ?? "", dueAt: pending.due_at }
              : null,
          });
        } else {
          setGroup(null);
        }
      })
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const homeUser: HomeUser = useMemo(
    () => ({ name: user ? firstName(user.full_name) : "" }),
    [user],
  );

  const onStart = useCallback(() => navigate("/practice"), [navigate]);

  // Join a group by code, then refetch so the "O'QITUVCHINGIZ" block replaces the
  // join form. Errors propagate to NoGroupCard, which surfaces them inline.
  const onJoinGroup = useCallback(async (code: string) => {
    await endpoints.joinGroup(code);
    setReloadKey((k) => k + 1);
  }, []);

  if (loading) return <PageLoading />;
  if (!user) return <PageError onRetry={() => setReloadKey((k) => k + 1)} />;

  return (
    <HomeScreen
      user={homeUser}
      today={today}
      group={group}
      stats={stats}
      onStart={onStart}
      onJoinGroup={onJoinGroup}
      onOpenGroup={() => navigate("/group")}
      activeNavKey="home"
      onNavigate={onNavigate}
    />
  );
}
