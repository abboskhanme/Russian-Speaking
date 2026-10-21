/**
 * ProgressPage (`/progress`) — the real Progress, wired across its three tabs.
 *
 * Ko'nikmalar comes from `GET /api/progress/skills` (the CEFR level, the band
 * trend and the four sub-skill scores); Yutuqlar reuses the existing
 * `GET /api/profile/achievements` (the 21-badge catalogue); Reyting comes from
 * `GET /api/progress/leaderboard?period=…`. The header "★ {xp} XP" badge reads
 * LIFETIME XP from `GET /api/profile/stats` (`stats.xp`) — the same stable source
 * the Profile XP banner uses, deliberately NOT `leaderboard.my_xp`, which is the
 * per-period XP and would change as the sub-period pills switch.
 *
 * Fetches are fault-tolerant like ProfilePage: a failure in any one section
 * degrades it to an empty state rather than blanking the page; only a total
 * outage (every initial request rejected) is a hard error. The leaderboard lives
 * on its own effect keyed by `period`, so switching the sub-period refetches just
 * that tab (with its `loading` flag) and never re-pulls skills or achievements.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ProgressScreen } from "../../screens/progress";
import type {
  LeaderboardPeriod,
  SkillKey,
  SkillsTabProps,
} from "../../screens/progress";
import { endpoints } from "../../shared/api";
import { PageError, PageLoading } from "../PageState";
import { useNavHandler } from "../nav";

/** One achievement tile's data (the `GET /api/profile/achievements` shape). */
interface Achievement {
  key: string;
  progress: number;
  target: number;
  unlocked: boolean;
}

/** The Reyting tab's camelCase data bundle (null → empty state). */
interface LeaderboardData {
  league: "gold" | "silver" | "bronze";
  myRank: number;
  totalStudents: number;
  percentile: number;
  myXp: number;
  currentStreak: number;
  rankDelta: number | null;
  neighbors: { rank: number; fullName: string; xp: number; isMe: boolean }[];
}

/** Skills with nothing graded yet — the four bars read 0 and the level card
 * shows its empty state. */
const EMPTY_SKILLS: SkillsTabProps = {
  level: null,
  levelLabel: null,
  band: null,
  bandDelta: null,
  deltaWeeks: 0,
  trend: [],
  skills: [
    { key: "fluency", score: 0, scored: false },
    { key: "pronunciation", score: 0, scored: false },
    { key: "lexical", score: 0, scored: false },
    { key: "grammar", score: 0, scored: false },
  ],
};

export default function ProgressPage() {
  const onNavigate = useNavHandler();
  const navigate = useNavigate();

  const [xp, setXp] = useState(0);
  const [skills, setSkills] = useState<SkillsTabProps | null>(null);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Reyting lives on its own effect so a period switch refetches only this tab.
  const [period, setPeriod] = useState<LeaderboardPeriod>("weekly");
  const [lbData, setLbData] = useState<LeaderboardData | null>(null);
  const [lbLoading, setLbLoading] = useState(true);

  /* ---- Period-independent data: skills, achievements, lifetime XP ---- */
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);

    // `allSettled`, not `all`: one dead section must not blank the page.
    Promise.allSettled([
      endpoints.progressSkills(),
      endpoints.profileAchievements(),
      endpoints.profileStats(),
    ])
      .then(([s, a, st]) => {
        if (!alive) return;

        // Only a total outage is a hard error; any partial success renders.
        if (
          s.status === "rejected" &&
          a.status === "rejected" &&
          st.status === "rejected"
        ) {
          setError(true);
          return;
        }

        setSkills(
          s.status === "fulfilled"
            ? {
                level: s.value.level,
                levelLabel: s.value.level_label,
                band: s.value.band,
                bandDelta: s.value.band_delta,
                deltaWeeks: s.value.delta_weeks,
                trend: s.value.trend.map((p) => ({
                  weekIndex: p.week_index,
                  band: p.band,
                })),
                skills: s.value.skills.map((sk) => ({
                  key: sk.key as SkillKey,
                  score: sk.score,
                  // An older API has no `scored`: treat its value as real.
                  scored: sk.scored !== false,
                })),
              }
            : null,
        );

        setAchievements(
          a.status === "fulfilled"
            ? a.value.map((row) => ({
                key: row.key,
                progress: row.progress,
                target: row.target,
                unlocked: row.unlocked,
              }))
            : [],
        );

        setXp(st.status === "fulfilled" ? st.value.xp : 0);
      })
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, [reloadKey]);

  /* ---- Leaderboard: refetch whenever the sub-period changes ---- */
  useEffect(() => {
    let alive = true;
    setLbLoading(true);

    endpoints
      .progressLeaderboard(period)
      .then((resp) => {
        if (!alive) return;
        setLbData({
          league: resp.league as LeaderboardData["league"],
          myRank: resp.my_rank,
          totalStudents: resp.total_students,
          percentile: resp.percentile,
          myXp: resp.my_xp,
          currentStreak: resp.current_streak,
          rankDelta: resp.rank_delta,
          neighbors: resp.neighbors.map((r) => ({
            rank: r.rank,
            fullName: r.full_name,
            xp: r.xp,
            isMe: r.is_me,
          })),
        });
      })
      .catch(() => alive && setLbData(null))
      .finally(() => alive && setLbLoading(false));

    return () => {
      alive = false;
    };
  }, [period, reloadKey]);

  if (error) return <PageError onRetry={() => setReloadKey((k) => k + 1)} />;
  if (loading) return <PageLoading />;

  return (
    <ProgressScreen
      xp={xp}
      skills={{ ...(skills ?? EMPTY_SKILLS), onStartPractice: () => navigate("/practice") }}
      achievements={{ achievements, onStartPractice: () => navigate("/practice") }}
      leaderboard={{
        period,
        onChangePeriod: setPeriod,
        loading: lbLoading,
        data: lbData,
      }}
      activeNavKey="progress"
      onNavigate={onNavigate}
    />
  );
}
