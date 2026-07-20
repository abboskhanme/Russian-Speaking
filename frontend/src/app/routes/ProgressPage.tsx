/**
 * ProgressPage (`/progress`) — wired to the real gamification data available
 * today. `GET /api/leaderboard` carries the current user's REAL all-time XP and
 * current streak (the `is_me` row), which drive the level + streak cards. The
 * band-trend history and the achievements catalogue have no endpoint yet, so
 * they render as graceful empty states rather than fabricated data.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ProgressScreen } from "../../screens/progress";
import type {
  ProgressBandTrend,
  ProgressLevel,
  ProgressStreak,
} from "../../screens/progress";
import { endpoints } from "../../shared/api";
import { myLeaderboardRow } from "../adapters";
import { PageError, PageLoading } from "../PageState";
import { useNavHandler } from "../nav";

const LEVEL_SIZE = 500; // client-side leveling over the real XP total

export default function ProgressPage() {
  const { t } = useTranslation();
  const onNavigate = useNavHandler();

  const [xp, setXp] = useState(0);
  const [streakDays, setStreakDays] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);
    endpoints
      .leaderboard()
      .then((rows) => {
        if (!alive) return;
        const me = myLeaderboardRow(rows);
        setXp(me?.xp ?? 0);
        setStreakDays(me?.current_streak ?? 0);
      })
      .catch(() => alive && setError(true))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  if (error) return <PageError onRetry={() => setReloadKey((k) => k + 1)} />;
  if (loading) return <PageLoading />;

  const level: ProgressLevel = {
    level: Math.floor(xp / LEVEL_SIZE) + 1,
    xp: xp % LEVEL_SIZE,
    xpForNext: LEVEL_SIZE,
    totalXp: xp,
    unit: "XP",
  };

  const streak: ProgressStreak = { current: streakDays, longest: streakDays };

  // No history endpoint yet — an empty, honest trend (graceful empty state).
  const bandTrend: ProgressBandTrend = {
    points: [],
    currentBand: "—",
    kicker: t("progress.currentLevel"),
  };

  return (
    <ProgressScreen
      bandTrend={bandTrend}
      level={level}
      streak={streak}
      achievements={[]}
      activeNavKey="progress"
      onNavigate={onNavigate}
    />
  );
}
