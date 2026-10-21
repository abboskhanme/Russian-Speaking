/**
 * AdminSettingsScreen — the AI probe ("does this key actually work?").
 *
 * WHY THIS IS TESTED AND THE REST OF THE SCREEN IS NOT. Every other control here is a
 * field that saves a string; this one SPENDS. One press makes a real, billable call to
 * every backend that holds a key, and the two things that can go wrong with it are both
 * invisible in review:
 *
 *   • **A double press buys the round twice.** Nothing on screen distinguishes one round
 *     of five vendor calls from two, so the bill is the only place it shows up.
 *   • **A result lands on the wrong card.** The probe is keyed `kind:name` on the
 *     server's backend id (`anthropic`), while the card is titled with the product name
 *     (`Claude`). The two never coincide, so a plausible-looking `probes[title]` compiles,
 *     renders, and quietly tells an admin their Gemini key is broken when it is Claude's.
 *
 * The three registers get one test each because they are three different pieces of
 * advice, not three colours: *skipped* means "no key, nothing spent, this is fine",
 * *failed* must show the VENDOR's own sentence (that string is the whole value of the
 * endpoint — "invalid_api_key" and "model not found" send an admin to two different
 * fields), and *ok* must name the model the vendor said it served, which is the only way
 * to find out that a hand-typed model id resolved to something else.
 *
 * Assertions go through the real i18n instance so that rewording a string does not break
 * a test — with one guard on that guard: `t()` returns the key itself for a missing key,
 * which would make every render assertion pass vacuously. The locale test at the bottom
 * is what stops that, by reading the three locale files directly rather than through the
 * uz fallback.
 */
import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n, { SUPPORTED_LANGS, resources } from "../../shared/i18n";
import { AdminSettingsScreen } from "./AdminSettingsScreen";
import type { AdminProbe, SettingsTab } from "./AdminSettingsScreen";
import { mockAdminSettings } from "./admin.mock";

const t = i18n.getFixedT("uz", "common");

const probe = (over: Partial<AdminProbe> & Pick<AdminProbe, "name" | "kind">): AdminProbe => ({
  configured: true,
  ok: true,
  model: null,
  error: null,
  elapsedMs: 0,
  ...over,
});

/** Uncontrolled unless `tab` is given: the tests that move between AI baholash and
 * Nutq (STT) click the real tabs, which is also what proves a probe round survives
 * the switch. */
function setup(onTestAi?: () => Promise<AdminProbe[]>, tab?: SettingsTab) {
  render(<AdminSettingsScreen settings={mockAdminSettings} onTestAi={onTestAi} tab={tab} />);
  return { user: userEvent.setup() };
}

const openTab = (user: ReturnType<typeof userEvent.setup>, key: SettingsTab) =>
  user.click(screen.getByRole("tab", { name: t(`admin.settingsTabs.${key}`) }));

/** One per tab (grader, STT) — the same control: the endpoint takes no scope argument. */
const testButtons = () => screen.getAllByRole("button", { name: t("admin.testAi") });
const card = (name: string) => within(screen.getByRole("group", { name }));

