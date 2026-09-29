/**
 * ContentScreen — C1's "+ Yaratish".
 *
 * On the Vazifalar tab it used to create a "Yangi modul" DRAFT every time: a
 * teacher trying to add a task collected empty modules instead, and the task was
 * never made. The button must create what the active tab holds — and a task must
 * be able to go straight into a module the teacher picks (or none).
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "../../shared/i18n";
import { ContentScreen } from "./ContentScreen";
import { mockContentModules, mockContentTasks } from "./content.mock";

const t = i18n.getFixedT("uz", "common");

describe("+ Yaratish", () => {
  it("on Vazifalar opens the TASK sheet and creates no module", async () => {
    const onCreate = vi.fn();
    const onCreateTask = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <ContentScreen
        modules={mockContentModules}
        tasks={mockContentTasks}
        activeTab="tasks"
        onCreate={onCreate}
        onCreateTask={onCreateTask}
      />,
    );

    await user.click(screen.getByRole("button", { name: t("teacher.createTask") }));
    const dialog = screen.getByRole("dialog", { name: t("teacher.newTaskTitle") });
    expect(onCreate).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText(t("teacher.taskTitle")), "Yangi vazifa A");
    await user.type(within(dialog).getByLabelText(t("teacher.taskPrompt")), "Расскажите о себе.");
    // Put it straight into a module the teacher picks.
    await user.click(within(dialog).getByRole("button", { name: "Ishda rus tili" }));
    // Live module ⇒ the sheet says the task goes live at once.
    expect(
      within(dialog).getByText(t("teacher.task.reachLive", { module: "Ishda rus tili" })),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: t("teacher.task.create") }));

    expect(onCreateTask).toHaveBeenCalledTimes(1);
    expect(onCreateTask.mock.calls[0][0]).toMatchObject({
      title: "Yangi vazifa A",
      prompt: "Расскажите о себе.",
      moduleId: "m-2",
    });
  });

  it("on Modullar still creates a module", async () => {
    const onCreate = vi.fn();
    const user = userEvent.setup();
    render(
      <ContentScreen modules={mockContentModules} tasks={mockContentTasks} activeTab="modules" onCreate={onCreate} />,
    );
    await user.click(screen.getByRole("button", { name: t("teacher.create") }));
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a task with no module is sent as moduleId null, and the sheet says it starts as a draft", async () => {
    const onCreateTask = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <ContentScreen modules={mockContentModules} tasks={[]} activeTab="tasks" onCreateTask={onCreateTask} />,
    );
    await user.click(screen.getByRole("button", { name: t("teacher.createTask") }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(t("teacher.task.reachNone"))).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(t("teacher.taskTitle")), "X");
    await user.type(within(dialog).getByLabelText(t("teacher.taskPrompt")), "Y");
    await user.click(within(dialog).getByRole("button", { name: t("teacher.task.create") }));
    expect(onCreateTask.mock.calls[0][0]).toMatchObject({ moduleId: null });
  });
});

describe("a task row on Vazifalar", () => {
  it("opens the editor — an unattached task is editable too", async () => {
    const user = userEvent.setup();
    render(<ContentScreen modules={mockContentModules} tasks={mockContentTasks} activeTab="tasks" />);
    await user.click(screen.getByRole("button", { name: /Telefon suhbati/ }));
    const dialog = screen.getByRole("dialog", { name: t("teacher.task.editTitle") });
    expect((within(dialog).getByLabelText(t("teacher.taskTitle")) as HTMLInputElement).value).toBe(
      "Telefon suhbati",
    );
  });
});
