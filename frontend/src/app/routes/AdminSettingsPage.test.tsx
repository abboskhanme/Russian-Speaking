/**
 * AdminSettingsPage — the two things a save must and must not do.
 *
 * WHY THIS IS A PAGE TEST AND NOT A SCREEN TEST. The bug lived in the seam: the page
 * assembles ONE `settings` object out of three separate payloads (`/admin/ai`,
 * `/admin/links`, `/admin/feature-flags`), and the screen decides from that object
 * when to re-seed its draft state. Neither half is wrong on its own, and the two
 * failures below are opposite ends of the same wire — so a test that stubs one of
 * them proves nothing.
 *
 *   (a) `flags` was missing from the page's memo dependencies, so a saved feature
 *       switch updated the state, never reached `settings`, and the Faza 6 card kept
 *       showing page-load values until someone reloaded. The server clamps the turn
 *       limits, so what it showed was not merely stale — it could be a number the
 *       server had already refused.
 *
 *   (b) The obvious fix — add `flags` to the deps — was a worse bug, and this is the
 *       half that is easy to lose again. The screen re-seeded its whole draft
 *       whenever the `settings` OBJECT changed identity, and that seed cleared the
 *       API key inputs. So with the deps "fixed", flipping a switch deleted a
 *       half-typed production API key out from under the person typing it, with no
 *       warning and nothing to recover it from — secrets are write-only, the server
 *       never sends one back.
 *
 * Both are asserted through the real screen and the real page, because the contract
 * that broke is exactly the one between them.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import i18n from "../../shared/i18n";
import type {
  AiSettingsResponse,
  FeatureFlagsResponse,
  FeatureFlagsUpdateArgs,
  LinksResponse,
} from "../../shared/api";
import AdminSettingsPage from "./AdminSettingsPage";

const t = i18n.getFixedT("uz", "common");

const secret = { set: false, hint: "" };

const AI: AiSettingsResponse = {
  llm_provider: "auto",
  gemini_model: "gemini-2.0-flash",
  orthoepy_enabled: false,
  known_gemini_models: [],
  azure_openai_endpoint: "",
  azure_openai_deployment: "",
  azure_openai_api_version: "",
  gemini_api_key: secret,
  azure_openai_api_key: secret,
  azure_ready: false,
  active_provider: "gemini",
  stt_provider: "auto",
  azure_speech_region: "",
  whisper_model: "whisper-1",
  openai_grader_model: "gpt-4o-mini",
  azure_speech_key: secret,
  openai_api_key: secret,
  azure_speech_ready: false,
  stt_active_provider: "whisper",
  grader_chain: "anthropic,gemini,openai",
  stt_chain: "azure,whisper",
  grader_backends: ["anthropic", "gemini", "openai"],
  stt_backends: ["azure", "whisper"],
  ready_grader_backends: [],
  ready_stt_backends: [],
  anthropic_api_key: secret,
  anthropic_model: "claude-opus-5",
  known_anthropic_models: [],
  known_open_ai_models: [],
  known_whisper_models: [],
};

const LINKS: LinksResponse = { tg_support_url: "", tg_channel_url: "" };

const FLAGS: FeatureFlagsResponse = {
  review_drill_enabled: false,
  class_insights_enabled: false,
  daily_five_enabled: false,
  roleplay_enabled: false,
  roleplay_max_turns: 8,
  roleplay_daily_turns: 24,
};

/** The server's answer to the last feature-flags PATCH, set per test. */
let flagsAfterSave: FeatureFlagsResponse;

vi.mock("../../shared/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared/api")>();
  return {
    ...actual,
    endpoints: {
      ...actual.endpoints,
      adminAiSettings: () => Promise.resolve(AI),
      adminLinks: () => Promise.resolve(LINKS),
      adminFeatureFlags: () => Promise.resolve(FLAGS),
      adminUpdateFeatureFlags: (_args: FeatureFlagsUpdateArgs) => Promise.resolve(flagsAfterSave),
    },
  };
});

function renderPage() {
  render(
    <MemoryRouter>
      <AdminSettingsPage />
    </MemoryRouter>,
  );
  return userEvent.setup();
}

const maxTurnsInput = () => screen.getByLabelText(t("admin.roleplayMaxTurns")) as HTMLInputElement;
const claudeKeyInput = () => screen.getByLabelText(t("admin.anthropicKey")) as HTMLInputElement;

beforeEach(() => {
  // A FRESH object every time, the way a real response is. Reusing the same
  // reference would let React bail out of the state update, and the tests below
  // would pass by never exercising the re-render they exist to describe.
  flagsAfterSave = { ...FLAGS };
});

describe("saving a feature switch", () => {
  it("shows what the SERVER stored, not what was typed at it", async () => {
    // The server clamps `roleplay_max_turns` to its allowed range. 99 goes in, 20
    // comes back — and 20 is the only honest thing to display, because 20 is what
    // the roleplay will actually do.
    flagsAfterSave = { ...FLAGS, roleplay_enabled: true, roleplay_max_turns: 20 };
    const user = renderPage();
    await screen.findByRole("switch", { name: t("admin.roleplay") });

    await user.clear(maxTurnsInput());
    await user.type(maxTurnsInput(), "99");
    await user.click(screen.getByRole("button", { name: t("admin.saveFeatures") }));

    await waitFor(() => expect(maxTurnsInput().value).toBe("20"));
    expect(screen.getByRole("switch", { name: t("admin.roleplay") })).toBeChecked();
  });
});

describe("flipping a switch", () => {
  it("does not empty a half-typed API key", async () => {
    // The regression that the obvious fix for the test above would introduce. A key
    // is write-only: once this input is cleared the characters are gone, and the
    // person is left retyping a production secret they may not have to hand.
    flagsAfterSave = { ...FLAGS, review_drill_enabled: true };
    const user = renderPage();
    await screen.findByRole("switch", { name: t("admin.reviewDrill") });

    await user.type(claudeKeyInput(), "sk-ant-half-ty");
    await user.click(screen.getByRole("switch", { name: t("admin.reviewDrill") }));
    await user.click(screen.getByRole("button", { name: t("admin.saveFeatures") }));

    await waitFor(() => expect(screen.getByText(t("admin.saved"))).toBeInTheDocument());
    expect(claudeKeyInput().value).toBe("sk-ant-half-ty");
  });
});
