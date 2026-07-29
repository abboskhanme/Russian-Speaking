/**
 * Fixtures for the Suhbat conversation screens — let E3 (chat) and E4 (summary)
 * render standalone with no page/turn-engine wiring. Presentational only; nothing
 * here calls a backend. Mirrors a mid-conversation run of the "В аптеке" scenario.
 */
import type { ConversationMessage } from "./ConversationScreen";
import { SCENARIOS } from "./scenarios";

/** The pharmacy scenario — the first tile in the mockup. */
export const mockScenario = SCENARIOS[0];

/** A short in-progress transcript: opening + one completed user→AI exchange. */
export const mockMessages: ConversationMessage[] = [
  { id: "m0", role: "ai", text: mockScenario.opening },
  { id: "m1", role: "user", text: mockScenario.turns[0].user },
  { id: "m2", role: "ai", text: mockScenario.turns[0].ai },
];

/** A believable finished-run summary for the standalone E4 demo. */
export const mockSummary = {
  goalReached: true,
  turns: 4,
  fluency: 82,
  phrases: mockScenario.phrases,
};
