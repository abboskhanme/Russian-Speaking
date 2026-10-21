import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataTable, sortRows } from "./DataTable";
import type { DataTableColumn } from "./DataTable";

interface Row {
  id: string;
  name: string;
  score: number | null;
}

const rows: Row[] = [
  { id: "a", name: "Bobur", score: 40 },
  { id: "b", name: "aziza", score: null },
  { id: "c", name: "Dilnoza", score: 90 },
];

const columns: DataTableColumn<Row>[] = [
  { key: "name", header: "Name", rowHeader: true, cell: (r) => r.name, sortValue: (r) => r.name },
  { key: "score", header: "Score", align: "end", cell: (r) => r.score ?? "—", sortValue: (r) => r.score, firstDir: "desc" },
  { key: "x", header: "Actions", hideHeader: true, cell: () => <button type="button">Go</button> },
];

const bodyNames = () =>
  within(screen.getAllByRole("rowgroup")[1])
    .getAllByRole("rowheader")
    .map((c) => c.textContent);

describe("DataTable", () => {
  it("is a real table: caption, column headers, a row header per row", () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} caption="People" />);
    expect(screen.getByRole("table", { name: "People" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader")).toHaveLength(3);
    expect(bodyNames()).toEqual(["Bobur", "aziza", "Dilnoza"]);
    // Unsortable columns carry no aria-sort; sortable ones start at "none".
    expect(screen.getByRole("columnheader", { name: "Actions" })).not.toHaveAttribute("aria-sort");
    expect(screen.getByRole("columnheader", { name: /Name/ })).toHaveAttribute("aria-sort", "none");
  });

  it("sorts from the keyboard, announces the direction, and keeps empties last", async () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} caption="People" />);
    const user = userEvent.setup();

    screen.getByRole("button", { name: /Score/ }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("columnheader", { name: /Score/ })).toHaveAttribute("aria-sort", "descending");
    expect(bodyNames()).toEqual(["Dilnoza", "Bobur", "aziza"]);

    await user.keyboard("{Enter}");
    expect(screen.getByRole("columnheader", { name: /Score/ })).toHaveAttribute("aria-sort", "ascending");
    // The unscored row sinks in BOTH directions — it is not a 0.
    expect(bodyNames()).toEqual(["Bobur", "Dilnoza", "aziza"]);

    await user.click(screen.getByRole("button", { name: /Name/ }));
    expect(bodyNames()).toEqual(["aziza", "Bobur", "Dilnoza"]); // case-insensitive
  });

  it("shows the empty slot across the table, and skeletons while loading", () => {
    const { rerender } = render(
      <DataTable columns={columns} rows={[]} rowKey={(r) => r.id} caption="People" empty="Nobody yet" />,
    );
    expect(screen.getByRole("cell", { name: "Nobody yet" })).toHaveAttribute("colspan", "3");

    rerender(<DataTable columns={columns} rows={[]} rowKey={(r) => r.id} caption="People" loading />);
    expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("Nobody yet")).toBeNull();
  });

  it("sortRows is stable for ties", () => {
    const tied = [
      { id: "1", v: 1 },
      { id: "2", v: 1 },
      { id: "3", v: 0 },
    ];
    expect(sortRows(tied, (r) => r.v, "desc").map((r) => r.id)).toEqual(["1", "2", "3"]);
  });
});
