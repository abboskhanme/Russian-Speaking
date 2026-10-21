/**
 * AttemptReviewScreen — B2 transcript and B3 manual grade.
 *
 *   • **The transcript must be text, not a row of glued spans.** With no whitespace
 *     between the word spans the paragraph never wrapped (585px in a 356px card on
 *     a phone) and a copied transcript came out as one word.
 *   • **A comment-only save must not override the score.** The slider always holds
 *     a value, and it used to be sent every time — so writing a note silently
 *     replaced the AI's 71.6 with the teacher's "72" everywhere downstream.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "../../shared/i18n";
import { AttemptReviewScreen } from "./AttemptReviewScreen";
import type { AttemptReviewProps } from "./AttemptReviewScreen";

const t = i18n.getFixedT("uz", "common");

const BASE: AttemptReviewProps = {
  studentName: "Dilfuza R.",
  taskLine: "Do'konda xarid · A2",
  score: 71.6,
  audioUrl: null,
  words: [
    { word: "Я", accuracy: 95 },
    { word: "вчера", accuracy: 70 },
    { word: "идти", accuracy: 40 },
  ],
  criteria: [],
  corrections: [],
  feedback: null,
  reviewed: false,
};

describe("transcript", () => {
  it("separates words with real spaces, so it wraps and copies as text", () => {
    render(<AttemptReviewScreen {...BASE} />);
    const p = screen.getByText("вчера").parentElement as HTMLElement;
    expect(p.textContent).toBe("Я вчера идти");
  });
});

describe("manual grade", () => {
  async function openSheet() {
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: t("teacher.gradeManually") }));
    return { user, sheet: screen.getByRole("dialog", { name: t("teacher.gradeManually") }) };
  }

  it("sends a comment WITHOUT a band when the slider was not moved", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<AttemptReviewScreen {...BASE} onSave={onSave} />);
    const { user, sheet } = await openSheet();

    await user.type(within(sheet).getByLabelText(t("teacher.commentLabel")), "Yaxshi urinish!");
    await user.click(within(sheet).getByRole("button", { name: t("teacher.saveReview") }));

    expect(onSave).toHaveBeenCalledWith({ comment: "Yaxshi urinish!" });
  });

  it("sends the band once the teacher actually moves it", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<AttemptReviewScreen {...BASE} onSave={onSave} />);
    const { user, sheet } = await openSheet();

    fireEvent.change(within(sheet).getByRole("slider", { name: t("teacher.overallBand") }), {
      target: { value: "64" },
    });
    await user.click(within(sheet).getByRole("button", { name: t("teacher.saveReview") }));

    expect(onSave).toHaveBeenCalledWith({ band: 64 });
  });

  it("has nothing to save until something changed", async () => {
    render(<AttemptReviewScreen {...BASE} onSave={vi.fn()} />);
    const { sheet } = await openSheet();
    expect(within(sheet).getByRole("button", { name: t("teacher.saveReview") })).toBeDisabled();
  });
});

/**
 * Bug 7 — the actions follow the attempt's state. A reviewed attempt used to
 * still offer "Tasdiqlash", which only re-stamped the same verdict; a failed one
 * offered to "confirm" a score that does not exist.
 */
describe("actions by state", () => {
  it("offers confirm on a fresh attempt", () => {
    render(<AttemptReviewScreen {...BASE} />);
    expect(screen.getByRole("button", { name: new RegExp(t("teacher.confirm")) })).toBeInTheDocument();
  });

  it("hides confirm once reviewed and relabels manual grading", () => {
    render(<AttemptReviewScreen {...BASE} reviewed teacherBand={80} />);
    expect(screen.queryByRole("button", { name: new RegExp(t("teacher.confirm")) })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("uiDash.review.changeGrade") })).toBeInTheDocument();
    // Not the only status on the page: the audio player has its own (its "unavailable" row).
    const note = screen
      .getAllByRole("status")
      .find((el) => el.textContent?.includes(t("teacher.alreadyReviewedBand", { band: 80 })));
    expect(note).toBeDefined();
  });

  it("offers a regrade instead of confirm when grading failed, and shows a refusal", async () => {
    const onRegrade = vi.fn().mockRejectedValue(new Error("AI hozir yo'q"));
    render(<AttemptReviewScreen {...BASE} score={undefined} failedReason="Baholanmadi" onRegrade={onRegrade} />);
    expect(screen.queryByRole("button", { name: new RegExp(t("teacher.confirm")) })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: t("uiDash.regrade.action") }));
    expect(onRegrade).toHaveBeenCalledOnce();
    expect(await screen.findByText("AI hozir yo'q")).toBeInTheDocument();
  });
});
