/**
 * PlacementScreen — an answer that cannot be scored is said so, never given a level.
 *
 * The server used to answer an unscorable recording (no AI key, or a vendor fault)
 * with a band made of the recording's byte length, and this screen showed it to a
 * brand-new student as their measured level. It now answers 503
 * `placement_unavailable`; the screen must say "cannot be assessed right now" and
 * offer leaving the test for later — and keep the plain retry message for every
 * other failure, where waiting would not help.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "../../shared/i18n";
import { apiError, LocationProbe } from "../../app/routes/practiceFixtures.test-utils";
import PlacementScreen from "./PlacementScreen";

const t = i18n.getFixedT("uz", "common");

// A plain function, not a vi.fn: a spy that returns a rejected promise is reported by vitest as
// the test's own failure even though the screen catches it (same pattern as PracticeResult.test).
let submit: () => Promise<unknown> = () => Promise.resolve({ index: 0, band: 70 });

vi.mock("../../shared/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared/api")>();
  return {
    ...actual,
    endpoints: {
      ...actual.endpoints,
      guestPlacementQuestions: () =>
        Promise.resolve([
          { index: 0, prompt_ru: "Расскажите о себе." },
          { index: 1, prompt_ru: "Опишите свой день." },
          { index: 2, prompt_ru: "Ваши планы?" },
        ]),
      guestPlacementSubmit: () => submit(),
    },
  };
});

vi.mock("../../shared/auth", () => ({ useAuth: () => ({ clearJustRegistered: () => undefined }) }));

vi.mock("../../shared/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared/ui")>();
  return {
    ...actual,
    Recorder: ({ onComplete }: { onComplete: (b: Blob) => void }) => (
      <button type="button" onClick={() => onComplete(new Blob(["a"]))}>
        fake-record
      </button>
    ),
  };
});

beforeEach(() => {
  submit = () => Promise.resolve({ index: 0, band: 70 });
});

function renderGuest() {
  render(
    <MemoryRouter initialEntries={["/try"]}>
      <Routes>
        <Route path="/try" element={<PlacementScreen mode="guest" />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

describe("an answer the server cannot score right now", () => {
  it("says so and offers the test for later — no level is shown", async () => {
    submit = () => Promise.reject(apiError(503));
    const user = renderGuest();
    await user.click(await screen.findByRole("button", { name: t("placement.startCta") }));
    await user.click(screen.getByRole("button", { name: "fake-record" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(t("placement.unavailable"));
    await user.click(screen.getByRole("button", { name: t("placement.guest.introSkip") }));
    expect(await screen.findByTestId("location")).toHaveTextContent("/register");
  });

  it("keeps the plain retry message for any other failure, with no 'later' exit", async () => {
    submit = () => Promise.reject(apiError(500));
    const user = renderGuest();
    await user.click(await screen.findByRole("button", { name: t("placement.startCta") }));
    await user.click(screen.getByRole("button", { name: "fake-record" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(t("placement.submitError"));
    expect(screen.queryByRole("button", { name: t("placement.guest.introSkip") })).toBeNull();
  });
});
