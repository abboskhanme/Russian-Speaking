import type {
  PracticeFeedback,
  PracticeProgress,
  PracticeTask,
} from "./PracticeScreen";

/**
 * Fixture for the Practice screen — lets it render standalone (the default
 * export uses this) and gives the architect a shape reference. Presentational
 * only; nothing here calls a backend.
 */

export const mockTask: PracticeTask = {
  id: "task-doroga-01",
  band: "A2",
  style: "Jonli",
  durationHint: "~1 daqiqa",
  prompt: "Опишите, как вы обычно добираетесь до работы или учёбы.",
  instruction:
    "2–3 gap ayting. «Сначала…, потом…, в конце…» bog'lovchilaridan foydalaning.",
  hasReferenceAudio: true,
  maxDurationMs: 90_000,
};

export const mockProgress: PracticeProgress = { current: 2, total: 5 };

export const mockFeedback: PracticeFeedback = {
  score: 74,
  band: "A2",
  summary: "Тебя легко понять — темп речи естественный.",
  transcript:
    "Я вчера ходил в магазин и купил хлеб, потому что дома ничего не было.",
  strengths: [
    "Gapirish sur'ating tabiiy",
    "«потому что» bog'lovchisini to'g'ri ishlatding",
  ],
  corrections: [
    {
      id: "c1",
      before: "я идти в магазин",
      after: "я иду в магазин",
      note: "Hozirgi zamon: идти → иду.",
    },
    {
      id: "c2",
      before: "купил хлеба",
      after: "купил хлеб",
      note: "«купить» tushum kelishigini oladi: хлеб.",
    },
    {
      id: "c3",
      before: "потому-что",
      after: "потому что",
      note: "«потому что» — ikki so'z, defissiz yoziladi.",
    },
  ],
  correctionTotal: 7,
  criteria: [
    { id: "fluency", label: "Ravonlik", score: 78 },
    { id: "vocab", label: "Lug'at", score: 64 },
    { id: "grammar", label: "Grammatika", score: 52 },
    { id: "pron", label: "Talaffuz", score: 71 },
  ],
};
