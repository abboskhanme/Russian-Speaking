/**
 * ModuleEditorScreen — C4, and the task editor opened from it.
 *
 * WHAT THESE PIN. Every behaviour below failed SILENTLY before the fix round,
 * because each one still rendered an ordinary-looking screen:
 *
 *   • **Reach.** A published module whose tasks were all drafts said "O'quvchilaringiz
 *     bu modulni ko'rmoqda" while students saw an empty module. The status line
 *     may claim reach only when a published task is actually in it.
 *   • **Per-task state.** Each row must SAY Faol/Qoralama in words and carry its
 *     own switch — the only way a teacher can see why a task is invisible.
 *   • **Editing.** A row tap used to do nothing (`onOpenTask={() => undefined}`).
 *     It now opens the editor, and a save sends ONLY what changed.
 *   • **Delete.** Soft, confirmed inside the sheet, and it says that students'
 *     answers are kept. Nothing is deleted by the first tap.
 *   • **Level.** CEFR chips, and a legacy free-text level ("A1–A2") stays visible
 *     and selected rather than being silently rewritten.
 *
 * Assertions read copy through the real uz i18n instance, so rewording a string
 * does not break a test while a MISSING key would (t() would return the key).
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "../../shared/i18n";
import { ModuleEditorScreen } from "./ModuleEditorScreen";
import type { EditorTask, ModuleEditorProps } from "./ModuleEditorScreen";

const t = i18n.getFixedT("uz", "common");

function task(over: Partial<EditorTask> = {}): EditorTask {
  return {
    id: "t-1",
    title: "Do'konda xarid",
    prompt: "Расскажите, что вы купили.",
    level: "A2",
    published: false,
    submissionCount: 0,
    prepTimeSec: 30,
    answerTimeLimitSec: 120,
    ...over,
  };
}

function renderEditor(props: Partial<ModuleEditorProps> = {}) {
  render(
    <ModuleEditorScreen
      name="Kundalik muloqot"
      level="A2"
      published={true}
      tasks={[task()]}
      library={[]}
      {...props}
    />,
  );
  return userEvent.setup();
}

describe("what students actually see", () => {
  it("does not claim reach for a published module whose tasks are all drafts", () => {
    renderEditor({ published: true, tasks: [task({ published: false })] });
    expect(screen.queryByText(t("teacher.publishedHint"))).toBeNull();
    expect(screen.getByText(t("teacher.module.liveNoPublished"))).toBeInTheDocument();
  });

  it("claims reach only once a published task is inside a published module", () => {
    renderEditor({ published: true, tasks: [task({ published: true })] });
    expect(screen.getByText(t("teacher.publishedHint"))).toBeInTheDocument();
  });

  it("says an empty live module shows students nothing", () => {
    renderEditor({ published: true, tasks: [] });
    expect(screen.getByText(t("teacher.module.liveEmpty"))).toBeInTheDocument();
  });
});

describe("a task row", () => {
  it("states Qoralama in words and publishes with its own switch", async () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    const user = renderEditor({ onToggleTaskPublished: onToggle });

    const row = screen.getByRole("button", { name: /Do'konda xarid/ }).closest("li") as HTMLElement;
    expect(within(row).getByText(t("teacher.statusDraft"))).toBeInTheDocument();

    const sw = within(row).getByRole("switch", {
      name: t("teacher.task.publishAria", { task: "Do'konda xarid" }),
    });
    expect(sw).not.toBeChecked();
    await user.click(sw);
    expect(onToggle).toHaveBeenCalledWith("t-1", true);
  });
});

describe("the task editor", () => {
  it("opens from the row, and a save sends only the field that changed", async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const user = renderEditor({ onUpdateTask: onUpdate });

    await user.click(screen.getByRole("button", { name: /Do'konda xarid/ }));
    const dialog = screen.getByRole("dialog", { name: t("teacher.task.editTitle") });

    const title = within(dialog).getByLabelText(t("teacher.taskTitle")) as HTMLInputElement;
    expect(title.value).toBe("Do'konda xarid");
    await user.clear(title);
    await user.type(title, "Bozorda xarid");
    await user.click(within(dialog).getByRole("button", { name: t("teacher.saveReview") }));

    expect(onUpdate).toHaveBeenCalledWith("t-1", { title: "Bozorda xarid" });
  });

  it("offers time limits as chips, and a chip change is a real edit", async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const user = renderEditor({ onUpdateTask: onUpdate });
    await user.click(screen.getByRole("button", { name: /Do'konda xarid/ }));
    const dialog = screen.getByRole("dialog");

    // 120 s is the stored limit and reads as "2 daq", pressed.
    expect(within(dialog).getByRole("button", { name: t("teacher.task.min", { count: 2 }) })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(within(dialog).getByRole("button", { name: t("teacher.task.min", { count: 3 }) }));
    await user.click(within(dialog).getByRole("button", { name: t("teacher.saveReview") }));
    expect(onUpdate).toHaveBeenCalledWith("t-1", { answerTimeLimitSec: 180 });
  });

  it("deletes nothing until the in-sheet confirm, and says answers are kept", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const user = renderEditor({ onDeleteTask: onDelete });
    await user.click(screen.getByRole("button", { name: /Do'konda xarid/ }));
    const dialog = screen.getByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: t("teacher.task.delete") }));
    expect(onDelete).not.toHaveBeenCalled();

    const confirm = within(dialog).getByRole("alertdialog");
    expect(within(confirm).getByText(t("teacher.task.deleteKeeps"))).toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: t("teacher.task.deleteCta") }));
    expect(onDelete).toHaveBeenCalledWith("t-1");
  });
});

describe("module delete", () => {
  it("explains a 409 as a refusal with an alternative, not as 'try again'", async () => {
    const onDeleteModule = vi.fn().mockResolvedValue({ ok: false, reason: "conflict" });
    const user = renderEditor({ onDeleteModule });

    await user.click(screen.getByRole("button", { name: t("teacher.module.delete") }));
    const dialog = screen.getByRole("dialog", { name: t("teacher.module.deleteTitle") });
    expect(onDeleteModule).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: t("teacher.task.deleteCta") }));
    expect(onDeleteModule).toHaveBeenCalledTimes(1);
    expect(await within(dialog).findByText(t("teacher.module.deleteConflict"))).toBeInTheDocument();
  });
});

describe("level", () => {
  it("offers CEFR chips and keeps a legacy free-text level visible and selected", () => {
    renderEditor({ level: "A1–A2" });
    const legacy = screen.getByRole("button", { name: "A1–A2" });
    expect(legacy).toHaveAttribute("aria-pressed", "true");
    for (const l of ["A1", "A2", "B1", "B2", "C1"]) {
      expect(screen.getAllByRole("button", { name: l }).length).toBeGreaterThan(0);
    }
    // No free-text level field any more.
    expect(screen.queryByPlaceholderText("A1–A2")).toBeNull();
  });
});
