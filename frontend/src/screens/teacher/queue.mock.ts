import type { QueueItem } from "./ReviewQueueScreen";
import type { AttemptReviewProps } from "./AttemptReviewScreen";

/**
 * Fixtures for the Navbat board (B1 · B2 · B3) — let the screens render
 * standalone via their default exports. Presentational only. Copy is lifted from
 * `docs/design/mockups/Govorim - Teacher.dc.html`.
 */

export const mockReviewQueue: QueueItem[] = [
  {
    id: "q-1",
    studentName: "Dilfuza Rashidova",
    task: "Do‘konda xarid",
    level: "A2",
    score: 58,
    when: "2 soat oldin",
    audioUrl: "/demo/answer-1.webm",
  },
  {
    id: "q-2",
    studentName: "Bekzod Mirzayev",
    task: "O‘zingni tanishtir",
    level: "B1",
    score: 71,
    when: "bugun",
    audioUrl: "/demo/answer-2.webm",
  },
  {
    id: "q-3",
    studentName: "Kamola Abdullayeva",
    task: "Telefon suhbati",
    level: "B1",
    score: 84,
    when: "kecha",
    // The retention job has purged this one's recording.
    audioUrl: null,
  },
];

export const mockAttemptReview: AttemptReviewProps = {
  studentName: "Dilfuza Rashidova",
  taskLine: "Do‘konda xarid · A2",
  score: 58,
  audioUrl: null,
  transcript: "Я вчера идти в магазин и купил хлеб.",
  // Faithful to what was said — "идти" stays wrong, with a low accuracy, rather
  // than being silently replaced by "шёл".
  words: [
    { word: "Я", accuracy: 95 },
    { word: "вчера", accuracy: 88 },
    { word: "идти", accuracy: 41 },
    { word: "в", accuracy: 90 },
    { word: "магазин", accuracy: 68 },
    { word: "и", accuracy: 93 },
    { word: "купил", accuracy: 86 },
    { word: "хлеб", accuracy: 79 },
  ],
  criteria: [
    { key: "fluency", label: "Ravonlik", score: 64 },
    { key: "grammar", label: "Grammatika", score: 48 },
    { key: "pronunciation", label: "Talaffuz", score: 71 },
    { key: "lexical", label: "Lug‘at", score: 58 },
  ],
  corrections: [
    {
      original: "я идти",
      corrected: "я иду́",
      type: "grammar",
      explanation: "Hozirgi zamon: идти → иду.",
    },
  ],
  feedback: {
    summary: "Yaxshi urinish — gap tuzilishi tushunarli.",
    strengths: ["Lug'at savolga mos."],
    improvements: ["Fe'l zamonlarini takrorlash kerak."],
    vocabulary: ["магазин", "хлеб"],
  },
  teacherBand: null,
  teacherComment: null,
  reviewed: false,
  queuedCount: 3,
};
