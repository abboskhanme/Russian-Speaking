/**
 * HomePage (`/`) — the real Home. Fetches `GET /api/blocks/student` (modules +
 * tasks with the two-layer lock) and `GET /api/leaderboard` (the current user's
 * real XP + streak), maps them to the presentational HomeScreen's props, and
 * routes "Continue" / module-open into Practice for a specific task. Shows a
 * Spinner while loading and a friendly error state on failure.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { HomeScreen } from "../../screens/home";
import type {
  HomeContinueTarget,
  HomeDailyGoal,
  HomeModule,
  HomeStreak,
  HomeUser,
} from "../../screens/home";
import { endpoints } from "../../shared/api";
import type { LeaderboardEntryResponse, StudentModuleResponse } from "../../shared/api";
import { useAuth } from "../../shared/auth";
import { PageError, PageLoading } from "../PageState";
import {
  firstName,
  moduleProgressPct,
  moduleStatus,
  myLeaderboardRow,
  pickPracticeTarget,
} from "../adapters";
import { useNavHandler } from "../nav";

function greetingKey(): string {
  const h = new Date().getHours();
  if (h < 6) return "home.greeting.night";
  if (h < 12) return "home.greeting.morning";
  if (h < 18) return "home.greeting.afternoon";
  return "home.greeting.evening";
}

export default function HomePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const onNavigate = useNavHandler();

  const [modules, setModules] = useState<StudentModuleResponse[] | null>(null);
  const [board, setBoard] = useState<LeaderboardEntryResponse[]>([]);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setError(false);
    setModules(null);
    // Modules are the primary data; the leaderboard (streak/xp) is best-effort.
    Promise.all([
      endpoints.studentBlocks(),
      endpoints.leaderboard().catch(() => [] as LeaderboardEntryResponse[]),
    ])
      .then(([mods, lb]) => {
        if (!alive) return;
        setModules(mods);
        setBoard(lb);
      })
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const homeUser: HomeUser = useMemo(
    () => ({
      name: user ? firstName(user.full_name) : "",
      greeting: t(greetingKey()),
    }),
    [user, t],
  );

  const homeModules: HomeModule[] = useMemo(
    () =>
      (modules ?? []).map((m) => ({
        id: m.id,
        name: m.name,
        level: m.level ?? undefined,
        count: t("home.taskCount", { count: m.total }),
        progress: moduleProgressPct(m),
        status: moduleStatus(m),
        teacher: m.visibility === "group",
      })),
    [modules, t],
  );

  const me = myLeaderboardRow(board);
  const streak: HomeStreak = { current: me?.current_streak ?? 0, freezes: 0, todayComplete: false };

  // No daily-minutes endpoint yet — a neutral, non-fabricated placeholder goal.
  const dailyGoal: HomeDailyGoal = { done: 0, target: 5 };

  const continueTarget: HomeContinueTarget = useMemo(() => {
    const target = pickPracticeTarget(modules ?? []);
    if (target) {
      return {
        kicker: t("home.continueKicker"),
        title: target.module.name,
        subtitle: target.task.title,
        band: target.task.level ?? target.module.level ?? undefined,
        steps: { total: target.module.total, done: target.module.done_count },
        mood: "idle",
      };
    }
    return {
      kicker: t("home.continueKicker"),
      title: t("home.continueEmptyTitle"),
      subtitle: t("home.continueEmptyBody"),
      mood: "sleepy",
    };
  }, [modules, t]);

  const onContinue = useCallback(() => {
    const target = pickPracticeTarget(modules ?? []);
    navigate(target ? `/practice?task=${target.task.id}` : "/practice");
  }, [modules, navigate]);

  const onOpenModule = useCallback(
    (id: string) => {
      const m = (modules ?? []).find((x) => x.id === id);
      const taskId = m?.next_task_id ?? m?.tasks[0]?.id;
      navigate(taskId ? `/practice?task=${taskId}` : "/practice");
    },
    [modules, navigate],
  );

  if (error) return <PageError onRetry={() => setReloadKey((k) => k + 1)} />;
  if (modules === null) return <PageLoading />;

  return (
    <HomeScreen
      user={homeUser}
      dailyGoal={dailyGoal}
      streak={streak}
      continueTarget={continueTarget}
      modules={homeModules}
      onContinue={onContinue}
      onOpenModule={onOpenModule}
      activeNavKey="home"
      onNavigate={onNavigate}
    />
  );
}
