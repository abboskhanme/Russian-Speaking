/**
 * ReviewQueuePage — what "✓ Tasdiqlash" writes, and whether "▶ Audio" plays.
 *
 * WHY A PAGE TEST. The confirm leak lived in the page: it sent the canned note
 * "AI bahosi tasdiqlandi" as `teacher_comment`, and the STUDENT then read it as
 * feedback their teacher had written. Nothing on the teacher's screen shows it, so
 * only the request body can prove it is gone: `{ confirm: true }` and nothing else.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import i18n from "../../shared/i18n";
import type { SubmissionResponse } from "../../shared/api";
import ReviewQueuePage from "./ReviewQueuePage";

const t = i18n.getFixedT("uz", "common");

const ROW: SubmissionResponse = {
  id: "sub-1",
  student_id: "s-1",
  question_id: "q-1",
  reference_text: null,
  audio_key: "k",
  audio_url: "https://storage.example/answer.webm",
  audio_duration_sec: 14,
  status: "done",
  error_message: null,
  created_at: new Date().toISOString(),
  completed_at: null,
  student_name: "Dilfuza R.",
  question_title: "Do'konda xarid",
  question_topic: null,
  question_level: "A2",
  model_answer_text: null,
  teacher_comment: null,
  teacher_band: null,
  reviewed_at: null,
  overall_band: 71.6,
  fluency_score: null,
  lexical_score: null,
  grammar_score: null,
  pronunciation_score: null,
};

// Hoisted with the mock below, which runs before this module's own statements.
const { review } = vi.hoisted(() => ({ review: vi.fn() }));

vi.mock("../../shared/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared/api")>();
  return {
    ...actual,
    endpoints: {
      ...actual.endpoints,
      teacherReviewQueue: () => Promise.resolve([ROW]),
      reviewSubmission: (...args: unknown[]) => review(...args),
      unreadCount: () => Promise.resolve({ count: 0 }),
    },
  };
});

beforeEach(() => {
  review.mockReset().mockResolvedValue(undefined);
  // jsdom has no media pipeline; the player only needs to accept the calls.
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
});

function renderPage() {
  render(
    <MemoryRouter>
      <ReviewQueuePage />
    </MemoryRouter>,
  );
  return userEvent.setup();
}

describe("✓ Tasdiqlash", () => {
  it("sends { confirm: true } — no band, and no comment the student would read", async () => {
    const user = renderPage();
    await user.click(await screen.findByRole("button", { name: `✓ ${t("teacher.confirm")}` }));

    expect(review).toHaveBeenCalledTimes(1);
    expect(review).toHaveBeenCalledWith("sub-1", { confirm: true });
    // The row leaves the queue once the server has recorded it.
    expect(screen.queryByText("Dilfuza R.")).toBeNull();
  });
});

describe("▶ Audio", () => {
  it("is a real play/pause toggle", async () => {
    const user = renderPage();
    const play = await screen.findByRole("button", {
      name: t("teacher.audioPlay", { name: "Dilfuza R." }),
    });
    expect(play).toHaveAttribute("aria-pressed", "false");

    await user.click(play);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    const pause = screen.getByRole("button", { name: t("teacher.audioPause", { name: "Dilfuza R." }) });
    expect(pause).toHaveAttribute("aria-pressed", "true");

    await user.click(pause);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: t("teacher.audioPlay", { name: "Dilfuza R." }) })).toBeInTheDocument();
  });
});
