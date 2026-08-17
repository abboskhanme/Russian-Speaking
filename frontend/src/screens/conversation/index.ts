/**
 * screens/conversation — the Suhbat (AI conversation) flow: the E2 hub, the E3
 * chat surface and the E4 summary, plus the typed `/api/roleplay` client they run
 * on (docs/08 Faza 6.5). The screens stay presentational and prop-driven; the
 * route pages own the conversation.
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
  toScenario,
} from "./scenarios";
export type { Scenario, ScenarioScript, ScriptedTurn } from "./scenarios";

export {
  endRoleplay,
  fetchRoleplayCatalog,
  roleplayNoteKey,
  sendRoleplayTurn,
  startRoleplay,
} from "./roleplayApi";
export type {
  RoleplayCatalog,
  RoleplayCorrection,
  RoleplayScenario,
  RoleplayStart,
  RoleplayState,
  RoleplaySummary,
  RoleplayTurn,
} from "./roleplayApi";

export { mockScenario, mockMessages, mockSummary } from "./conversation.mock";
