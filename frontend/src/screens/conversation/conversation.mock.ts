/**
 * Fixtures for the Suhbat conversation screens — let E3 (chat) and E4 (summary)
 * render standalone with no page or backend wiring. Presentational only; nothing
 * here calls an API. Mirrors a mid-conversation run of the "В аптеке" scenario,
 * including one turn that carries a faithful transcript and a correction — the
 * pair the chat is built to show side by side.
 */
import type { ConversationMessage } from "./ConversationScreen";
import { SCENARIOS } from "./scenarios";

/** The pharmacy scenario — the first tile in the mockup. */
export const mockScenario = SCENARIOS[0];

/** A short in-progress transcript: opening + one completed student→partner exchange. */
export const mockMessages: ConversationMessage[] = [
  { id: "m0", role: "ai", text: mockScenario.opening },
  {
    id: "m1",
    role: "user",
    durationMs: 4200,
    // Verbatim, mistakes intact — «горла» where «горло» belongs.
    transcript: "здравствуйте у меня болит горла что можно взять",
    corrections: [
      {
        original: "болит горла",
        corrected: "болит горло",
        type: "grammar",
        explanation: "«Горло» bosh kelishikda bo'ladi — u gapning egasi.",
      },
    ],
  },
  { id: "m2", role: "ai", text: mockScenario.turns[0].ai },
];

/** A believable finished-run summary for the standalone E4 demo. */
export const mockSummary = {
  goalReached: true,
  turns: 4,
  fluency: 82,
  phrases: mockScenario.phrases,
};
