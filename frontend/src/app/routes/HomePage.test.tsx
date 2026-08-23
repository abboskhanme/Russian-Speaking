/**
 * HomePage — what the QISQACHA block says when it could not load.
 *
 * `Promise.allSettled` is the right call here and the file has always said so:
 * one dead section must not blank the page. The bug was the other half — the
 * REJECTED branch did nothing, so the initial state (`0` streak, `0` minutes)
 * stayed on screen looking exactly like data.
 *
 * That is worse than a gap, and specifically worse for the number people care
 * about most. A student with a forty-day streak who opens Home during a stats
 * outage reads "0" as "I lost it". A gap says "I don't know"; a zero says "you
 * have none", and only one of those is true.
 *
 * The two things asserted below are the two halves of the fix: the failure is
 * VISIBLE (no zeros, a plain sentence, a way to retry) and it is LOCAL (the group
 * and assignment blocks, which loaded fine, still render).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import i18n from "../../shared/i18n";
import HomePage from "./HomePage";

const t = i18n.getFixedT("uz", "common");

const STATS = {
  level: "B1",
  current_streak: 40,
  week_practice_sec: 900,
  today_practice_sec: 120,
};

const GROUP = {
  id: "g1",
  name: "B1 · Kechki-3",
  teacher_name: "Abbosxon",
  member_count: 6,
};

/** How `/api/profile/stats` behaves this test. */
let statsFails = true;
/** Every call the page makes to it, so a retry can be told apart from the first. */
let statsCalls = 0;

vi.mock("../../shared/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared/api")>();
  return {
    ...actual,
    endpoints: {
      ...actual.endpoints,
      profileStats: () => {
        statsCalls += 1;
        return statsFails ? Promise.reject(new Error("boom")) : Promise.resolve(STATS);
      },
      myGroups: () => Promise.resolve([GROUP]),
      assignmentsMine: () => Promise.resolve([]),
      myJoinRequests: () => Promise.resolve([]),
      // F3 is off in these tests, so Home draws its pre-F3 card. The daily entry
      // point has its own file; mixing it in here would make a stats test fail for
      // reasons that have nothing to do with stats.
      dailySession: () => Promise.reject(Object.assign(new Error("off"), { status: 404 })),
    },
  };
});

vi.mock("../../shared/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared/auth")>();
  return {
    ...actual,
    useAuth: () => ({ user: { full_name: "Aziz Karimov" } }),
  };
});

function renderHome() {
  render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  statsFails = true;
  statsCalls = 0;
});

describe("when the figures fail to load", () => {
  it("says it does not know instead of showing zeros", async () => {
    renderHome();

    await screen.findByText(t("home.statsFailed"));

    // The streak cell must NOT read 0. This is the whole point: 0 is the exact
    // wrong number — it is what a lost streak looks like.
    const streakLabel = screen.getByText(t("home.statStreak"));
    const streakCell = streakLabel.closest("div");
    expect(streakCell?.textContent).not.toMatch(/\b0\b/);
    expect(streakCell?.textContent).toContain("—");

    // The rest of the page is untouched — the failure costs one block, not the page.
    expect(screen.getByText(t("home.groupLine", { name: GROUP.name }))).toBeInTheDocument();
    expect(screen.getByText(GROUP.teacher_name)).toBeInTheDocument();
  });

  it("recovers the block alone, without reloading the page", async () => {
    const user = renderHome();
    await screen.findByText(t("home.statsFailed"));
    expect(statsCalls).toBe(1);

    statsFails = false;
    await user.click(screen.getByRole("button", { name: t("common.retry") }));

    await waitFor(() => expect(screen.getByText("40")).toBeInTheDocument());
    expect(screen.queryByText(t("home.statsFailed"))).not.toBeInTheDocument();
    expect(screen.getByText("B1")).toBeInTheDocument();
    // Exactly one extra call: the retry re-fetches the FIGURES, not the whole page.
    expect(statsCalls).toBe(2);
  });
});
