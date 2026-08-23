/**
 * daily.mock — fixtures for the standalone `DailyScreen` preview.
 *
 * Three steps, which is the session at its longest. The two-step shape (an empty
 * SRS queue) is what the demo shows when you drop the last entry — it is the
 * common case for a new student, and the screen must look finished, not short.
 * Demo data only; nothing imports this outside the demo export.
 */
import type { DailyStep } from "./DailyScreen";

export const mockDailySteps: DailyStep[] = [
  {
    kind: "warmup",
    done: false,
    estSeconds: 30,
    phrases: [
      { id: "p1", text: "Сегодня хорошая погода.", level: "A1–A2" },
      { id: "p2", text: "Я люблю читать книги по вечерам.", level: "A1–A2" },
      { id: "p3", text: "Вчера я ходил в кино с друзьями.", level: "B1–B2" },
    ],
  },
  {
    kind: "task",
    done: false,
    estSeconds: 180,
    taskId: "mock-task-1",
    taskTitle: "Do'konda",
    moduleName: "Kundalik muloqot",
    level: "A2",
  },
  {
    kind: "drill",
    done: false,
    estSeconds: 90,
    dueCount: 3,
  },
];
