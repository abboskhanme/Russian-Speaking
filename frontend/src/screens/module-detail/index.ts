/**
 * screens/module-detail — the practice module DETAIL (D2) + COMPLETE (D3)
 * screens. Presentational + prop-driven; composed from `shared/ui` + `widgets` +
 * tokens. The page (`app/routes/ModuleDetailPage`) fetches the module and picks
 * which of the two to render.
 *
 *   ModuleDetailScreen        — the in-progress module (ring + task list).
 *   ModuleDetailScreenDemo    — a self-wired default export, renderable standalone.
 *   ModuleCompleteScreen      — the finished-module celebration.
 *   ModuleCompleteScreenDemo  — a self-wired default export, renderable standalone.
 */
export {
  ModuleDetailScreen,
  default as ModuleDetailScreenDemo,
} from "./ModuleDetailScreen";
export type {
  ModuleDetailScreenProps,
  ModuleDetailTask,
  ModuleTaskState,
} from "./ModuleDetailScreen";

export {
  ModuleCompleteScreen,
  default as ModuleCompleteScreenDemo,
} from "./ModuleCompleteScreen";
export type {
  ModuleCompleteScreenProps,
  NextModuleInfo,
} from "./ModuleCompleteScreen";

export { mockModuleDetail, mockModuleComplete } from "./module-detail.mock";
