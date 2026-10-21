import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "../../shared/i18n";
import { AdminModulesTable } from "./AdminModulesTable";
import type { AdminModuleRow } from "./AdminModulesTable";

const t = i18n.getFixedT("uz", "common");

const row = (over: Partial<AdminModuleRow>): AdminModuleRow => ({
  id: "m",
  name: "Modul",
  level: "A1",
  visibility: "group",
  is_published: true,
  task_count: 2,
  student_count: 12,
  updated_at: "2026-10-01T10:00:00Z",
  owner_name: "Aziz Karimov",
  ...over,
});

describe("AdminModulesTable", () => {
  it("marks every copy of a repeated name, keeps them all, and groups them by name", () => {
    render(
      <AdminModulesTable
        rows={[
          row({ id: "1", name: "Обычный русский · Быт", owner_name: "Бекзод Алиев" }),
          row({ id: "2", name: "Ochiq mashqlar", visibility: "public" }),
          row({ id: "3", name: "обычный русский · быт ", owner_name: "Малика Тошева" }),
        ]}
        onOpen={() => {}}
        formatDate={() => "1-oktabr"}
      />,
    );
    expect(screen.getAllByText(t("admin.modulesTable.duplicate", { count: 2 }))).toHaveLength(2);
    expect(screen.getByText(t("admin.modulesTable.duplicatesSummary", { count: 1 }))).toBeInTheDocument();
    const order = within(screen.getAllByRole("rowgroup")[1])
      .getAllByRole("row")
      .map((r) => within(r).getByText(/Karimov|Алиев|Тошева/).textContent);
    expect(order).toEqual(["Aziz Karimov", "Бекзод Алиев", "Малика Тошева"]);
  });

  it("says — for a draft's reach and opens a module by its name", async () => {
    const onOpen = vi.fn();
    render(
      <AdminModulesTable
        rows={[row({ id: "d", name: "Yangi modul", is_published: false })]}
        onOpen={onOpen}
        formatDate={() => "1-oktabr"}
      />,
    );
    expect(screen.getByText(t("teacher.statusDraft"))).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: t("admin.modulesTable.openName", { name: "Yangi modul" }) }));
    expect(onOpen).toHaveBeenCalledWith("d");
  });
});
