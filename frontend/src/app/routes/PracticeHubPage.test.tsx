/**
 * Mashq → Topshiriqlar: "Boshlash" on a teacher's assignment opens THAT task.
 *
 * The row used to hand the task screen the ASSIGNMENT's id, which the task screen
 * cannot resolve — and it then fell back to the first open task, so the student
 * answered some other question believing they had done their homework. The link
 * must carry the assignment's `question_id`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "../../shared/i18n";
import type { AssignmentResponse } from "../../shared/api";
import PracticeHubPage from "./PracticeHubPage";
import { LocationProbe } from "./practiceFixtures.test-utils";

const t = i18n.getFixedT("uz", "common");

const ASSIGNMENT: AssignmentResponse = {
  id: "assignment-row-9",
  student_id: "s",
  student_name: null,
  question_id: "question-42",
  question_title: "Telefon suhbati",
  question_topic: null,
  question_level: "A2",
  due_at: null,
  created_at: "2026-09-28T10:00:00Z",
  completed: false,
  submission_id: null,
  overall_band: null,
  max_attempts: null,
  attempts_used: 0,
};

// What GET /api/drills/pairs answers in each test (a 200 with a state, never a 404).
let drillState: "Ready" | "Disabled" = "Disabled";
/** The /me feature switches this test runs under, and every drill request made. */
let flags = { review_drill: false, phoneme_drill: true };
let drillCalls: string[] = [];

vi.mock("../../shared/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared/auth")>();
  return { ...actual, useFeatures: () => ({ ...actual.NO_FEATURES, ...flags }) };
});

beforeEach(() => {
  flags = { review_drill: false, phoneme_drill: true };
  drillCalls = [];
});

vi.mock("../../shared/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared/api")>();
  return {
    ...actual,
    endpoints: {
      ...actual.endpoints,
      studentBlocks: () => Promise.resolve([]),
      assignmentsMine: () => Promise.resolve([ASSIGNMENT]),
      reviewDrill: () => {
        drillCalls.push("review");
        return Promise.resolve({ due_count: 2, items: [] });
      },
      drillPairs: () => {
        drillCalls.push("pairs");
        return Promise.resolve({
          state: drillState,
          pairs: drillState === "Ready" ? [{ id: "p1" }] : [],
          daily_left: 40,
        });
      },
      unreadCount: () => Promise.resolve({ count: 0 }),
    },
  };
});

describe("an assignment row", () => {
  it("opens the assignment's TASK, never the assignment row's id", async () => {
    render(
      <MemoryRouter initialEntries={["/practice?tab=assignments"]}>
        <Routes>
          <Route path="/practice" element={<PracticeHubPage />} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    // `?tab=assignments` — where the `assignment_new` notification links — opens
    // the Topshiriqlar tab directly.
    await screen.findByText("Telefon suhbati");
    fireEvent.click(screen.getByRole("button", { name: t("mashq.assignments.start") }));

    expect(await screen.findByTestId("location")).toHaveTextContent("/task?task=question-42");
  });
});

describe("the Tovushlar mashqi entry", () => {
  const renderHub = () =>
    render(
      <MemoryRouter initialEntries={["/practice"]}>
        <Routes>
          <Route path="/practice" element={<PracticeHubPage />} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

  it("is how the sound drill is reached at all — it had a route and no way in", async () => {
    drillState = "Ready";
    renderHub();
    fireEvent.click(await screen.findByRole("button", { name: t("drill.entry.cta") }));
    expect(await screen.findByTestId("location")).toHaveTextContent("/drill");
  });

  it("leaves no trace when the drill cannot be practised here", async () => {
    drillState = "Disabled";
    renderHub();
    await screen.findByText(t("mashq.tabs.modules"));
    expect(screen.queryByText(t("drill.title"))).toBeNull();
  });
});

describe("switched-off drills", () => {
  const renderHub = () =>
    render(
      <MemoryRouter initialEntries={["/practice"]}>
        <Routes>
          <Route path="/practice" element={<PracticeHubPage />} />
        </Routes>
      </MemoryRouter>,
    );

  it("are never requested, so a normal load logs no 404", async () => {
    flags = { review_drill: false, phoneme_drill: false };
    renderHub();
    await screen.findByText(t("mashq.tabs.modules"));
    expect(drillCalls).toEqual([]);
    expect(screen.queryByText(t("drill.title"))).toBeNull();
  });

  it("are asked for, and offered, once their flag is on", async () => {
    flags = { review_drill: true, phoneme_drill: false };
    renderHub();
    await screen.findByRole("button", { name: t("review.entry.cta") });
    expect(drillCalls).toEqual(["review"]);
  });
});
