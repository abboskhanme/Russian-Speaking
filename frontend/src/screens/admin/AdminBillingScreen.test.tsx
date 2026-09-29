/**
 * AdminBillingScreen — what the admin is told about who has premium, and how a tariff
 * is removed.
 *
 * WHY THIS IS TESTED.
 *
 *   • A subscription whose window CLOSED still showed a green "Premium" badge, because
 *     the badge read the stored `status` and nothing flips a row to `expired` at the
 *     instant it ends. The server's `PremiumAccess` checks the dates; so must the badge,
 *     or the admin is told someone has access the gate is already refusing.
 *   • "O'chirish" deleted a tariff on one tap, and the inactive status next to it read
 *     "o'chirilgan" — "deleted" — beside a button that deletes. Now the status is
 *     Faol/Nofaol and the delete is a confirm that reports the server's refusal inside
 *     the dialog.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "../../shared/i18n";
import type { ApiError } from "../../shared/api";
import { AdminBillingScreen, effectiveStatus } from "./AdminBillingScreen";
import type { AdminPlan, AdminSubscriptionRow } from "./AdminBillingScreen";

const t = i18n.getFixedT("uz", "common");

const NOW = Date.parse("2026-09-29T12:00:00Z");

const sub = (over: Partial<AdminSubscriptionRow> = {}): AdminSubscriptionRow => ({
  id: "sub-1",
  userName: "Dilnoza Karimova",
  userEmail: null,
  planName: "1 oylik Premium",
  status: "active",
  startsAt: "2001-01-01T00:00:00Z",
  endsAt: "2999-01-01T00:00:00Z",
  provider: null,
  teacherGranted: false,
  ...over,
});

const plan = (over: Partial<AdminPlan> = {}): AdminPlan => ({
  id: "p-1",
  code: "monthly",
  name: "1 oylik Premium",
  description: null,
  priceMinor: 4_990_000,
  currency: "UZS",
  durationDays: 30,
  active: true,
  sortOrder: 0,
  ...over,
});

describe("effectiveStatus — the PremiumAccess rule", () => {
  it.each([
    ["active and inside its window", sub(), "active"],
    ["active but ended", sub({ endsAt: "2026-08-31T09:00:00Z" }), "expired"],
    ["active and open-ended", sub({ endsAt: null }), "active"],
    ["active but not started", sub({ startsAt: "2026-10-01T00:00:00Z" }), "pending"],
    ["stored expired", sub({ status: "expired" }), "expired"],
    ["an unknown status", sub({ status: "refunded" }), "other"],
  ])("%s", (_label, row, expected) => {
    expect(effectiveStatus(row, NOW)).toBe(expected);
  });
});

function renderBilling(props: Partial<Parameters<typeof AdminBillingScreen>[0]> = {}) {
  render(
    <AdminBillingScreen
      plans={[plan()]}
      subscriptions={[]}
      paymentsEnabled={false}
      providerConfigured={false}
      {...props}
    />,
  );
  return userEvent.setup();
}

describe("the subscriptions list", () => {
  it("does not badge an ended subscription as Premium", () => {
    renderBilling({ subscriptions: [sub({ endsAt: "2001-02-01T00:00:00Z" })] });

    const row = screen.getByText("Dilnoza Karimova").closest("li") as HTMLElement;
    expect(within(row).getByText(t("billing.status.expired"))).toBeInTheDocument();
    expect(within(row).queryByText(t("billing.status.active"))).not.toBeInTheDocument();
  });

  it("never prints a raw status string", () => {
    renderBilling({ subscriptions: [sub({ status: "refunded" })] });
    expect(screen.queryByText("refunded")).not.toBeInTheDocument();
    expect(screen.getByText(t("admin.billing.statusOther"))).toBeInTheDocument();
  });
});

describe("tariffs", () => {
  it("reads Faol / Nofaol, never 'o'chirilgan' next to the delete button", () => {
    renderBilling({ plans: [plan(), plan({ id: "p-2", name: "Eski tarif", active: false })] });
    expect(screen.getByText(t("admin.billing.planInactive"))).toBeInTheDocument();
    expect(screen.queryByText(t("admin.billing.off"))).not.toBeInTheDocument();
  });

  it("deletes only after a confirm", async () => {
    const onDelete = vi.fn(() => Promise.resolve());
    const user = renderBilling({ onDelete });

    await user.click(screen.getByRole("button", { name: t("admin.billing.delete") }));
    expect(onDelete).not.toHaveBeenCalled();

    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("1 oylik Premium")).toBeInTheDocument();
    await user.click(dialog.getByRole("button", { name: t("admin.billing.deleteConfirm") }));

    expect(onDelete).toHaveBeenCalledWith("p-1");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("reports a refused delete inside the dialog, with the way out", async () => {
    const refused = new Error("x") as ApiError;
    refused.name = "ApiError";
    refused.status = 409;
    refused.detail = "plan has subscriptions";
    refused.body = { detail: refused.detail };
    const user = renderBilling({ onDelete: vi.fn(() => Promise.reject(refused)) });

    await user.click(screen.getByRole("button", { name: t("admin.billing.delete") }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: t("admin.billing.deleteConfirm") }),
    );

    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent(
      t("admin.billing.deleteRefused"),
    );
  });
});
