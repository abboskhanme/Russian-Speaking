/**
 * screens/conversation — the Suhbat (AI conversation) flow: the E3 chat surface
 * and the E4 summary, driven by a static, scripted turn engine (the live AI is
 * stubbed). Presentational + prop-driven; composed from `shared/ui` + tokens.
 */
export {
  ConversationHubScreen,
  default as ConversationHubScreenDemo,
} from "./ConversationHubScreen";
export type { ConversationHubScreenProps } from "./ConversationHubScreen";

export { ConversationScreen } from "./ConversationScreen";
export type {
  ConversationScreenProps,
  ConversationMessage,
} from "./ConversationScreen";

export { ConversationSummary } from "./ConversationSummary";
export type { ConversationSummaryProps } from "./ConversationSummary";

export {
  SCENARIOS,
  getScenario,
  scenarioIcon,
} from "./scenarios";
export type { Scenario, ScenarioScript, ScriptedTurn } from "./scenarios";

export { mockScenario, mockMessages, mockSummary } from "./conversation.mock";
