/**
 * AdminPeopleScreen — the day-one account flows.
 *
 * WHY THESE ARE TESTED. On a fresh install nothing but this screen can make a teacher:
 * sign-up makes students, and there is no seed. So every branch of "O'qituvchi
 * qo'shish" has to END somewhere useful, and each refusal the server can give has to
 * turn into a sentence the admin can act on:
 *
 *   • a student already holds the number → the sheet offers to PROMOTE that student
 *     (naming them), instead of a dead-end "taken";
 *   • a teacher/admin holds it, or it is malformed → an inline line on the field;
 *   • a role change refused because the teacher still owns groups → the COUNT is in the
 *     sentence; refused because it is the last admin → that, not "save failed".
 *
 * Every refusal here is keyed on the machine `code`, never the English `detail` — the
 * fixtures give `detail` a sentence that must never appear on screen.
 *
 * Assertions go through the real uz i18n instance, so a rewording does not break a
 * test, and a missing key would render as the key itself and fail loudly.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "../../shared/i18n";
import type { ApiError } from "../../shared/api";
import { AdminPeopleScreen, PEOPLE_PAGE_SIZE } from "./AdminPeopleScreen";
import type { AdminPeopleProps, AdminPerson } from "./AdminPeopleScreen";

const t = i18n.getFixedT("uz", "common");

/** A refusal shaped exactly like the API client throws it. */
function apiError(status: number, body: Record<string, unknown>): ApiError {
  const e = new Error("refused") as ApiError;
  e.name = "ApiError";
  e.status = status;
  e.detail = "Internal english detail that must never be shown";
  e.body = { detail: e.detail, ...body };
  return e;
}

const teacher = (over: Partial<AdminPerson> = {}): AdminPerson => ({
  id: "t-1",
  fullName: "Aziz Karimov",
  contact: "+998901112233",
  meta: "3 ta vazifa",
  active: true,
  ownedCount: 3,
  ...over,
});

function setup(props: Partial<AdminPeopleProps> = {}) {
  render(<AdminPeopleScreen kind="teachers" people={[teacher()]} {...props} />);
  return userEvent.setup();
}

const dialog = () => within(screen.getByRole("dialog"));

async function openAddSheet(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: t("admin.addTeacher") }));
  return dialog();
}

async function fillAndSubmit(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  phone: string,
) {
  const sheet = dialog();
  await user.type(sheet.getByLabelText(t("admin.fullName")), name);
  await user.type(sheet.getByLabelText(t("admin.phone")), phone);
  await user.click(sheet.getByRole("button", { name: t("admin.addTeacherSubmit") }));
}

