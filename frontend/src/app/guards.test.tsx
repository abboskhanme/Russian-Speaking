/**
 * Two ways into the student app that used to lead nowhere.
 *
 *   • `/j/:code` — the teacher's invite link had no route, so it fell through to
 *     the catch-all and the code was dropped. It now remembers the code for this
 *     tab (through a sign-in if needed) and hands the student to Home, which files
 *     the request; a teacher/admin is sent home without joining.
 *   • The placement hop — `justRegistered` was set and read by nobody, so a new
 *     student was never offered the level test. `/` now sends them there once.
 */
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { MeResponse } from "../shared/api";
import { JoinLink, RoleHome } from "./guards";
import { LocationProbe } from "./routes/practiceFixtures.test-utils";

let auth: {
  status: "boot" | "ready";
  user: Pick<MeResponse, "role"> | null;
  justRegistered: boolean;
  clearJustRegistered: () => void;
};

vi.mock("../shared/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../shared/auth")>();
  return { ...actual, useAuth: () => auth };
});

function renderAt(path: string, element: ReactElement, routePath: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={element} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  sessionStorage.clear();
  auth = { status: "ready", user: null, justRegistered: false, clearJustRegistered: vi.fn() };
});

describe("/j/:code — the invite link", () => {
  it("signed out: remembers the code and asks them to sign in", async () => {
    renderAt("/j/abc123", <JoinLink />, "/j/:code");
    expect(await screen.findByTestId("location")).toHaveTextContent("/login");
    expect(sessionStorage.getItem("govori_pending_join")).toBe("ABC123");
  });

  it("a student: remembers the code and goes Home, where the request is filed", async () => {
    auth.user = { role: "student" };
    renderAt("/j/ABC123", <JoinLink />, "/j/:code");
    const location = await screen.findByTestId("location");
    expect(location.textContent).toBe("/");
    expect(sessionStorage.getItem("govori_pending_join")).toBe("ABC123");
  });

  it("a teacher: their own home, and no join", async () => {
    auth.user = { role: "teacher" };
    sessionStorage.setItem("govori_pending_join", "OLD999");
    renderAt("/j/ABC123", <JoinLink />, "/j/:code");
    expect((await screen.findByTestId("location")).textContent).toBe("/");
    expect(sessionStorage.getItem("govori_pending_join")).toBeNull();
  });
});

describe("the placement hop", () => {
  it("sends a just-registered student to /placement once, for this account", async () => {
    auth.user = { role: "student" };
    auth.justRegistered = true;
    // A previous account on this device already placed — that must not skip it.
    localStorage.setItem("govori_placed", "1");

    renderAt("/", <RoleHome />, "/");

    expect(await screen.findByTestId("location")).toHaveTextContent("/placement");
    expect(auth.clearJustRegistered).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("govori_placed")).toBeNull();
  });
});
