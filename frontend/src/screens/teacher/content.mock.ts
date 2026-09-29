import type { ContentModule, ContentTask } from "./ContentScreen";

/**
 * Fixture for the Kontent board — lets C1 render standalone. Copy from the C1
 * screen in `docs/design/mockups/Govorim - Teacher.dc.html`.
 */

export const mockContentModules: ContentModule[] = [
  { id: "m-1", name: "Kundalik muloqot", level: "A1–A2", taskCount: 12, studentCount: 38, published: true },
  { id: "m-2", name: "Ishda rus tili", level: "B1", taskCount: 15, studentCount: 22, published: true },
  // A draft: reach is 0 because nobody can see it yet.
  { id: "m-3", name: "Tibbiyotda muloqot", level: "B1–B2", taskCount: 4, studentCount: 0, published: false },
];

export const mockContentTasks: ContentTask[] = [
  {
    id: "t-1",
    title: "Do‘konda xarid",
    prompt: "Расскажите, что вы вчера купили в магазине. 3–4 предложения.",
    level: "A2",
    moduleName: "Kundalik muloqot",
    published: true,
    prepTimeSec: 30,
    answerTimeLimitSec: 120,
    submissionCount: 12,
  },
  {
    id: "t-2",
    title: "O‘zingni tanishtir",
    prompt: "Расскажите о себе на собеседовании.",
    level: "B1",
    moduleName: "Ishda rus tili",
    published: true,
    prepTimeSec: 30,
    answerTimeLimitSec: 120,
    submissionCount: 0,
  },
  // Unattached + draft — what C5's picker offers.
  {
    id: "t-3",
    title: "Telefon suhbati",
    prompt: "Позвоните и запишитесь к врачу.",
    level: "A2",
    published: false,
    prepTimeSec: 10,
    answerTimeLimitSec: 60,
    submissionCount: 0,
  },
];

import type { ModuleEditorProps } from "./ModuleEditorScreen";

/** C4 editor fixture — the mockup's "Kundalik muloqot" with its two tasks. */
export const mockModuleEditor: ModuleEditorProps = {
  name: "Kundalik muloqot",
  topic: "Do‘kon, transport, telefon — kundalik vaziyatlarda gapirish.",
  level: "A1–A2",
  published: false,
  tasks: [
    {
      id: "t-1",
      title: "Do‘konda xarid",
      prompt: "Расскажите, что вы вчера купили в магазине. 3–4 предложения.",
      level: "A2",
      published: true,
      submissionCount: 12,
      prepTimeSec: 30,
      answerTimeLimitSec: 120,
    },
    {
      id: "t-2",
      title: "Telefon suhbati",
      prompt: "Позвоните и запишитесь к врачу.",
      level: "A2",
      published: false,
      submissionCount: 0,
      prepTimeSec: 10,
      answerTimeLimitSec: 60,
    },
  ],
  library: [
    { id: "t-9", title: "Restoranda buyurtma", prompt: "Закажите столик и блюда…", level: "A2" },
    { id: "t-10", title: "Yo‘l so‘rash", prompt: "Спросите дорогу до вокзала…", level: "A1" },
  ],
  queuedCount: 22,
};
