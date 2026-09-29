/**
 * StudentProfilePage — the teacher's Premium switch on A6.
 *
 * WHY A PAGE TEST. The admin panel shipped this exact control with a snapshot bug:
 * the grant saved, the list updated, and the switch under the operator's finger
 * stayed where it was — inviting them to flip it straight back. Here the page owns
 * the value, flips it at once, then REPLACES it with what the server stored. The
 * tests make the server answer something other than what was asked, because a
 * switch that merely echoes the click would pass any test where the two agree.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "../../shared/i18n";
import type { ClassroomStudentResponse, StudentPremiumResponse } from "../../shared/api";
import StudentProfilePage from "./StudentProfilePage";

const t = i18n.getFixedT("uz", "common");

const { state } = vi.hoisted(() => ({
  state: {
    student: null as ClassroomStudentResponse | null,
    premiumReply: null as (() => Promise<StudentPremiumResponse>) | null,
    premiumCalls: [] as unknown[][],
  },
}));

vi.mock("../../shared/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared/api")>();
  return {
    ...actual,
    endpoints: {
      ...actual.endpoints,
      teacherStudentSubmissions: () => Promise.resolve([]),
      teacherSubmissions: () => Promise.resolve([]),
      teacherGradebook: () => Promise.resolve([]),
      classroomStudent: () =>
        state.student ? Promise.resolve(state.student) : Promise.reject(new Error("404")),
      setStudentPremium: (...args: unknown[]) => {
        state.premiumCalls.push(args);
        return state.premiumReply!();
      },
      unreadCount: () => Promise.resolve({ count: 0 }),
    },
  };
});

function student(over: Partial<ClassroomStudentResponse> = {}): ClassroomStudentResponse {
  return {
    id: "s-1",
    full_name: "Dilfuza Rashidova",
    email: "d@govori.uz",
    is_premium: false,
    has_premium: false,
    groups: [{ id: "g-1", name: "Kechki-3", joined_at: "2026-03-02T10:00:00Z" }],
    ...over,
  };
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/teacher/students/s-1"]}>
      <Routes>
        <Route path="/teacher/students/:studentId" element={<StudentProfilePage />} />
      </Routes>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

const premiumSwitch = () => screen.findByRole("switch", { name: t("teacher.premium.label") });

beforeEach(() => {
  state.student = student();
  state.premiumCalls = [];
  state.premiumReply = null;
});

describe("the Premium switch", () => {
  it("shows what the SERVER stored after a write, not what was clicked", async () => {
    // Asked to grant; the server answers with the grant still off.
    state.premiumReply = () => Promise.resolve({ id: "s-1", is_premium: false, has_premium: false });
    const user = renderPage();
    const sw = await premiumSwitch();
    expect(sw).not.toBeChecked();

    await user.click(sw);
    expect(state.premiumCalls).toEqual([["s-1", true]]);
    await waitFor(() => expect(sw).not.toBeChecked());
  });

  it("moves at once and stays on when the server confirms", async () => {
    let resolve!: (v: StudentPremiumResponse) => void;
    state.premiumReply = () => new Promise((r) => (resolve = r));
    const user = renderPage();
    const sw = await premiumSwitch();

    await user.click(sw);
    // Optimistic: on before the round-trip finishes.
    expect(sw).toBeChecked();
    resolve({ id: "s-1", is_premium: true, has_premium: true });
    await waitFor(() => expect(sw).toBeChecked());
  });

  it("puts the old value back and says so when the write fails", async () => {
    state.premiumReply = () => Promise.reject(new Error("500"));
    const user = renderPage();
    const sw = await premiumSwitch();

    await user.click(sw);
    await waitFor(() => expect(sw).not.toBeChecked());
    expect(await screen.findByText(t("teacher.saveFailed"))).toBeInTheDocument();
  });

  it("explains an OFF switch for a student who pays for themselves", async () => {
    state.student = student({ is_premium: false, has_premium: true });
    renderPage();
    expect(await premiumSwitch()).not.toBeChecked();
    expect(screen.getByText(t("teacher.premium.selfPaid"))).toBeInTheDocument();
  });

  it("is absent when the student read fails, rather than a switch that cannot save", async () => {
    state.student = null;
    renderPage();
    expect(await screen.findByText(t("teacher.noAttempts"))).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: t("teacher.premium.label") })).toBeNull();
  });

  it("names the student and their group when opened without ?group=", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "Dilfuza Rashidova" })).toBeInTheDocument();
    expect(screen.getByText(/Kechki-3/)).toBeInTheDocument();
  });
});
