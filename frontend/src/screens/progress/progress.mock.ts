import type {
  ProgressAchievement,
  ProgressBandTrend,
  ProgressLevel,
  ProgressStreak,
} from "./ProgressScreen";

/**
 * Fixture for the Progress screen — lets it render standalone (the default
 * export uses this) and gives the architect a shape reference. Presentational
 * only; nothing here calls a backend.
 */

export const mockBandTrend: ProgressBandTrend = {
  currentBand: "A2",
  kicker: "Hozirgi daraja",
  deltaLabel: "7 haftada +18 ball",
  deltaDir: "up",
  points: [
    { id: "w1", label: "1-h", score: 58, band: "A1" },
    { id: "w2", label: "2-h", score: 61, band: "A1" },
    { id: "w3", label: "3-h", score: 63, band: "A1" },
    { id: "w4", label: "4-h", score: 66, band: "A2" },
    { id: "w5", label: "5-h", score: 70, band: "A2" },
    { id: "w6", label: "6-h", score: 74, band: "A2" },
    { id: "w7", label: "7-h", score: 76, band: "A2" },
  ],
};

export const mockLevel: ProgressLevel = {
  level: 7,
  xp: 320,
  xpForNext: 500,
  totalXp: 980,
  nextLabel: "8-daraja",
  unit: "XP",
};

export const mockStreak: ProgressStreak = {
  current: 12,
  longest: 21,
  week: [
    { label: "Du", active: true },
    { label: "Se", active: true },
    { label: "Ch", active: true },
    { label: "Pa", active: true },
    { label: "Ju", active: true },
    { label: "Sh", active: true, today: true },
    { label: "Ya", active: false },
  ],
};

export const mockAchievements: ProgressAchievement[] = [
  {
    id: "streak-12",
    icon: "🔥",
    title: "12 kun streak",
    description: "Har kuni mashq",
    status: "earned",
  },
  {
    id: "attempts-50",
    icon: "🎯",
    title: "50 urinish",
    description: "Jami 50 ta javob",
    status: "earned",
  },
  {
    id: "first-80",
    icon: "⭐",
    title: "Birinchi 80+",
    description: "Yuqori ball",
    status: "earned",
  },
  {
    id: "module-done",
    icon: "📚",
    title: "Modul yakuni",
    description: "1 modul tugadi",
    status: "earned",
  },
  {
    id: "chats-10",
    icon: "💬",
    title: "10 suhbat",
    description: "7 / 10 bajarildi",
    status: "locked",
    progress: 70,
  },
  {
    id: "band-b1",
    icon: "🏆",
    title: "B1 daraja",
    description: "A2 → B1",
    status: "locked",
    progress: 60,
  },
];
