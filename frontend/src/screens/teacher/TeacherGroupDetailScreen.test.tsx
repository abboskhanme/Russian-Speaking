/**
 * TeacherGroupDetailScreen — A5's writes: the "Faol topshiriqlar" row menu and
 * «Sozlama». A teacher could create a group and hand out work, and then could
 * change none of it. Every control below is destructive or group-wide, so the
 * tests pin the part that is invisible in review: nothing happens on the FIRST
 * tap, the server's refusal reads as a sentence, and the group delete stays
 * disarmed until the name is typed.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "../../shared/i18n";
import { TeacherGroupDetailScreen } from "./TeacherGroupDetailScreen";
import type { TeacherGroupDetailProps } from "./TeacherGroupDetailScreen";

const t = i18n.getFixedT("uz", "common");

const BASE: TeacherGroupDetailProps = {
  groupName: "Kechki-3",
  memberCount: 2,
  joinCode: "KECH3A",
  assignments: [
    {
      id: "q-1",
      title: "O'zingni tanishtir",
      due: "30-iyul 21:00",
      dueAt: "2099-07-30T16:00:00Z",
      completed: 1,
      total: 2,
    },
  ],
  roster: [
    { id: "s-1", fullName: "Aziz Karimov" },
    { id: "s-2", fullName: "Malika Yusupova" },
  ],
};

function renderScreen(props: Partial<TeacherGroupDetailProps> = {}) {
  render(<TeacherGroupDetailScreen {...BASE} {...props} />);
  return userEvent.setup();
}

async function openRowMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole("button", { name: t("teacher.assignmentActions.menuAria", { task: "O'zingni tanishtir" }) }),
  );
  return screen.getByRole("dialog", { name: "O'zingni tanishtir" });
}

describe("Faol topshiriqlar · row menu", () => {
  it("removes the deadline with 'Muddatsiz' (an explicit null)", async () => {
    const onChangeDue = vi.fn().mockResolvedValue({ ok: true, updated: 2 });
    const user = renderScreen({ onChangeDue });
    const sheet = await openRowMenu(user);

    await user.click(within(sheet).getByRole("button", { name: t("teacher.assignmentActions.noDue") }));
    await user.click(within(sheet).getByRole("button", { name: t("teacher.saveReview") }));
    expect(onChangeDue).toHaveBeenCalledWith("q-1", null);
  });

  it("turns the server's due_in_past into a sentence and keeps the sheet open", async () => {
    const onChangeDue = vi.fn().mockResolvedValue({ ok: false, reason: "due_in_past" });
    const user = renderScreen({ onChangeDue });
    const sheet = await openRowMenu(user);

    // The shared DateTimeField: dd.MM.yyyy + HH:mm, typed digit by digit.
    const due = within(sheet).getByRole("group", { name: t("teacher.assignTask.due") });
    const date = within(due).getByRole("textbox", { name: t("dateField.date") });
    const time = within(due).getByRole("textbox", { name: t("dateField.time") });
    await user.clear(date);
    await user.type(date, "01012020");
    await user.clear(time);
    await user.type(time, "1000");
    await user.click(within(sheet).getByRole("button", { name: t("teacher.saveReview") }));

    expect(onChangeDue).toHaveBeenCalledTimes(1);
    expect(await within(sheet).findByText(t("teacher.assignmentActions.dueInPast"))).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("cancels nothing until the confirm, then cancels THIS task for THIS group", async () => {
    const onCancel = vi.fn().mockResolvedValue(2);
    const user = renderScreen({ onCancelAssignment: onCancel });
    const sheet = await openRowMenu(user);

    await user.click(within(sheet).getByRole("button", { name: t("teacher.assignmentActions.cancel") }));
    expect(onCancel).not.toHaveBeenCalled();
    const confirm = within(sheet).getByRole("alertdialog");
    expect(within(confirm).getByText(t("teacher.assignmentActions.cancelKeeps"))).toBeInTheDocument();

    await user.click(within(confirm).getByRole("button", { name: t("teacher.assignmentActions.cancelCta") }));
    expect(onCancel).toHaveBeenCalledWith("q-1");
  });

  it("says so when nothing went through the group, instead of closing as if it worked", async () => {
    const onCancel = vi.fn().mockResolvedValue(0);
    const user = renderScreen({ onCancelAssignment: onCancel });
    const sheet = await openRowMenu(user);
    await user.click(within(sheet).getByRole("button", { name: t("teacher.assignmentActions.cancel") }));
    await user.click(
      within(within(sheet).getByRole("alertdialog")).getByRole("button", {
        name: t("teacher.assignmentActions.cancelCta"),
      }),
    );
    expect(await within(sheet).findByText(t("teacher.assignmentActions.nothingToCancel"))).toBeInTheDocument();
  });
});

describe("«Sozlama»", () => {
  const handlers = () => ({
    onRename: vi.fn().mockResolvedValue(undefined),
    onRegenerateCode: vi.fn().mockResolvedValue(undefined),
    onRemoveMember: vi.fn().mockResolvedValue(undefined),
    onDeleteGroup: vi.fn().mockResolvedValue(undefined),
  });

  async function openSettings(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: t("teacher.groupSettings.open") }));
    return screen.getByRole("dialog", { name: t("teacher.groupSettings.title") });
  }

  it("renames the group", async () => {
    const h = handlers();
    const user = renderScreen(h);
    const sheet = await openSettings(user);
    const name = within(sheet).getByLabelText(t("teacher.groupNameLabel"));
    await user.clear(name);
    await user.type(name, "Kechki-4");
    await user.click(within(sheet).getByRole("button", { name: t("teacher.groupSettings.rename") }));
    expect(h.onRename).toHaveBeenCalledWith("Kechki-4");
  });

  it("regenerates the join code only after warning that the old one dies", async () => {
    const h = handlers();
    const user = renderScreen(h);
    const sheet = await openSettings(user);
    await user.click(within(sheet).getByRole("button", { name: t("teacher.groupSettings.regenerate") }));
    expect(h.onRegenerateCode).not.toHaveBeenCalled();
    const confirm = within(sheet).getByRole("alertdialog");
    expect(within(confirm).getByText(t("teacher.groupSettings.regenerateWarn"))).toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: t("teacher.groupSettings.regenerateCta") }));
    expect(h.onRegenerateCode).toHaveBeenCalledTimes(1);
  });

  it("removes one student only after a confirm that names them", async () => {
    const h = handlers();
    const user = renderScreen(h);
    const sheet = await openSettings(user);
    await user.click(
      within(sheet).getByRole("button", { name: t("teacher.groupSettings.removeAria", { name: "Malika Yusupova" }) }),
    );
    expect(h.onRemoveMember).not.toHaveBeenCalled();
    const confirm = within(sheet).getByRole("alertdialog");
    expect(
      within(confirm).getByText(t("teacher.groupSettings.removeConfirm", { name: "Malika Yusupova" })),
    ).toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: t("teacher.groupSettings.remove") }));
    expect(h.onRemoveMember).toHaveBeenCalledWith("s-2");
  });

  it("keeps group delete disarmed until the group's name is typed", async () => {
    const h = handlers();
    const user = renderScreen(h);
    const sheet = await openSettings(user);
    await user.click(within(sheet).getByRole("button", { name: t("teacher.groupSettings.delete") }));

    const confirm = within(sheet).getByRole("alertdialog");
    const cta = within(confirm).getByRole("button", { name: t("teacher.groupSettings.deleteCta") });
    expect(cta).toBeDisabled();

    const typed = within(confirm).getByLabelText(t("teacher.groupSettings.deleteTypeName", { name: "Kechki-3" }));
    await user.type(typed, "Kechki");
    expect(cta).toBeDisabled();
    await user.type(typed, "-3");
    expect(cta).toBeEnabled();
    await user.click(cta);
    expect(h.onDeleteGroup).toHaveBeenCalledTimes(1);
  });

  it("offers no group level: groups have no level column", async () => {
    const user = renderScreen(handlers());
    const sheet = await openSettings(user);
    expect(within(sheet).queryByRole("button", { name: "B1" })).toBeNull();
  });
});

describe("Guruh xatolari", () => {
  it("renders the group's error rows under their own heading", () => {
    renderScreen({
      groupErrors: [{ type: "word_order", label: "So'z tartibi", count: 7, studentCount: 3, share: 0.4 }],
    });
    expect(screen.getByRole("region", { name: t("teacher.groupErrors") })).toBeInTheDocument();
    expect(screen.getByText("So'z tartibi")).toBeInTheDocument();
  });

  it("is absent when the insights read failed (null), rather than an empty card", () => {
    renderScreen({ groupErrors: null });
    expect(screen.queryByRole("region", { name: t("teacher.groupErrors") })).toBeNull();
  });
});