describe("O'qituvchi qo'shish", () => {
  it("creates the teacher with the login screen's E.164 number and says so", async () => {
    const onCreateTeacher = vi.fn(() => Promise.resolve());
    const user = setup({ onCreateTeacher });

    const sheet = await openAddSheet(user);
    // The one-line explanation of how this person will get in.
    expect(sheet.getByText(t("admin.addTeacherHint"))).toBeInTheDocument();
    await fillAndSubmit(user, "Nodira Tosheva", "90 123 45 67");

    expect(onCreateTeacher).toHaveBeenCalledWith({ phone: "+998901234567", fullName: "Nodira Tosheva" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent(
      t("admin.teacherAdded", { name: "Nodira Tosheva" }),
    );
  });

  it("refuses an incomplete number before asking the server", async () => {
    const onCreateTeacher = vi.fn(() => Promise.resolve());
    const user = setup({ onCreateTeacher });

    await openAddSheet(user);
    await fillAndSubmit(user, "Nodira Tosheva", "90 123");

    expect(onCreateTeacher).not.toHaveBeenCalled();
    expect(dialog().getByText(t("admin.errInvalidPhone"))).toBeInTheDocument();
  });

  it("turns a student's number into the promotion offer, naming the student", async () => {
    const onCreateTeacher = vi.fn(() =>
      Promise.reject(
        apiError(409, { code: "phone_taken_by_student", user_id: "s-42", full_name: "Анна Иванова" }),
      ),
    );
    const onPromoteStudent = vi.fn(() => Promise.resolve());
    const user = setup({ onCreateTeacher, onPromoteStudent });

    await openAddSheet(user);
    await fillAndSubmit(user, "Anna", "90 123 45 67");

    const sheet = dialog();
    expect(
      await sheet.findByText(t("admin.promoteQuestion", { name: "Анна Иванова" })),
    ).toBeInTheDocument();
    // What the promotion does is stated before it is confirmed.
    expect(sheet.getByText(t("admin.role.consequence.studentToTeacher"))).toBeInTheDocument();

    await user.click(sheet.getByRole("button", { name: t("admin.role.toTeacher") }));
    expect(onPromoteStudent).toHaveBeenCalledWith("s-42");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent(
      t("admin.teacherAdded", { name: "Анна Иванова" }),
    );
  });

  it.each([
    ["phone_taken", 409, "admin.errPhoneTaken"],
    ["invalid_phone", 400, "admin.errInvalidPhone"],
  ])("reports %s inline on the field and keeps the typed values", async (code, status, key) => {
    const onCreateTeacher = vi.fn(() => Promise.reject(apiError(status, { code })));
    const user = setup({ onCreateTeacher });

    await openAddSheet(user);
    await fillAndSubmit(user, "Nodira Tosheva", "90 123 45 67");

    const sheet = dialog();
    expect(await sheet.findByText(t(key))).toBeInTheDocument();
    expect(sheet.getByLabelText(t("admin.fullName"))).toHaveValue("Nodira Tosheva");
    expect(screen.queryByText(/Internal english detail/)).not.toBeInTheDocument();
  });

  it("puts invalid_full_name on the name field", async () => {
    const onCreateTeacher = vi.fn(() => Promise.reject(apiError(400, { code: "invalid_full_name" })));
    const user = setup({ onCreateTeacher });

    await openAddSheet(user);
    await fillAndSubmit(user, "X", "90 123 45 67");

    expect(await dialog().findByText(t("admin.errInvalidName"))).toBeInTheDocument();
    expect(dialog().queryByText(t("admin.errInvalidPhone"))).not.toBeInTheDocument();
  });

  it("offers the add button inside the empty state of a fresh install", async () => {
    const onCreateTeacher = vi.fn(() => Promise.resolve());
    render(<AdminPeopleScreen kind="teachers" people={[]} onCreateTeacher={onCreateTeacher} />);

    expect(screen.getByText(t("admin.noTeachersYet"))).toBeInTheDocument();
    // Header button + the empty state's own.
    expect(screen.getAllByRole("button", { name: t("admin.addTeacher") })).toHaveLength(2);
  });
});

describe("Rolni o'zgartirish", () => {
  async function openRole(
    user: ReturnType<typeof userEvent.setup>,
    button: string,
  ) {
    await user.click(screen.getByRole("button", { name: t("admin.manage") }));
    await user.click(dialog().getByRole("button", { name: button }));
    return dialog();
  }

  it("promotes a student only after a confirm that states the consequence", async () => {
    const onChangeRole = vi.fn(() => Promise.resolve());
    render(
      <AdminPeopleScreen
        kind="students"
        people={[teacher({ id: "s-1", fullName: "Анна Иванова" })]}
        onChangeRole={onChangeRole}
      />,
    );
    const user = userEvent.setup();

    const confirm = await openRole(user, t("admin.role.toTeacher"));
    expect(confirm.getByText(t("admin.role.consequence.studentToTeacher"))).toBeInTheDocument();
    expect(onChangeRole).not.toHaveBeenCalled();

    await user.click(confirm.getByRole("button", { name: t("admin.role.confirm") }));
    expect(onChangeRole).toHaveBeenCalledWith("s-1", "teacher");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent(
      t("admin.role.done", { name: "Анна Иванова", role: t("admin.role.names.teacher") }),
    );
  });

  it("offers a teacher both directions: student and admin", async () => {
    const user = setup({ onChangeRole: vi.fn(() => Promise.resolve()) });
    await user.click(screen.getByRole("button", { name: t("admin.manage") }));

    expect(dialog().getByRole("button", { name: t("admin.role.toStudent") })).toBeInTheDocument();
    expect(dialog().getByRole("button", { name: t("admin.role.toAdmin") })).toBeInTheDocument();
  });

  it("says how many groups stand in the way, and stays open", async () => {
    const onChangeRole = vi.fn(() =>
      Promise.reject(apiError(409, { code: "teacher_owns_groups", group_count: 3 })),
    );
    const user = setup({ onChangeRole });

    const confirm = await openRole(user, t("admin.role.toStudent"));
    await user.click(confirm.getByRole("button", { name: t("admin.role.confirm") }));

    expect(await dialog().findByRole("alert")).toHaveTextContent(
      t("admin.role.errOwnsGroups", { count: 3 }),
    );
    expect(dialog().getByRole("alert")).toHaveTextContent("3");
  });

  it.each([
    ["last_admin", 409, "admin.role.errLastAdmin"],
    ["cannot_change_own_role", 400, "admin.role.errOwnRole"],
  ])("maps %s to its own sentence", async (code, status, key) => {
    const onChangeRole = vi.fn(() => Promise.reject(apiError(status, { code })));
    const user = setup({ onChangeRole });

    const confirm = await openRole(user, t("admin.role.toAdmin"));
    await user.click(confirm.getByRole("button", { name: t("admin.role.confirm") }));

    expect(await dialog().findByRole("alert")).toHaveTextContent(t(key));
  });
});

describe("Adminlar", () => {
  const admins = [
    { id: "a-1", fullName: "Admin Demo", phone: "+998901112235", isSelf: true },
    { id: "a-2", fullName: "Boshqa Admin", phone: null, isSelf: false },
  ];

  it("marks the caller's own row and offers it no role change", () => {
    setup({
      onChangeRole: vi.fn(() => Promise.resolve()),
      staff: { tab: "admins", onTabChange: vi.fn(), admins },
    });

    const own = screen.getByText("Admin Demo").closest("li") as HTMLElement;
    expect(within(own).getByText(t("admin.you"))).toBeInTheDocument();
    expect(within(own).queryByRole("button", { name: t("admin.role.demote") })).not.toBeInTheDocument();
    // The phone is grouped the way the login screen shows it.
    expect(within(own).getByText("+998 90 111 22 35")).toBeInTheDocument();

    const other = screen.getByText("Boshqa Admin").closest("li") as HTMLElement;
    expect(within(other).getByRole("button", { name: t("admin.role.demote") })).toBeInTheDocument();
  });

  it("demotes to teacher through the confirm, and reports the last-admin refusal", async () => {
    const onChangeRole = vi.fn(() => Promise.reject(apiError(409, { code: "last_admin" })));
    const user = setup({ onChangeRole, staff: { tab: "admins", onTabChange: vi.fn(), admins } });

    await user.click(screen.getByRole("button", { name: t("admin.role.demote") }));
    expect(dialog().getByText(t("admin.role.consequence.adminToTeacher"))).toBeInTheDocument();
    await user.click(dialog().getByRole("button", { name: t("admin.role.confirm") }));

    expect(onChangeRole).toHaveBeenCalledWith("a-2", "teacher");
    expect(await dialog().findByRole("alert")).toHaveTextContent(t("admin.role.errLastAdmin"));
  });
});

describe("rows", () => {
  it("shows the phone, never the placeholder email", () => {
    setup({ people: [teacher({ contact: "+998901112233" })] });
    expect(screen.getByText(/\+998 90 111 22 33/)).toBeInTheDocument();
    expect(screen.queryByText(/@govori\.uz/)).not.toBeInTheDocument();
  });

  it("renders the first page and reveals the rest on request", async () => {
    const many = Array.from({ length: PEOPLE_PAGE_SIZE + 20 }, (_, i) =>
      teacher({ id: `t-${i}`, fullName: `O'qituvchi ${i}` }),
    );
    const user = setup({ people: many });

    expect(screen.getAllByRole("button", { name: t("admin.manage") })).toHaveLength(PEOPLE_PAGE_SIZE);
    await user.click(screen.getByRole("button", { name: t("admin.showMore") }));
    expect(screen.getAllByRole("button", { name: t("admin.manage") })).toHaveLength(many.length);
    expect(screen.queryByRole("button", { name: t("admin.showMore") })).not.toBeInTheDocument();
  });
});