describe("probe results", () => {
  it("reads SKIPPED as a deliberate state, not a failure", async () => {
    // Claude ships with no key on purpose. A red badge on that is how an admin learns to
    // stop reading the badges.
    const { user } = setup(async () => [probe({ name: "anthropic", kind: "grader", configured: false, ok: false })]);
    await user.click(testButtons()[0]);

    const claude = card("Claude");
    await waitFor(() => expect(claude.getByText(t("admin.probeSkipped"))).toBeInTheDocument());
    expect(claude.queryByText(t("admin.probeFailedBadge"))).toBeNull();
  });

  it("names the model the vendor said it SERVED", async () => {
    const { user } = setup(async () => [
      probe({ name: "gemini", kind: "grader", model: "gemini-2.0-flash-001", elapsedMs: 812 }),
    ]);
    await user.click(testButtons()[0]);

    await waitFor(() =>
      expect(
        card("Gemini").getByText(t("admin.probeOk", { model: "gemini-2.0-flash-001", ms: 812 })),
      ).toBeInTheDocument(),
    );
  });

  it("prints the VENDOR's own sentence on a failure", async () => {
    const { user } = setup(async () => [
      probe({ name: "openai", kind: "grader", ok: false, error: "Incorrect API key provided: sk-***" }),
    ]);
    await user.click(testButtons()[0]);

    const openai = card("OpenAI");
    await waitFor(() => expect(openai.getByText("Incorrect API key provided: sk-***")).toBeInTheDocument());
    // Never colour alone (docs/03 §3.3): the badge says it in words too.
    expect(openai.getByText(t("admin.probeFailedBadge"))).toBeInTheDocument();
    // ...and the sibling card must not have caught it.
    expect(card("Azure OpenAI").queryByText(t("admin.probeFailedBadge"))).toBeNull();
  });

  it("falls back to a house sentence when the vendor gave none", async () => {
    const { user } = setup(async () => [probe({ name: "whisper", kind: "stt", ok: false, error: "" })], "stt");
    await user.click(testButtons()[0]);
    await waitFor(() => expect(card("Whisper").getByText(t("admin.probeFailedUnknown"))).toBeInTheDocument());
  });

  it("keys results by `kind:name`, not by card title", async () => {
    // The regression this exists for: `anthropic` is the backend id and `Claude` is the
    // heading, so a lookup by title silently finds nothing — or worse, finds the wrong
    // card. `azure` is a grader-less STT name that would collide with the Azure OpenAI
    // card under any key that drops `kind`.
    const { user } = setup(async () => [
      probe({ name: "anthropic", kind: "grader", model: "claude-opus-5" }),
      probe({ name: "azure", kind: "stt", model: "azure-speech" }),
    ]);
    await user.click(testButtons()[0]);

    await waitFor(() =>
      expect(card("Claude").getByText(t("admin.probeOk", { model: "claude-opus-5", ms: 0 }))).toBeInTheDocument(),
    );
    // Azure OpenAI is not a chain backend and gets no line of its own.
    expect(card("Azure OpenAI").queryByText(/azure-speech/)).toBeNull();
    expect(card("Gemini").queryByRole("status")).toBeNull();
    await openTab(user, "stt");
    expect(card("Azure Speech").getByText(t("admin.probeOk", { model: "azure-speech", ms: 0 }))).toBeInTheDocument();
  });

  it("announces every result to a screen reader", async () => {
    const { user } = setup(async () => [probe({ name: "gemini", kind: "grader", model: "gemini-2.0-flash" })]);
    await user.click(testButtons()[0]);
    await waitFor(() => expect(card("Gemini").getByRole("status")).toHaveTextContent("gemini-2.0-flash"));
  });
});

describe("spending guard", () => {
  it("cannot be pressed a second time while a round is in flight", async () => {
    // The whole point: one press = one bill. A slow round is the normal case (several
    // seconds of live vendor latency), which is exactly when a person clicks again.
    let settle!: (results: AdminProbe[]) => void;
    const onTestAi = vi.fn(() => new Promise<AdminProbe[]>((resolve) => (settle = resolve)));
    const { user } = setup(onTestAi);

    await user.click(testButtons()[0]);
    expect(onTestAi).toHaveBeenCalledTimes(1);

    // Both buttons, because both buy the same round.
    for (const button of testButtons()) {
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("aria-busy", "true");
      await user.click(button);
    }
    expect(onTestAi).toHaveBeenCalledTimes(1);

    await act(async () => settle([probe({ name: "gemini", kind: "grader", model: "gemini-2.0-flash" })]));
    for (const button of testButtons()) expect(button).toBeEnabled();

    // ...and a press after it settles is a NEW, deliberate round.
    await user.click(testButtons()[0]);
    expect(onTestAi).toHaveBeenCalledTimes(2);
  });

  it("shows every card as pending, in both sections", async () => {
    const onTestAi = vi.fn(() => new Promise<AdminProbe[]>(() => {}));
    const { user } = setup(onTestAi);
    await user.click(testButtons()[0]);

    // The grader button was pressed, but the endpoint has no scope argument: the STT
    // cards are genuinely being probed too, and saying otherwise would be a lie.
    for (const name of ["Claude", "Gemini", "OpenAI"]) {
      expect(card(name).getByText(t("admin.probePending"))).toBeInTheDocument();
    }
    await openTab(user, "stt");
    for (const name of ["Azure Speech", "Whisper"]) {
      expect(card(name).getByText(t("admin.probePending"))).toBeInTheDocument();
    }
  });
});

