import type {
  HomeGroup,
  HomeStats,
  HomeToday,
  HomeUser,
} from "./HomeScreen";

/**
 * Fixture for the Home screen — lets it render standalone (the default export
 * uses this) and mirrors the owner's mockup. Presentational only; nothing here
 * calls a backend.
 */

export const mockHomeUser: HomeUser = { name: "Aziz" };

export const mockHomeToday: HomeToday = {
  goalMinutes: 5,
  // ~1/3 of the way through today's 5-minute goal (first segment filling).
  doneSeconds: 100,
};

export const mockHomeGroup: HomeGroup = {
  teacherName: "Dilnoza Karimova",
  name: "B1 · Kechki-3",
  memberCount: 18,
  nextAssignment: {
    taskId: "q-introduce",
    title: "O'zingni tanishtir",
    // "bugun 21:00" — a due time later today.
    dueAt: (() => {
      const d = new Date();
      d.setHours(21, 0, 0, 0);
      return d.toISOString();
    })(),
  },
};

export const mockHomeStats: HomeStats = {
  level: "A2",
  weekMinutes: 34,
  currentStreak: 12,
};
