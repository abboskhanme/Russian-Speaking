/**
 * /task — what happens AFTER the answer (mockup B6, "the value moment").
 *
 * It used to be a toast and then a different task: `feedback={null}`, a poll that
 * gave up after ~24 s (grading takes 9–19 s), and no way to see the result. Now
 * the result appears in place; an answer still grading after a minute says so and
 * points at Natijalar; a failure is worded from its machine code with a retry; a
 * submit refused as deleted is the "not available" state, not raw English.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "../../shared/i18n";
import type { AttemptDetailResponse, SubmissionResponse } from "../../shared/api";
import PracticePage from "./PracticePage";
import { CATALOGUE, LocationProbe, apiError } from "./practiceFixtures.test-utils";

const t = i18n.getFixedT("uz", "common");

const SUB: SubmissionResponse = {
  id: "sub-1",
  student_id: "s",
  question_id: "t1",
  reference_text: null,
  audio_key: "k",
  audio_url: null,
  audio_duration_sec: 12,
  status: "pending",
  error_message: null,
  created_at: "2026-09-29T10:00:00Z",
  completed_at: null,
  student_name: null,
  question_title: "Do'konda",
  question_topic: null,
  question_level: "A2",
  model_answer_text: null,
  teacher_comment: null,
  teacher_band: null,
  reviewed_at: null,
  overall_band: null,
  fluency_score: null,
  lexical_score: null,
  grammar_score: null,
  pronunciation_score: null,
};

const DETAIL = {
  band: 74,
  overall_band: 74,
  transcript: "я вчера ходил в магазин",
  feedback: JSON.stringify({ summary: "Тебя легко понять.", strengths: ["Tabiiy temp"] }),
  corrections: "[]",
  fluency_score: 78,
  lexical_score: 64,
  grammar_score: 52,
  pronunciation_score: 71,
} as unknown as AttemptDetailResponse;

/** What each poll answers, in order; the last entry repeats. */
let polls: SubmissionResponse[] = [];
let submit: () => Promise<SubmissionResponse> = () => Promise.resolve(SUB);

vi.mock("../../shared/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared/api")>();
  return {
    ...actual,
    endpoints: {
      ...actual.endpoints,
      studentBlocks: () => Promise.resolve(CATALOGUE),
      unreadCount: () => Promise.resolve({ count: 0 }),
      submitAudio: () => submit(),
      getSubmission: () => Promise.resolve(polls.length > 1 ? polls.shift()! : polls[0]),
      attemptDetail: () => Promise.resolve(DETAIL),
    },
  };
});

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

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/task" element={<PracticePage />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Record, then let the poll schedule run `ms` of (fake) time. */
async function answerAndWait(ms: number) {
  fireEvent.click(await screen.findByRole("button", { name: "fake-record" }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  submit = () => Promise.resolve(SUB);
  polls = [SUB];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a graded answer", () => {
  it("shows the result in place, with the way to the full detail", async () => {
    polls = [{ ...SUB, status: "processing" }, { ...SUB, status: "done", overall_band: 74 }];
    renderAt("/task?task=t1");
    await answerAndWait(10_000);

    expect(await screen.findByText("74")).toBeInTheDocument();
    expect(screen.getByText("Тебя легко понять.")).toBeInTheDocument();
    expect(screen.getByText(t("practice.levelBadge", { band: "B2" }))).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: t("practice.details") }));
    expect(await screen.findByTestId("location")).toHaveTextContent("/results/sub-1");
  });

  it("waits past the old 24 s ceiling for a slow grade", async () => {
    // Nine polls of "processing" (≈ 36 s on the schedule) before the grade lands.
    polls = [
      ...Array.from({ length: 9 }, () => ({ ...SUB, status: "processing" as const })),
      { ...SUB, status: "done", overall_band: 74 },
    ];
    renderAt("/task?task=t1");
    await answerAndWait(45_000);
    expect(await screen.findByText("74")).toBeInTheDocument();
  });

  it("offers the way back to the daily session when it came from there", async () => {
    polls = [{ ...SUB, status: "done", overall_band: 74 }];
    renderAt("/task?task=t1&from=daily");
    await answerAndWait(3_000);

    fireEvent.click(await screen.findByRole("button", { name: t("practice.backToDaily") }));
    expect(await screen.findByTestId("location")).toHaveTextContent("/daily");
  });
});

describe("an answer still grading after a minute", () => {
  it("says it is saved and where the result will appear — not a dead end", async () => {
    polls = [{ ...SUB, status: "processing" }];
    renderAt("/task?task=t1");
    await answerAndWait(61_000);

    expect(await screen.findByText(t("practice.pending.title"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("practice.pending.cta") }));
    expect(await screen.findByTestId("location")).toHaveTextContent("/results");
  });
});

describe("a failed grade", () => {
  it("words the failure code and offers the retry", async () => {
    polls = [{ ...SUB, status: "failed", error_message: "stt_failed" }];
    renderAt("/task?task=t1");
    await answerAndWait(3_000);

    expect(await screen.findByText(t("results.failure.stt_failed"))).toBeInTheDocument();
    expect(screen.queryByText("stt_failed")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: t("common.retry") }));
    expect(await screen.findByRole("button", { name: "fake-record" })).toBeInTheDocument();
  });

  it("never shows a pre-code row's free text", async () => {
    polls = [{ ...SUB, status: "failed", error_message: "System.Exception: boom" }];
    renderAt("/task?task=t1");
    await answerAndWait(3_000);
    expect(await screen.findByText(t("results.failure.internal"))).toBeInTheDocument();
    expect(screen.queryByText(/System\.Exception/)).not.toBeInTheDocument();
  });
});

describe("a refused submit", () => {
  it("turns a 404 (task deleted) into the not-available state, not raw text", async () => {
    submit = () => Promise.reject(apiError(404));
    renderAt("/task?task=t1");
    await answerAndWait(0);

    expect(await screen.findByText(t("practice.unavailable.title"))).toBeInTheDocument();
    expect(screen.queryByText(/assigned to you/)).not.toBeInTheDocument();
  });

  it("turns a 403 into the closed state", async () => {
    submit = () => Promise.reject(apiError(403));
    renderAt("/task?task=t1");
    await answerAndWait(0);
    expect(await screen.findByText(t("practice.closed.title"))).toBeInTheDocument();
  });
});