describe("transport failure", () => {
  it("reports the REQUEST, and leaves every card alone", async () => {
    // A dead socket says nothing about any vendor. Painting five backends red for it is
    // how an admin ends up re-issuing keys that were never broken.
    const { user } = setup(vi.fn().mockRejectedValue(new Error("network")));
    await user.click(testButtons()[0]);

    await waitFor(() => expect(screen.getByText(t("admin.probeRequestFailed"))).toBeInTheDocument());
    expect(screen.queryByText(t("admin.probeFailedBadge"))).toBeNull();
    expect(screen.queryByText(t("admin.probeSkipped"))).toBeNull();
  });

  it("prints the line once, beside the button that was pressed", async () => {
    const { user } = setup(vi.fn().mockRejectedValue(new Error("network")), "stt");
    await user.click(testButtons()[0]);

    await waitFor(() => expect(screen.getAllByText(t("admin.probeRequestFailed"))).toHaveLength(1));
    const stt = within(screen.getByRole("region", { name: t("admin.stt") }));
    expect(stt.getByText(t("admin.probeRequestFailed"))).toBeInTheDocument();
  });

  it("clears the failure when a later round succeeds", async () => {
    const onTestAi = vi
      .fn<() => Promise<AdminProbe[]>>()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce([probe({ name: "gemini", kind: "grader", model: "gemini-2.0-flash" })]);
    const { user } = setup(onTestAi);

    await user.click(testButtons()[0]);
    await waitFor(() => expect(screen.getByText(t("admin.probeRequestFailed"))).toBeInTheDocument());

    await user.click(testButtons()[0]);
    await waitFor(() => expect(screen.queryByText(t("admin.probeRequestFailed"))).toBeNull());
  });
});

describe("locale coverage", () => {
  const KEYS = [
    "admin.testAi",
    "admin.testAiHint",
    "admin.probePending",
    "admin.probeSkipped",
    "admin.probeOk",
    "admin.probeFailedBadge",
    "admin.probeFailedUnknown",
    "admin.probeRequestFailed",
  ];

  /** `{ a: { b: "x" } }` → `{ "a.b": "x" }`, the shape i18next keys address. */
  function flatten(obj: unknown, prefix = ""): Record<string, string> {
    const out: Record<string, string> = {};
    if (typeof obj !== "object" || obj === null) return out;
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof value === "string") out[prefix + key] = value;
      else Object.assign(out, flatten(value, `${prefix}${key}.`));
    }
    return out;
  }

  // Read the files, NOT `t()`: the uz fallback answers for a missing ru key, so every
  // assertion above would still pass with two of the three locales empty.
  it.each(SUPPORTED_LANGS)("defines every probe string in %s", (lang) => {
    const strings = flatten(resources[lang].common);
    expect(KEYS.filter((key) => !strings[key]?.trim())).toEqual([]);
  });

  it.each(SUPPORTED_LANGS)("keeps both placeholders in the %s success line", (lang) => {
    // A translator dropping `{{model}}` costs the line its entire point — the model the
    // vendor actually served — while still rendering as a perfectly ordinary sentence.
    const line = flatten(resources[lang].common)["admin.probeOk"];
    expect(line).toContain("{{model}}");
    expect(line).toContain("{{ms}}");
  });
});
