/**
 * screens/conversation/roleplayApi — the Suhbat backend (docs/08 Faza 6.5).
 *
 * Until this file existed the conversation ran entirely in the browser: a static
 * script in `scenarios.ts`, a `setTimeout` for "AI yozmoqda…", and a fluency
 * number derived from how many times the student had tapped send. Now the
 * scenarios, the turns, the transcript and the score all come from `/api/roleplay`,
 * and the student's voice actually reaches a speech-to-text engine.
 *
 * Two things about this contract are worth knowing before reading the screens:
 *
 *   • **`state` is not an error channel.** The feature can be legitimately
 *     unavailable — the flag is off, no AI key is wired, the daily budget is
 *     spent, the conversation is closed — and each of those comes back 200 with a
 *     state the UI explains in words. Nothing here throws for them.
 *   • **`student_text` is verbatim.** It is what STT heard, mistakes included; the
 *     corrected forms arrive separately in `corrections`. The screens show them
 *     side by side and never substitute one for the other.
 */
import { api } from "../../shared/api";

/* -------------------------------------------------------------------------- */
/* Wire types                                                                 */
/* -------------------------------------------------------------------------- */

/** Why speaking is (or isn't) possible right now. Mirrors `RoleplayState` on the API. */
export type RoleplayState =
  | "ready"
  | "disabled"
  | "unconfigured"
  | "budget_spent"
  | "finished";

/** A scenario tile — the presentation half of the `scenarios` row. */
export interface RoleplayScenario {
  slug: string;
  title_ru: string;
  goal_uz: string;
  level: string;
  minutes: number;
  tone: string;
  icon: string;
}

export interface RoleplayCatalog {
  state: RoleplayState;
  scenarios: RoleplayScenario[];
  max_turns: number;
  daily_turns_left: number;
}

export interface RoleplayStart {
  state: RoleplayState;
  conversation_id: string | null;
  scenario: RoleplayScenario | null;
  opening_ru: string | null;
  turns_left: number;
  daily_turns_left: number;
}

/** One targeted fix. Same four fields the attempt-result screen renders. */
export interface RoleplayCorrection {
  original: string;
  corrected: string;
  type: string;
  explanation: string;
}

export interface RoleplayTurn {
  state: RoleplayState;
  conversation_id: string;
  turn_index: number;
  /** The faithful transcript — never the corrected version. */
  student_text: string | null;
  partner_ru: string;
  corrections: RoleplayCorrection[];
  /** The partner asked again instead of moving on. */
  retried: boolean;
  turns_left: number;
  daily_turns_left: number;
  finished: boolean;
}

export interface RoleplaySummary {
  state: RoleplayState;
  conversation_id: string;
  title_ru: string;
  turns: number;
  /** Mean of the per-turn grades, or null when nothing was graded. */
  fluency: number | null;
  goal_reached: boolean;
  phrases: string[];
  corrections: RoleplayCorrection[];
}

/* -------------------------------------------------------------------------- */
/* Calls                                                                      */
/* -------------------------------------------------------------------------- */

/** The hub grid + whether speaking is possible right now. */
export function fetchRoleplayCatalog(signal?: AbortSignal): Promise<RoleplayCatalog> {
  return api.get<RoleplayCatalog>("/roleplay/scenarios", { signal });
}

/** Open a conversation. 404 (a typed ApiError) when the slug is unknown. */
export function startRoleplay(scenarioSlug: string): Promise<RoleplayStart> {
  return api.post<RoleplayStart>("/roleplay/conversations", {
    scenario_slug: scenarioSlug,
  });
}

/**
 * Send one spoken turn. Multipart, so the browser sets the boundary — the shared
 * client deliberately does not set `Content-Type` for a `FormData` body.
 */
export function sendRoleplayTurn(
  conversationId: string,
  blob: Blob,
  durationMs: number,
): Promise<RoleplayTurn> {
  const form = new FormData();
  // A filename is required for the API's `IFormFile` to see a file at all; the
  // extension is what tells the transcoder what container arrived.
  form.append("audio", blob, blobFilename(blob));
  form.append("audio_duration_sec", String(Math.max(0, durationMs / 1000)));
  return api.post<RoleplayTurn>(
    `/roleplay/conversations/${conversationId}/turns`,
    form,
  );
}

/** Close the conversation and read the wrap-up. Idempotent on the server. */
export function endRoleplay(conversationId: string): Promise<RoleplaySummary> {
  return api.post<RoleplaySummary>(
    `/roleplay/conversations/${conversationId}/end`,
  );
}

/**
 * The i18n key that explains a non-`ready` state, or `undefined` when speaking is
 * possible. Lives here rather than in each page so the hub and the chat cannot
 * describe the same situation two different ways — the state is one fact, and a
 * student who reads "AI hali ulanmagan" on the grid should read the same sentence
 * inside the chat.
 */
export function roleplayNoteKey(state: RoleplayState | undefined): string | undefined {
  switch (state) {
    case "disabled":
      return "suhbat.stateDisabled";
    case "unconfigured":
      return "suhbat.stateUnconfigured";
    case "budget_spent":
      return "suhbat.stateBudget";
    default:
      return undefined;
  }
}

/** `audio/webm;codecs=opus` → `turn.webm`. Falls back to webm, which is what
 *  every browser we support records by default. */
function blobFilename(blob: Blob): string {
  const base = (blob.type || "audio/webm").split(";")[0];
  const ext = base.split("/")[1] || "webm";
  return `turn.${ext}`;
}
