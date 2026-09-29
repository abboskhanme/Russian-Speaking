/**
 * Home finishes the invite link: the code `/j/:code` remembered is used ONCE —
 * the join request is filed before the group state is read, so the card shows
 * "so'rov yuborildi" straight away — and a bad code is said in words.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "../../shared/i18n";
import HomePage from "./HomePage";
import { apiError } from "./practiceFixtures.test-utils";

const t = i18n.getFixedT("uz", "common");

let joinCalls: string[] = [];
let joinResult: () => Promise<unknown> = () => Promise.resolve({});
/** Filed requests, as `/groups/requests/mine` would report them. */
let requests: Array<{ group_name: string }> = [];

vi.mock("../../shared/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared/api")>();
  return {
    ...actual,
    endpoints: {
      ...actual.endpoints,
      joinGroup: (code: string) => {
        joinCalls.push(code);
        return joinResult().then((r) => {
          requests = [{ group_name: "B1 · Kechki-3" }];
          return r;
        });
      },
      profileStats: () =>
        Promise.resolve({ level: "A2", current_streak: 3, week_practice_sec: 60, today_practice_sec: 0 }),
      myGroups: () => Promise.resolve([]),
      assignmentsMine: () => Promise.resolve([]),
      myJoinRequests: () => Promise.resolve(requests),
      dailySession: () => Promise.reject(Object.assign(new Error("off"), { status: 404 })),
      unreadCount: () => Promise.resolve({ count: 0 }),
    },
  };
});

vi.mock("../../shared/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared/auth")>();
  return { ...actual, useAuth: () => ({ user: { full_name: "Aziz Karimov" } }) };
});

function renderHome() {
  render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  joinCalls = [];
  requests = [];
  joinResult = () => Promise.resolve({});
  sessionStorage.clear();
});

describe("an invite link's code", () => {
  it("files the join request once and shows the waiting state", async () => {
    sessionStorage.setItem("govori_pending_join", "ABC123");
    renderHome();

    expect(await screen.findByText(t("home.joinPending"))).toBeInTheDocument();
    expect(joinCalls).toEqual(["ABC123"]);
    // Used up — a second visit to Home must not file it again.
    expect(sessionStorage.getItem("govori_pending_join")).toBeNull();
  });

  it("says a bad code plainly instead of doing nothing", async () => {
    sessionStorage.setItem("govori_pending_join", "NOPE00");
    joinResult = () => Promise.reject(apiError(404));
    renderHome();

    expect(await screen.findByText(t("home.joinLink.invalid"))).toBeInTheDocument();
    // …and the manual join form is still there to try again.
    expect(screen.getByPlaceholderText(t("home.joinPlaceholder"))).toBeInTheDocument();
  });

  it("does nothing at all without one", async () => {
    renderHome();
    await waitFor(() => expect(screen.getByText(t("home.noGroup"))).toBeInTheDocument());
    expect(joinCalls).toEqual([]);
  });
});
