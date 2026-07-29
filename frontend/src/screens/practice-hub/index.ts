/**
 * screens/practice-hub — the student's "Mashq" place, a two-tab hub: Modullar
 * (modules) · Topshiriqlar (one-off assignments). Presentational + prop-driven;
 * composed from `shared/ui` + `widgets` + tokens. (AI Suhbat moved out to its own
 * `screens/conversation` hub behind the centre FAB.)
 *
 *   PracticeHubScreen      — the controllable, prop-driven screen.
 *   PracticeHubScreenDemo  — a self-wired default export, renderable standalone.
 */
export { PracticeHubScreen, default as PracticeHubScreenDemo } from "./PracticeHubScreen";
export type { PracticeHubScreenProps, PracticeHubTabKey } from "./PracticeHubScreen";

export { ModulesTab } from "./tabs/ModulesTab";
export type {
  ModulesTabProps,
  PracticeModule,
  ModulesFilter,
  ModuleVisibility,
} from "./tabs/ModulesTab";

export { mockHubModules, mockHubAssignments } from "./practice-hub.mock";
