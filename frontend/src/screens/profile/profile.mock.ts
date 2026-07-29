import type {
  ProfileAchievement,
  ProfileGroup,
  ProfileLinks,
  ProfileResult,
  ProfileStats,
  ProfileUser,
} from "./ProfileScreen";

/**
 * Fixture for the Profile screen — lets all three tabs render standalone (the
 * default export uses this) and gives the architect a shape reference.
 * Presentational only; nothing here calls a backend.
 *
 * The numbers mirror the owner's mockup so the demo render and the design can
 * be compared side by side.
 */

export const mockProfileUser: ProfileUser = {
  name: "Aziz Karimov",
  phone: "+998 90 123 45 67",
  region: "Toshkent shahri",
  district: "Chilonzor tumani",
  level: "A2",
  levelLabel: "boshlang'ich",
  registeredAt: "2026-03-14T09:41:00Z",
  verified: true,
};

export const mockGroup: ProfileGroup = {
  name: "B1 · Kechki-3",
  teacherName: "Dilnoza Karimova",
  memberCount: 18,
};

export const mockStats: ProfileStats = {
  attempts: 128,
  avgBand: 74,
  currentStreak: 12,
  // 6.4 soat — the tile divides by 3600 and rounds to 1dp.
  totalPracticeSec: 23_040,
  xp: 1240,
};

/** Newest first, exactly as `GET /api/profile/results` returns them. */
export const mockResults: ProfileResult[] = [
  {
    id: "r1",
    title: "Do'konda",
    band: 74,
    createdAt: "2026-07-20T08:10:00Z",
    trend: "up",
  },
  {
    id: "r2",
    title: "Собеседование",
    band: 81,
    createdAt: "2026-07-19T18:25:00Z",
    trend: "up",
  },
  {
    id: "r3",
    title: "У врача",
    band: 68,
    createdAt: "2026-07-18T12:00:00Z",
    trend: "down",
  },
  {
    id: "r4",
    title: "Telefon suhbati",
    band: 74,
    createdAt: "2026-07-13T15:30:00Z",
    trend: "flat",
  },
];

/**
 * The 21-badge catalogue for one coherent mid-journey student: 62 attempts, an
 * 8-day best streak, best single band 84, level B1, ~2.2h practice, in a group,
 * 1240 XP — so 13 badges are unlocked and 8 are still in progress. Listed in the
 * SAME order the backend returns: unlocked first, then the locked ones closest to
 * unlocking first, so the demo mirrors production.
 *
 * Named `mockProfile…` because `screens/index.ts` star-exports every screen
 * barrel, and `screens/progress` already publishes a `mockAchievements`.
 */
export const mockProfileAchievements: ProfileAchievement[] = [
  // ── unlocked (progress ≥ target), by target ascending ──
  { key: "first_step", progress: 1, target: 1, unlocked: true },
  { key: "level_a2", progress: 1, target: 1, unlocked: true },
  { key: "level_b1", progress: 1, target: 1, unlocked: true },
  { key: "score_80", progress: 1, target: 1, unlocked: true },
  { key: "group_member", progress: 1, target: 1, unlocked: true },
  { key: "streak_3", progress: 8, target: 3, unlocked: true },
  { key: "streak_7", progress: 8, target: 7, unlocked: true },
  { key: "attempts_10", progress: 62, target: 10, unlocked: true },
  { key: "attempts_50", progress: 62, target: 50, unlocked: true },
  { key: "practice_1h", progress: 132, target: 60, unlocked: true },
  { key: "xp_100", progress: 1240, target: 100, unlocked: true },
  { key: "xp_500", progress: 1240, target: 500, unlocked: true },
  { key: "xp_1000", progress: 1240, target: 1000, unlocked: true },
  // ── locked, closest-to-unlocking first (capped ratio) ──
  { key: "attempts_100", progress: 62, target: 100, unlocked: false }, // 0.62
  { key: "xp_2500", progress: 1240, target: 2500, unlocked: false }, // 0.50
  { key: "practice_5h", progress: 132, target: 300, unlocked: false }, // 0.44
  { key: "streak_30", progress: 8, target: 30, unlocked: false }, // 0.27
  { key: "xp_5000", progress: 1240, target: 5000, unlocked: false }, // 0.25
  { key: "streak_100", progress: 8, target: 100, unlocked: false }, // 0.08
  { key: "level_b2", progress: 0, target: 1, unlocked: false }, // 0
  { key: "score_90", progress: 0, target: 1, unlocked: false }, // 0
];

export const mockLinks: ProfileLinks = {
  tgSupportUrl: "https://t.me/govori_admin",
  tgChannelUrl: "https://t.me/govori_uz",
};
