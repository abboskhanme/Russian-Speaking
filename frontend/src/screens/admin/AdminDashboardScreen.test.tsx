/**
 * AdminDashboardScreen — "how far behind is grading?", answered honestly.
 *
 * WHY THIS IS TESTED. The card under the counters used to say "2 ta javob hali
 * baholanmagan" by subtracting graded from submitted — which counted FAILED answers
 * as merely late. An admin reading "still ungraded" waits; an answer that failed will
 * never finish on its own. So in-flight and failed are separate lines now, and the old
 * coarse sentence survives only for an API that predates the split.
 *
 * The floored percentage is pinned too: 768 of 770 ROUNDS to 100 %, which sat directly
 * above a line saying work was still outstanding. Only a genuinely finished queue may
 * read 100 %.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import i18n from "../../shared/i18n";
import { AdminDashboardScreen } from "./AdminDashboardScreen";
import type { AdminStats } from "./AdminDashboardScreen";

const t = i18n.getFixedT("uz", "common");

const stats = (over: Partial<AdminStats> = {}): AdminStats => ({
  teachers: 3,
  students: 40,
  questions: 10,
  publishedQuestions: 8,
  submissions: 770,
  evaluatedSubmissions: 765,
  pendingSubmissions: 2,
  failedSubmissions: 3,
  ...over,
});

describe("the grading line", () => {
  it("keeps in-flight and failed apart, and never calls a failure 'ungraded'", () => {
    render(<AdminDashboardScreen stats={stats()} />);

    expect(screen.getByText(t("admin.pendingNote", { count: 2 }))).toBeInTheDocument();
    expect(screen.getByText(t("admin.failedNote", { count: 3 }))).toBeInTheDocument();
    expect(screen.queryByText(t("admin.ungradedNote", { count: 5 }))).not.toBeInTheDocument();
    expect(screen.queryByText(t("admin.allGradedNote"))).not.toBeInTheDocument();
  });

  it("shows only the failure when nothing is in flight", () => {
    render(<AdminDashboardScreen stats={stats({ evaluatedSubmissions: 767, pendingSubmissions: 0 })} />);

    expect(screen.getByText(t("admin.failedNote", { count: 3 }))).toBeInTheDocument();
    expect(screen.queryByText(t("admin.pendingNote", { count: 0 }))).not.toBeInTheDocument();
  });

  it("says all graded only when the arithmetic agrees", () => {
    render(
      <AdminDashboardScreen
        stats={stats({ evaluatedSubmissions: 770, pendingSubmissions: 0, failedSubmissions: 0 })}
      />,
    );
    expect(screen.getByText(t("admin.allGradedNote"))).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
  });

  it("falls back to the coarse sentence for an API without the split", () => {
    render(
      <AdminDashboardScreen
        stats={stats({ evaluatedSubmissions: 768, pendingSubmissions: null, failedSubmissions: null })}
      />,
    );
    expect(screen.getByText(t("admin.ungradedNote", { count: 2 }))).toBeInTheDocument();
  });
});

describe("the graded percentage", () => {
  it("is floored: 768 of 770 reads 99, not 100", () => {
    render(<AdminDashboardScreen stats={stats({ evaluatedSubmissions: 768 })} />);
    expect(screen.getByText("99")).toBeInTheDocument();
    expect(screen.queryByText("100")).not.toBeInTheDocument();
  });
});

describe("trend tiles, AI budget and the failed list", () => {
  const day = (i: number, submissions: number, graded = submissions) => ({
    date: `2026-10-${String(8 + i).padStart(2, "0")}`,
    submissions,
    graded,
    failed: submissions - graded,
    activeStudents: 1,
    newStudents: 0,
    aiCostUsd: 0.01,
  });

  it("compares this week with the one before", () => {
    // previous 7 days: 10 answers; this 7 days: 15 → ↑ 50%
    const activity = [
      ...Array.from({ length: 7 }, (_, i) => day(i, i < 2 ? 5 : 0)),
      ...Array.from({ length: 7 }, (_, i) => day(7 + i, i < 3 ? 5 : 0)),
    ];
    render(<AdminDashboardScreen stats={stats()} activity={activity} />);
    expect(screen.getByText(t("uiDash.admin.deltaUp", { value: "50%" }))).toBeInTheDocument();
  });

  it("shows AI spend against the cap and links to Settings", async () => {
    const onOpen = vi.fn();
    render(
      <AdminDashboardScreen
        stats={stats()}
        budget={{ spentTodayUsd: 1.5, dailyCapUsd: 5, state: "open" }}
        onOpenAiSettings={onOpen}
      />,
    );
    expect(screen.getByText("$1.50")).toBeInTheDocument();
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "1.5");
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("uiDash.admin.kpiAiToday")) }));
    expect(onOpen).toHaveBeenCalled();
  });

  it("raises a closed budget as an alert", () => {
    render(<AdminDashboardScreen stats={stats()} budget={{ spentTodayUsd: 5, dailyCapUsd: 5, state: "daily_cap" }} />);
    expect(
      screen.getByText(t("uiDash.admin.budgetClosed", { state: t("admin.aiBudgetState.daily_cap") })),
    ).toBeInTheDocument();
  });

  it("expands the failed alert into answers that can be graded again", async () => {
    const onRegrade = vi.fn().mockResolvedValue(undefined);
    render(
      <AdminDashboardScreen
        stats={stats()}
        onRegrade={onRegrade}
        failedItems={[
          { id: "s1", studentName: "Ali", taskTitle: "Еда", reason: "x", when: "21.10.2026 10:00", canRegrade: true },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("admin.failedNote", { count: 3 })) }));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("uiDash.regrade.action")) }));
    expect(onRegrade).toHaveBeenCalledWith("s1");
    expect(await screen.findByText(t("uiDash.regrade.sent"))).toBeInTheDocument();
  });
});
