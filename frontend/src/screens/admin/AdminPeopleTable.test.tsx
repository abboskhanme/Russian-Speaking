/**
 * AdminPeopleScreen at ≥1080px — the data table, its sort and the filter chips.
 *
 * The table replaces the cards only on a wide screen; jsdom's default matchMedia
 * stub answers "narrow", so each test here opts into wide explicitly.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "../../shared/i18n";
import { AdminPeopleScreen, PEOPLE_PAGE_SIZE } from "./AdminPeopleScreen";
import type { AdminPerson } from "./AdminPeopleScreen";

const t = i18n.getFixedT("uz", "common");

function setWide(wide: boolean) {
  window.matchMedia = vi.fn((query: string) => ({
    matches: wide && query.includes("min-width: 1080px"),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

const original = window.matchMedia;
afterEach(() => {
  window.matchMedia = original;
});

const g1 = { id: "g1", name: "A1 ertalab", teacherName: "Aziz Karimov" };
const g2 = { id: "g2", name: "B1 kechki", teacherName: "Nodira Tosheva" };

const students: AdminPerson[] = [
  {
    id: "s1", fullName: "Anna", contact: "+998911002001", active: true, premium: true, ownedCount: 5,
    avgBand: 71.4, lastActiveAt: "2026-10-21T10:00:00Z", lastActiveLabel: "2 soat oldin", groups: [g1, g2],
  },
  {
    id: "s2", fullName: "Bobur", contact: "+998911002002", active: true, ownedCount: 12,
    avgBand: null, lastActiveAt: null, groups: [],
  },
  {
    id: "s3", fullName: "Dilnoza", contact: "+998911002003", active: false, ownedCount: 0,
    avgBand: 88, lastActiveAt: "2026-09-01T10:00:00Z", lastActiveLabel: "1 oy oldin", groups: [g2],
  },
];

const names = () =>
  within(screen.getAllByRole("rowgroup")[1])
    .getAllByRole("rowheader")
    // The name only — a Premium badge shares the cell.
    .map((c) => c.querySelector("span span")?.textContent ?? c.textContent);

describe("students table", () => {
  it("shows a semantic table with the useful columns on a wide screen", () => {
    setWide(true);
    render(<AdminPeopleScreen kind="students" people={students} />);

    const table = screen.getByRole("table", { name: t("admin.table.captionStudents") });
    for (const col of ["name", "phone", "groupTeacher", "answers", "avgScore", "lastActive", "status"]) {
      expect(within(table).getByRole("columnheader", { name: new RegExp(t(`admin.table.${col}`)) })).toBeInTheDocument();
    }
    const anna = within(table).getByRole("row", { name: /Anna/ });
    expect(within(anna).getByText("A1 ertalab")).toBeInTheDocument();
    expect(within(anna).getByText("71")).toBeInTheDocument();
    expect(within(anna).getByText("+998 91 100 20 01")).toBeInTheDocument();
    // Never active / never scored is said, not shown as 0.
    const bobur = within(table).getByRole("row", { name: /Bobur/ });
    expect(within(bobur).getByText(t("admin.table.never"))).toBeInTheDocument();
    expect(within(bobur).getByText(t("admin.table.noGroup"))).toBeInTheDocument();
  });

  it("keeps the cards on a narrow screen", () => {
    setWide(false);
    render(<AdminPeopleScreen kind="students" people={students} />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getAllByRole("button", { name: t("admin.manage") })).toHaveLength(3);
  });

  it("sorts the WHOLE list before cutting the page", async () => {
    setWide(true);
    const many: AdminPerson[] = Array.from({ length: PEOPLE_PAGE_SIZE + 5 }, (_, i) => ({
      id: `p${i}`, fullName: `Person ${String(i).padStart(2, "0")}`, contact: "+998900000000",
      active: true, ownedCount: i,
    }));
    render(<AdminPeopleScreen kind="students" people={many} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: t("admin.table.sortBy", { column: t("admin.table.answers") }) }));
    // The busiest person is on page one even though they came in last.
    expect(names()[0]).toBe(`Person ${PEOPLE_PAGE_SIZE + 4}`);
    expect(screen.getByRole("columnheader", { name: new RegExp(t("admin.table.answers")) })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
  });

  it("opens the manage sheet from the row action", async () => {
    setWide(true);
    render(<AdminPeopleScreen kind="students" people={students} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: t("admin.table.manageName", { name: "Bobur" }) }));
    expect(screen.getByRole("dialog", { name: "Bobur" })).toBeInTheDocument();
  });
});

describe("filter chips", () => {
  it("filters by status, premium, no group and group, and clears", async () => {
    setWide(true);
    render(<AdminPeopleScreen kind="students" people={students} />);
    const user = userEvent.setup();
    const chip = (key: string) => screen.getByRole("button", { name: t(`admin.table.${key}`) });

    await user.click(chip("filterSuspended"));
    expect(chip("filterSuspended")).toHaveAttribute("aria-pressed", "true");
    expect(names()).toEqual(["Dilnoza"]);

    await user.click(chip("filterSuspended"));
    await user.click(chip("filterPremium"));
    expect(names()).toEqual(["Anna"]);

    await user.click(chip("filterPremium"));
    await user.click(chip("filterNoGroup"));
    expect(names()).toEqual(["Bobur"]);

    await user.click(chip("filterNoGroup"));
    await user.selectOptions(screen.getByRole("combobox", { name: t("admin.table.groupFilter") }), "g2");
    expect(names()).toEqual(["Anna", "Dilnoza"]);

    await user.click(chip("filterActive"));
    expect(names()).toEqual(["Anna"]);
  });

  it("says when nothing matches and offers to clear", async () => {
    setWide(false);
    render(<AdminPeopleScreen kind="students" people={students.slice(1, 2)} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: t("admin.table.filterPremium") }));
    expect(screen.getByText(t("admin.table.noMatch"))).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: t("admin.table.clearFilters") }));
    expect(screen.getByText("Bobur")).toBeInTheDocument();
  });
});

describe("teachers table", () => {
  it("shows groups, students and tasks per teacher", () => {
    setWide(true);
    render(
      <AdminPeopleScreen
        kind="teachers"
        people={[
          { id: "t1", fullName: "Aziz Karimov", contact: "+998901112233", active: true, ownedCount: 7, groupCount: 2, studentCount: 31, createdLabel: "3 oy oldin" },
        ]}
      />,
    );
    const row = screen.getByRole("row", { name: /Aziz Karimov/ });
    expect(within(row).getByText("31")).toBeInTheDocument();
    expect(within(row).getByText("7")).toBeInTheDocument();
    expect(within(row).getByText("3 oy oldin")).toBeInTheDocument();
    // No premium for teachers.
    expect(screen.queryByRole("button", { name: t("admin.table.filterPremium") })).toBeNull();
  });
});
