/**
 * /task — what the student is shown BEFORE they answer.
 *
 *   • The question itself: the task screen used to show only the title, so a
 *     student asked about a shop never saw the question about the shop. The
 *     prompt, the instruction and the picture are on screen, and the task's prep
 *     time and answer limit reach the recorder.
 *   • An unknown `?task=` is "not available" — it used to be silently swapped for
 *     the first open task, so a stale or unpublished assignment was answered as a
 *     different question.
 *   • A premium-locked task says so before recording (the 402 used to arrive
 *     after a whole answer had been recorded for nothing). So does a task behind
 *     the module's order — the server refuses that answer too.
 *   • Skip moves to the NEXT open task and the URL follows (it used to reload the
 *     task being skipped).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "../../shared/i18n";
import type { StudentModuleResponse } from "../../shared/api";
import PracticePage from "./PracticePage";
import { CATALOGUE, LocationProbe, task } from "./practiceFixtures.test-utils";

const t = i18n.getFixedT("uz", "common");

let catalogue: StudentModuleResponse[] = CATALOGUE;

vi.mock("../../shared/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared/api")>();
  return {
    ...actual,
    endpoints: {
      ...actual.endpoints,
      studentBlocks: () => Promise.resolve(catalogue),
      unreadCount: () => Promise.resolve({ count: 0 }),
    },
  };
});

// jsdom has no MediaRecorder: a stand-in that exposes what the page passed in.
vi.mock("../../shared/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared/ui")>();
  return {
    ...actual,
    Recorder: (props: { prepMs?: number; maxDurationMs?: number }) => (
      <div
        data-testid="recorder"
        data-prep={props.prepMs ?? "none"}
        data-max={props.maxDurationMs ?? "default"}
      />
    ),
  };
});

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/task" element={<><PracticePage /><LocationProbe /></>} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  catalogue = CATALOGUE;
});

describe("the task card", () => {
  it("shows the question, not just its title", async () => {
    renderAt("/task?task=t1");

    expect(await screen.findByText("Расскажите, что вы вчера купили в магазине.")).toBeInTheDocument();
    expect(screen.getByText("Do'konda")).toBeInTheDocument();
    expect(screen.getByText("3–4 gap bilan javob bering.")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: t("practice.mediaAlt", { title: "Do'konda" }) }))
      .toHaveAttribute("src", "https://cdn.example/shop.png");
  });

  it("hands the task's prep time and answer limit to the recorder", async () => {
    renderAt("/task?task=t1");
    const recorder = await screen.findByTestId("recorder");
    expect(recorder).toHaveAttribute("data-prep", "30000");
    expect(recorder).toHaveAttribute("data-max", "90000");
  });

  it("degrades to today's behaviour against an API that sends none of it", async () => {
    catalogue = [{ ...CATALOGUE[0], tasks: [task("old", { title: "Eski vazifa" })] }];
    renderAt("/task?task=old");

    expect(await screen.findByText("Eski vazifa")).toBeInTheDocument();
    const recorder = screen.getByTestId("recorder");
    expect(recorder).toHaveAttribute("data-prep", "none");
    expect(recorder).toHaveAttribute("data-max", "default");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});

describe("a task the student cannot answer", () => {
  it("says an unknown ?task= is not available — never answers another task", async () => {
    renderAt("/task?task=gone");

    expect(await screen.findByText(t("practice.unavailable.title"))).toBeInTheDocument();
    expect(screen.queryByTestId("recorder")).not.toBeInTheDocument();
    // In particular NOT the first open task (t1) in its place.
    expect(screen.queryByText("Do'konda")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: t("practice.unavailable.cta") }));
    expect(await screen.findByTestId("location")).toHaveTextContent("/practice");
  });

  it("shows the premium lock BEFORE recording, with the way to Premium", async () => {
    renderAt("/task?task=t3");

    expect(await screen.findByText(t("practice.locked.title"))).toBeInTheDocument();
    expect(screen.queryByTestId("recorder")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: t("practice.locked.cta") }));
    expect(await screen.findByTestId("location")).toHaveTextContent("/premium");
  });

  it("shows the order lock BEFORE recording, and sends them to the module's current task", async () => {
    catalogue = [{
      ...CATALOGUE[0],
      tasks: [CATALOGUE[0].tasks[0], task("t2", { title: "Oila haqida", locked: true })],
    }];
    renderAt("/task?task=t2");

    expect(await screen.findByText(t("practice.sequence.title"))).toBeInTheDocument();
    expect(screen.queryByTestId("recorder")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: t("practice.sequence.cta") }));
    expect(await screen.findByText("Расскажите, что вы вчера купили в магазине.")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("task=t1");
  });

  it("a task behind both locks gets the premium screen, the one that can change", async () => {
    catalogue = [{
      ...CATALOGUE[0],
      tasks: [CATALOGUE[0].tasks[0], task("t3", { locked: true, premium_locked: true })],
    }];
    renderAt("/task?task=t3");

    expect(await screen.findByText(t("practice.locked.title"))).toBeInTheDocument();
    expect(screen.queryByText(t("practice.sequence.title"))).not.toBeInTheDocument();
  });
});

describe("skipping", () => {
  it("moves to the next OPEN task and puts it in the URL", async () => {
    renderAt("/task?task=t1");
    await screen.findByText("Do'konda");

    fireEvent.click(screen.getByRole("button", { name: t("practice.skipCta") }));

    expect(await screen.findByText("Oila haqida")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/task?task=t2");
  });

  it("is not offered when no other task is open", async () => {
    catalogue = [{ ...CATALOGUE[0], tasks: [task("only", { title: "Yagona" })] }];
    renderAt("/task?task=only");
    await screen.findByText("Yagona");
    expect(screen.queryByRole("button", { name: t("practice.skipCta") })).not.toBeInTheDocument();
  });
});
