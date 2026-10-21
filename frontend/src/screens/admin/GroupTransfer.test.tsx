/**
 * Guruhni o'tkazish — the admin hands a teacher's group to another teacher.
 *
 * WHY THESE ARE TESTED. The transfer is the way out of two dead ends (a teacher who
 * left, and the `teacher_owns_groups` refusal on demotion), so every branch has to
 * end somewhere the admin can act on:
 *
 *   • the teacher's sheet lists their groups and each one opens the dialog;
 *   • the dialog never offers the CURRENT owner as the destination (the server would
 *     answer `same_teacher`), sends exactly (group, chosen teacher), and says so;
 *   • a refusal keeps the dialog open with a sentence keyed on the machine `code`,
 *     never the English `detail`;
 *   • with nobody to hand the group to, the confirm cannot be pressed and the
 *     dialog says why.
 *
 * Assertions go through the real uz i18n instance, so a rewording does not break a
 * test, and a missing key would render as the key itself and fail loudly.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "../../shared/i18n";
import type { ApiError } from "../../shared/api";
import { AdminPeopleScreen } from "./AdminPeopleScreen";
import type { AdminPerson } from "./AdminPeopleScreen";
import type { AdminGroupTransferApi, AdminTransferTarget } from "./GroupTransfer";

const t = i18n.getFixedT("uz", "common");

function apiError(status: number, body: Record<string, unknown>): ApiError {
  const e = new Error("refused") as ApiError;
  e.name = "ApiError";
  e.status = status;
  e.detail = "Internal english detail that must never be shown";
  e.body = { detail: e.detail, ...body };
  return e;
}

const leaving: AdminPerson = {
  id: "t-old",
  fullName: "Aziz Karimov",
  contact: "+998901112233",
  active: true,
  ownedCount: 3,
};

const everyone: AdminTransferTarget[] = [
  { id: "t-old", fullName: "Aziz Karimov" },
  { id: "t-new", fullName: "Nodira Tosheva" },
];

function setup(over: Partial<AdminGroupTransferApi> = {}) {
  const api: AdminGroupTransferApi = {
    loadGroups: vi.fn(() => Promise.resolve([{ id: "g-1", name: "7-A sinf", memberCount: 12 }])),
    loadTargets: vi.fn(() => Promise.resolve(everyone)),
    transfer: vi.fn(() => Promise.resolve()),
    ...over,
  };
  render(<AdminPeopleScreen kind="teachers" people={[leaving]} groupTransfer={api} />);
  return { api, user: userEvent.setup() };
}

const dialog = () => within(screen.getByRole("dialog"));

async function openTransfer(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: t("admin.manage") }));
  await user.click(
    await dialog().findByRole("button", { name: t("admin.groups.transferAria", { group: "7-A sinf" }) }),
  );
  // The manage sheet closed and the transfer dialog took its place.
  await dialog().findByText(t("admin.groups.dialogTitle"));
}

describe("Guruhni o'tkazish", () => {
  it("lists the teacher's groups, hands one over to the chosen teacher and says so", async () => {
    const { api, user } = setup();

    await user.click(screen.getByRole("button", { name: t("admin.manage") }));
    const sheet = dialog();
    expect(await sheet.findByText("7-A sinf")).toBeInTheDocument();
    expect(sheet.getByText(t("admin.groups.members", { count: 12 }))).toBeInTheDocument();
    expect(api.loadGroups).toHaveBeenCalledWith("t-old");

    await user.click(sheet.getByRole("button", { name: t("admin.groups.transferAria", { group: "7-A sinf" }) }));
    const d = dialog();
    // What moves and what stays is stated BEFORE the click.
    expect(d.getByText(t("admin.groups.moves"))).toBeInTheDocument();
    expect(d.getByText(t("admin.groups.stays"))).toBeInTheDocument();

    const select = await d.findByLabelText(t("admin.groups.targetLabel"));
    // The current owner is not a destination.
    const options = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(options).not.toContain("Aziz Karimov");
    expect(options).toContain("Nodira Tosheva");

    const confirm = d.getByRole("button", { name: t("admin.groups.confirm") });
    expect(confirm).toBeDisabled();                    // nothing chosen yet
    await user.selectOptions(select, "t-new");
    await user.click(confirm);

    expect(api.transfer).toHaveBeenCalledWith("g-1", "t-new");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent(
      t("admin.groups.done", { group: "7-A sinf", name: "Nodira Tosheva" }),
    );
  });

  it("keeps the dialog open on a refusal and explains it by code, never by detail", async () => {
    const { user } = setup({
      transfer: vi.fn(() => Promise.reject(apiError(400, { code: "invalid_target_teacher" }))),
    });
    await openTransfer(user);

    const d = dialog();
    await user.selectOptions(await d.findByLabelText(t("admin.groups.targetLabel")), "t-new");
    await user.click(d.getByRole("button", { name: t("admin.groups.confirm") }));

    expect(await d.findByRole("alert")).toHaveTextContent(t("admin.groups.errTarget"));
    expect(screen.queryByText(/Internal english detail/)).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("says a missing group is gone rather than 'save failed'", async () => {
    const { user } = setup({ transfer: vi.fn(() => Promise.reject(apiError(404, {}))) });
    await openTransfer(user);

    const d = dialog();
    await user.selectOptions(await d.findByLabelText(t("admin.groups.targetLabel")), "t-new");
    await user.click(d.getByRole("button", { name: t("admin.groups.confirm") }));

    expect(await d.findByRole("alert")).toHaveTextContent(t("admin.groups.errNotFound"));
  });

  it("with no other active teacher, explains why and cannot be confirmed", async () => {
    const { api, user } = setup({ loadTargets: vi.fn(() => Promise.resolve([everyone[0]])) });
    await openTransfer(user);

    const d = dialog();
    expect(await d.findByText(t("admin.groups.noTargets"))).toBeInTheDocument();
    expect(d.getByRole("button", { name: t("admin.groups.confirm") })).toBeDisabled();
    expect(api.transfer).not.toHaveBeenCalled();
  });

  it("a teacher with no groups says so instead of an empty list", async () => {
    const { user } = setup({ loadGroups: vi.fn(() => Promise.resolve([])) });
    await user.click(screen.getByRole("button", { name: t("admin.manage") }));
    expect(await dialog().findByText(t("admin.groups.none"))).toBeInTheDocument();
  });
});
