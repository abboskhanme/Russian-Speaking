import type {
  HomeContinueTarget,
  HomeDailyGoal,
  HomeModule,
  HomeStreak,
  HomeUser,
} from "./HomeScreen";

/**
 * Fixture for the Home screen — lets it render standalone (the default export
 * uses this) and gives the architect a shape reference. Presentational only;
 * nothing here calls a backend.
 */

export const mockUser: HomeUser = {
  name: "Aziz",
  greeting: "Xayrli tong,",
  level: "A2",
};

export const mockDailyGoal: HomeDailyGoal = {
  done: 3,
  target: 5,
  unit: "daqiqa",
};

export const mockStreak: HomeStreak = {
  current: 12,
  freezes: 2,
  todayComplete: false,
};

export const mockContinue: HomeContinueTarget = {
  kicker: "Bugungi mashq",
  title: "Bugungi 5 daqiqa",
  subtitle: "Isinish · gapirish · kechagi xatoni tuzatish",
  band: "A2",
  steps: { total: 3, done: 1 },
  mood: "idle",
  actionLabel: "Boshlash →",
};

export const mockModules: HomeModule[] = [
  {
    id: "mod-daily-life",
    name: "Kundalik hayot",
    level: "A2",
    count: "12 vazifa",
    progress: 68,
    status: "in-progress",
    teacher: true,
  },
  {
    id: "mod-travel",
    name: "Sayohat va yo'l",
    level: "A2",
    count: "10 vazifa",
    progress: 100,
    status: "done",
  },
  {
    id: "mod-work",
    name: "Ish va kasb",
    level: "B1",
    count: "14 vazifa",
    progress: 0,
    status: "not-started",
  },
  {
    id: "mod-city",
    name: "Shahar va transport",
    level: "B1",
    count: "11 vazifa",
    progress: 0,
    status: "locked",
  },
];
