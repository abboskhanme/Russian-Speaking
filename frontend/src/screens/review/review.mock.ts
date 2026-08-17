/**
 * review.mock — fixtures for the standalone `ReviewDrillScreen` preview.
 *
 * Three cards chosen to exercise the three shapes the real queue produces: a
 * grader-flagged weakness mid-ladder, a teacher-queued item on its first round,
 * and one with NO model answer authored (the case that must not render an empty
 * green box). Demo data only — nothing imports this outside the demo export.
 */
import type { ReviewDrillCard } from "./ReviewDrillScreen";

export const mockDrillCards: ReviewDrillCard[] = [
  {
    id: "mock-1",
    title: "Do'konda",
    promptText:
      "Расскажите, что вы обычно покупаете в магазине и почему выбираете именно эти продукты.",
    instructionText: "Kamida 4 ta gap ayting va sabab keltiring.",
    modelAnswerText:
      "Обычно я покупаю хлеб, молоко и овощи. Я выбираю свежие продукты, потому что готовлю дома почти каждый день.",
    topic: "Kundalik hayot",
    level: "A2",
    weaknessDim: "grammar",
    round: 2,
    totalRounds: 5,
  },
  {
    id: "mock-2",
    title: "Shifokorda",
    promptText: "Опишите свои симптомы врачу и попросите совет.",
    instructionText: null,
    modelAnswerText:
      "У меня болит голова уже два дня, и я плохо сплю. Что вы посоветуете?",
    topic: "Salomatlik",
    level: "B1",
    weaknessDim: "teacher",
    round: 1,
    totalRounds: 5,
  },
  {
    id: "mock-3",
    title: "Ish haqida",
    promptText: "Почему вы выбрали свою профессию?",
    instructionText: null,
    modelAnswerText: null,
    topic: null,
    level: "B1",
    weaknessDim: "fluency",
    round: 4,
    totalRounds: 5,
  },
];
