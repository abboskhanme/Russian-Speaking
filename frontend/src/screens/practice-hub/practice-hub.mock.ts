import type { PracticeModule } from "./tabs/ModulesTab";
import type { AssignmentsTabProps } from "./tabs/AssignmentsTab";

/**
 * Fixture for the Mashq hub — lets both tabs render standalone (the screen's
 * default export uses this) and gives the architect a shape reference.
 * Presentational only; nothing here calls a backend.
 *
 * Named `mockHub…` because `screens/index.ts` star-exports every screen barrel —
 * the prefix keeps every symbol collision-free across the merged namespace.
 */

/** One of each card state, plus a group-visibility module for the teacher badge. */
export const mockHubModules: PracticeModule[] = [
  {
    id: "m-shopping",
    name: "Do'konda",
    level: "A2",
    total: 6,
    done: 3,
    visibility: "public",
    locked: false,
  },
  {
    id: "m-greetings",
    name: "Tanishuv va salomlashish",
    level: "A1",
    total: 5,
    done: 5,
    visibility: "public",
    locked: false,
  },
  {
    id: "m-clinic",
    name: "Shifokorda",
    level: "A2",
    total: 6,
    done: 0,
    visibility: "group",
    locked: false,
  },
  {
    id: "m-interview",
    name: "Ishga suhbat",
    level: "B1",
    total: 8,
    done: 0,
    visibility: "public",
    locked: true,
  },
];

/** Newest / soonest first, as the Home screen shows them. */
export const mockHubAssignments: AssignmentsTabProps["assignments"] = [
  {
    id: "a-1",
    title: "Telefon suhbati: uchrashuvni belgilash",
    dueAt: "2026-07-26T13:00:00Z",
    completed: false,
    band: null,
  },
  {
    id: "a-2",
    title: "O'zingni tanishtir",
    dueAt: null,
    completed: true,
    band: 78,
  },
  {
    id: "a-3",
    title: "Do'konda narxni so'rash",
    dueAt: "2026-07-19T09:00:00Z",
    completed: false,
    band: null,
  },
];
