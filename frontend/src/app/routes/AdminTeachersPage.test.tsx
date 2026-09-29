/**
 * AdminTeachersPage — the seam between "the server made a teacher" and "the admin can
 * see them".
 *
 * WHY A PAGE TEST. The screen test proves the sheet sends the right request; what it
 * cannot see is the page. Two things can go wrong there and both look like "the add
 * did not work" to the person pressing the button:
 *
 *   • the new row only appears after a manual reload (the page must take the row the
 *     POST answered with, not wait for a list refetch);
 *   • on a fresh install the list is EMPTY, and a page that shows its spinner whenever
 *     a request is in flight and the list is empty swaps the whole screen out from
 *     under the open sheet.
 *
 * Plus the order: the API lists oldest first, and only 50 rows render, so the page
 * must flip it or the newest teacher is the one nobody sees.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import i18n from "../../shared/i18n";
import type { AdminCreateTeacherArgs, AdminTeacherResponse } from "../../shared/api";
import AdminTeachersPage from "./AdminTeachersPage";
import { newestFirst } from "./adminPeople";

const t = i18n.getFixedT("uz", "common");

const row = (over: Partial<AdminTeacherResponse>): AdminTeacherResponse => ({
  id: "t-x",
  email: "998900000000@govori.uz",
  full_name: "X",
  phone: "+998900000000",
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  question_count: 0,
  ...over,
});

let listed: AdminTeacherResponse[] = [];
const listCalls = vi.fn();
const created = vi.fn();

vi.mock("../../shared/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared/api")>();
  return {
    ...actual,
    endpoints: {
      ...actual.endpoints,
      adminTeachers: (search?: string) => {
        listCalls(search);
        return Promise.resolve(listed);
      },
      adminCreateTeacher: (args: AdminCreateTeacherArgs) => {
        created(args);
        return Promise.resolve(
          row({
            id: "t-new",
            full_name: args.full_name,
            phone: args.phone,
            created_at: "2026-09-29T10:00:00Z",
          }),
        );
      },
    },
  };
});

beforeEach(() => {
  listed = [];
  listCalls.mockClear();
  created.mockClear();
});

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/admin/teachers"]}>
      <AdminTeachersPage />
    </MemoryRouter>,
  );
  return userEvent.setup();
}

describe("adding the first teacher on a fresh install", () => {
  it("shows the new row at once, without a reload", async () => {
    const user = renderPage();
    expect(await screen.findByText(t("admin.noTeachersYet"))).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: t("admin.addTeacher") })[0]);
    const sheet = within(screen.getByRole("dialog"));
    await user.type(sheet.getByLabelText(t("admin.fullName")), "Nodira Tosheva");
    await user.type(sheet.getByLabelText(t("admin.phone")), "901234567");
    await user.click(sheet.getByRole("button", { name: t("admin.addTeacherSubmit") }));

    expect(created).toHaveBeenCalledWith({ phone: "+998901234567", full_name: "Nodira Tosheva" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("Nodira Tosheva")).toBeInTheDocument();
    expect(screen.getByText(/\+998 90 123 45 67/)).toBeInTheDocument();
    // The list was read once, on arrival — the row came from the POST's answer.
    expect(listCalls).toHaveBeenCalledTimes(1);
  });
});

describe("order", () => {
  it("lists the newest teacher first although the API answers oldest first", async () => {
    listed = [
      row({ id: "t-old", full_name: "Eski O'qituvchi", created_at: "2025-01-01T00:00:00Z" }),
      row({ id: "t-new", full_name: "Yangi O'qituvchi", created_at: "2026-09-01T00:00:00Z" }),
    ];
    renderPage();

    const list = (await screen.findByText("Yangi O'qituvchi")).closest("ul") as HTMLElement;
    const names = within(list)
      .getAllByRole("listitem")
      .map((li) => li.textContent ?? "");
    expect(names[0]).toContain("Yangi O'qituvchi");
    expect(names[1]).toContain("Eski O'qituvchi");
  });

  it("keeps equal timestamps in their original order and sinks unparsable ones", () => {
    const rows = [
      { id: "a", created_at: "2026-01-01T00:00:00Z" },
      { id: "b", created_at: "not a date" },
      { id: "c", created_at: "2026-01-01T00:00:00Z" },
      { id: "d", created_at: "2026-05-01T00:00:00Z" },
    ];
    expect(newestFirst(rows).map((r) => r.id)).toEqual(["d", "a", "c", "b"]);
  });
});
