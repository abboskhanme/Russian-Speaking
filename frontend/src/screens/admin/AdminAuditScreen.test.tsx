/**
 * AdminAuditScreen — Jurnal, read honestly.
 *
 * WHY THIS IS TESTED.
 *
 *   • A settings save is recorded as the NAMES of the keys that changed, never their
 *     values. The screen must show exactly that — the name is the useful part ("someone
 *     replaced the Gemini key") — and must not invent a value line for it.
 *   • The actor's name is the screen's main filter ("what else did they do?"). A click
 *     that filtered by the wrong field, or dropped the other filters, would answer a
 *     different question without saying so.
 *   • Times are Tashkent wall-clock, the same zone the date filters use. A
 *     browser-local time would put a row on a different day than the filter that found it.
 *   • A row whose actor has been deleted, or whose action this build has never heard
 *     of, still renders — an audit screen that hides rows it cannot label is worse
 *     than one that shows a raw name.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "../../shared/i18n";
import { AdminAuditScreen, EMPTY_AUDIT_FILTERS, formatTashkent } from "./AdminAuditScreen";
import type { AdminAuditEntry } from "./AdminAuditScreen";

const t = i18n.getFixedT("uz", "common");

const entry = (over: Partial<AdminAuditEntry> = {}): AdminAuditEntry => ({
  id: "a-1",
  createdAt: "2026-10-21T09:37:00Z",
  actorId: "admin-1",
  actorName: "Aziza Karimova",
  action: "student.update",
  targetType: "user",
  targetId: "s-1",
  targetLabel: "Dilnoza Rahimova",
  fields: ["is_premium"],
  values: { is_premium: "true" },
  ip: "10.0.0.7",
  ...over,
});

describe("a row", () => {
  it("names the action, the target, the allow-listed value and the time in Tashkent", () => {
    render(
      <AdminAuditScreen entries={[entry()]} total={1} page={1} pageSize={50} filters={EMPTY_AUDIT_FILTERS} />,
    );

    expect(screen.getByText(t("admin.audit.action.studentUpdate"))).toBeInTheDocument();
    expect(screen.getByText("Dilnoza Rahimova")).toBeInTheDocument();
    expect(screen.getByText("is_premium: true")).toBeInTheDocument();
    // 09:37 UTC is 14:37 in Tashkent (UTC+5, no DST).
    expect(screen.getByText("2026-10-21 14:37")).toBeInTheDocument();
    expect(screen.getByText(t("admin.audit.ip", { ip: "10.0.0.7" }))).toBeInTheDocument();
  });

  it("shows a secret key by NAME only, with no value line", () => {
    render(
      <AdminAuditScreen
        entries={[
          entry({
            action: "settings.ai.update",
            targetType: "settings",
            targetId: null,
            targetLabel: null,
            fields: ["gemini_api_key", "orthoepy_enabled"],
            values: { orthoepy_enabled: "false" },
          }),
        ]}
        total={1}
        page={1}
        pageSize={50}
        filters={EMPTY_AUDIT_FILTERS}
      />,
    );

    expect(screen.getByText(t("admin.audit.action.aiUpdate"))).toBeInTheDocument();
    expect(screen.getByText("orthoepy_enabled: false")).toBeInTheDocument();
    // The key is listed among the changed fields — and only there.
    expect(screen.getByText(t("admin.audit.fields", { fields: "gemini_api_key" }))).toBeInTheDocument();
    expect(screen.queryByText(/gemini_api_key:/)).not.toBeInTheDocument();
  });

  it("still renders a deleted actor and an action this build does not know", () => {
    render(
      <AdminAuditScreen
        entries={[entry({ actorName: null, action: "group.archive", values: {}, fields: [] })]}
        total={1}
        page={1}
        pageSize={50}
        filters={EMPTY_AUDIT_FILTERS}
      />,
    );

    expect(screen.getByText("group.archive")).toBeInTheDocument();
    expect(screen.getByText(t("admin.audit.deletedActor"))).toBeInTheDocument();
  });
});

describe("filters", () => {
  it("filters by the actor whose name was tapped, keeping the other filters", async () => {
    const onFiltersChange = vi.fn();
    render(
      <AdminAuditScreen
        entries={[entry()]}
        total={1}
        page={1}
        pageSize={50}
        filters={{ ...EMPTY_AUDIT_FILTERS, action: "student" }}
        onFiltersChange={onFiltersChange}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: t("admin.audit.filterByActor", { name: "Aziza Karimova" }) }),
    );
    expect(onFiltersChange).toHaveBeenCalledWith({
      action: "student",
      from: "",
      to: "",
      actorId: "admin-1",
      actorName: "Aziza Karimova",
    });
  });

  it("sends the action group as a prefix, and clears everything at once", async () => {
    const onFiltersChange = vi.fn();
    const { rerender } = render(
      <AdminAuditScreen
        entries={[entry()]}
        total={1}
        page={1}
        pageSize={50}
        filters={EMPTY_AUDIT_FILTERS}
        onFiltersChange={onFiltersChange}
      />,
    );

    await userEvent.selectOptions(screen.getByLabelText(t("admin.audit.filterAction")), "settings");
    expect(onFiltersChange).toHaveBeenLastCalledWith({ ...EMPTY_AUDIT_FILTERS, action: "settings" });

    rerender(
      <AdminAuditScreen
        entries={[]}
        total={0}
        page={1}
        pageSize={50}
        filters={{ ...EMPTY_AUDIT_FILTERS, action: "settings", actorId: "admin-1", actorName: "Aziza" }}
        onFiltersChange={onFiltersChange}
      />,
    );
    // Filtered and empty is a different sentence from "nothing has happened yet".
    expect(screen.getByText(t("admin.audit.emptyFiltered"))).toBeInTheDocument();
    expect(screen.getByText(t("admin.audit.actorOnly", { name: "Aziza" }))).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: t("admin.audit.clear") }));
    expect(onFiltersChange).toHaveBeenLastCalledWith(EMPTY_AUDIT_FILTERS);
  });

  it("says 'nothing yet' on an unfiltered empty trail", () => {
    render(<AdminAuditScreen entries={[]} total={0} page={1} pageSize={50} filters={EMPTY_AUDIT_FILTERS} />);
    expect(screen.getByText(t("admin.audit.empty"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("admin.audit.clear") })).not.toBeInTheDocument();
  });
});

describe("paging", () => {
  it("pages through the total and stops at both ends", async () => {
    const onPageChange = vi.fn();
    render(
      <AdminAuditScreen
        entries={[entry()]}
        total={120}
        page={1}
        pageSize={50}
        filters={EMPTY_AUDIT_FILTERS}
        onPageChange={onPageChange}
      />,
    );

    const pager = screen.getByRole("navigation", { name: t("admin.audit.pages") });
    expect(within(pager).getByText(t("admin.audit.pageOf", { page: 1, pages: 3 }))).toBeInTheDocument();
    expect(within(pager).getByRole("button", { name: t("admin.audit.prev") })).toBeDisabled();
    await userEvent.click(within(pager).getByRole("button", { name: t("admin.audit.next") }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("has no pager when everything fits on one page", () => {
    render(
      <AdminAuditScreen entries={[entry()]} total={1} page={1} pageSize={50} filters={EMPTY_AUDIT_FILTERS} />,
    );
    expect(screen.queryByRole("navigation", { name: t("admin.audit.pages") })).not.toBeInTheDocument();
  });
});

describe("formatTashkent", () => {
  it("crosses midnight into the Tashkent date", () => {
    // 21:30 UTC on the 20th is already 02:30 on the 21st in Tashkent.
    expect(formatTashkent("2026-10-20T21:30:00Z")).toBe("2026-10-21 02:30");
  });

  it("returns an unparseable value unchanged rather than 'Invalid Date'", () => {
    expect(formatTashkent("not-a-date")).toBe("not-a-date");
  });
});
