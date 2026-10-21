/**
 * AiBudgetCard — the platform-wide AI kill switch and spend caps.
 *
 * Three things matter here, and each is a way to spend money by accident:
 *   • the spend is shown AGAINST its cap, amber from 80% and red at 100% — the same
 *     80% the server logs a warning at;
 *   • a save sends only what changed, so flipping the switch never rewrites a cap an
 *     operator set elsewhere a minute ago;
 *   • a refused save says so beside the button instead of leaving the old numbers on
 *     screen looking saved.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n, { SUPPORTED_LANGS, resources } from "../../shared/i18n";
import { AiBudgetCard } from "./AiBudgetCard";
import type { AdminAiBudget } from "./AiBudgetCard";

const t = i18n.getFixedT("uz", "common");

const budget = (over: Partial<AdminAiBudget> = {}): AdminAiBudget => ({
  paused: false,
  dailyCapUsd: 10,
  monthlyCapUsd: 200,
  spentTodayUsd: 8.5,
  spentMonthUsd: 41.2,
  state: "open",
  day: "2026-10-21",
  month: [
    { provider: "anthropic", operation: "grader", calls: 120, failedCalls: 3, costUsd: 30.5 },
    { provider: "azure", operation: "stt", calls: 140, failedCalls: 0, costUsd: 10.7 },
  ],
  ...over,
});

describe("AiBudgetCard", () => {
  it("shows today's and this month's spend against the caps, and the breakdown", () => {
    render(<AiBudgetCard budget={budget()} />);

    expect(screen.getByText("$8.50 / $10.00")).toBeInTheDocument();
    expect(screen.getByText("$41.20 / $200.00")).toBeInTheDocument();
    // 85% of the daily cap: past the warning line, not yet at the cap.
    const today = screen.getByRole("meter", { name: t("admin.aiSpentToday", { day: "2026-10-21" }) });
    expect(today).toHaveAttribute("data-tone", "warn");
    expect(screen.getByRole("meter", { name: t("admin.aiSpentMonth") })).toHaveAttribute("data-tone", "ok");
    expect(screen.getByText("$30.50")).toBeInTheDocument();
    expect(screen.getByText(t("admin.aiCalls", { calls: 120, failed: 3 }))).toBeInTheDocument();
    expect(screen.getByText(t("admin.aiBudgetState.open"))).toBeInTheDocument();
  });

  it("marks a reached cap and a paused budget in its badge", () => {
    const { rerender } = render(<AiBudgetCard budget={budget({ state: "daily_cap", spentTodayUsd: 10.2 })} />);
    expect(screen.getByText(t("admin.aiBudgetState.daily_cap"))).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: t("admin.aiSpentToday", { day: "2026-10-21" }) }))
      .toHaveAttribute("data-tone", "danger");

    rerender(<AiBudgetCard budget={budget({ state: "paused", paused: true })} />);
    expect(screen.getByText(t("admin.aiBudgetState.paused"))).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: t("admin.aiPaused") })).toHaveAttribute("aria-checked", "true");
  });

  it("pausing sends the switch alone — never the caps it did not touch", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<AiBudgetCard budget={budget()} onSave={onSave} />);

    await user.click(screen.getByRole("switch", { name: t("admin.aiPaused") }));
    await user.click(screen.getByRole("button", { name: t("admin.saveAiBudget") }));

    expect(onSave).toHaveBeenCalledWith({ aiPaused: "true" });
    expect(await screen.findByText(t("admin.saved"))).toBeInTheDocument();
  });

  it("sends an edited cap as typed, and says so when the server refuses it", async () => {
    const onSave = vi.fn().mockRejectedValue(Object.assign(new Error("400"), { status: 400 }));
    const user = userEvent.setup();
    render(<AiBudgetCard budget={budget()} onSave={onSave} />);

    const daily = screen.getByLabelText(t("admin.aiDailyCap"));
    await user.clear(daily);
    await user.type(daily, "0");
    await user.click(screen.getByRole("button", { name: t("admin.saveAiBudget") }));

    expect(onSave).toHaveBeenCalledWith({ dailyCapUsd: "0" });
    expect(await screen.findByRole("alert")).toHaveTextContent(t("admin.aiBudgetInvalid"));
  });

  // The card builds these keys from server values (`admin.aiBudgetState.${state}`), which
  // the source-scanning locale test cannot see — so they are pinned here, in all three.
  it.each(SUPPORTED_LANGS)("names every state and operation in %s", (lang) => {
    const admin = (resources[lang].common as unknown as { admin: Record<string, Record<string, string> | undefined> }).admin;
    for (const state of ["open", "paused", "daily_cap", "monthly_cap"])
      expect(admin.aiBudgetState?.[state]?.trim()).toBeTruthy();
    for (const op of ["stt", "grader"]) expect(admin.aiOperation?.[op]?.trim()).toBeTruthy();
  });
});
