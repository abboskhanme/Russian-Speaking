/**
 * module-detail.mock — fixtures for the D2 (detail) + D3 (complete) demos.
 *
 * Data only (no callbacks), so the screens' default-export demos can spread these
 * and add their own no-op handlers. Shapes match the screens' public props.
 */
import type { ModuleDetailScreenProps, ModuleDetailTask } from "./ModuleDetailScreen";
import type { ModuleCompleteScreenProps } from "./ModuleCompleteScreen";

const detailTasks: ModuleDetailTask[] = [
  { id: "t1", index: 1, title: "Tanishuv: ismingizni ayting", state: "done", band: 82 },
  { id: "t2", index: 2, title: "O'zingiz haqingizda gapiring", state: "done", band: 76 },
  { id: "t3", index: 3, title: "Kunlik tartibingizni tasvirlang", state: "current", band: null },
  { id: "t4", index: 4, title: "Sevimli mashg'ulotingiz", state: "locked", band: null },
  { id: "t5", index: 5, title: "Kelajak rejalaringiz", state: "locked", band: null },
];

/** D2 — a module mid-progress (2 of 5 done, task 3 is current). */
export const mockModuleDetail: Omit<
  ModuleDetailScreenProps,
  "onStartTask" | "onBack" | "onNavigate"
> = {
  name: "Kundalik muloqot",
  total: 5,
  doneCount: 2,
  tasks: detailTasks,
};

/** D3 — a finished module with a locked next module to advance to. */
export const mockModuleComplete: Omit<
  ModuleCompleteScreenProps,
  "onNextModule" | "onDownloadCert" | "onBack" | "onNavigate"
> = {
  name: "Kundalik muloqot",
  done: 5,
  total: 5,
  averageBand: 79,
  spentSec: 4_320, // 1h 12m
  next: {
    id: "m2",
    name: "Xaridlar va do'kon",
    level: "A2",
    taskCount: 6,
    locked: true,
  },
};
