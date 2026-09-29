/**
 * AssignTaskScreen — D3 «Topshiriq berish».
 *
 * Three failures the audit found, each invisible on a static screenshot:
 *
 *   • **The second tap assigned again.** The button stayed live after a success,
 *     so an impatient teacher handed the group the same task twice. It must go
 *     inert until something about the assignment changes.
 *   • **The result hid who already had it.** "2 ta topshiriq berildi" for a group
 *     of five reads as a failure; the truth — three already had it open — is what
 *     the teacher needs.
 *   • **A6's "Topshiriq berish" targeted nobody.** `?student=` was ignored and the
 *     group picker shown. With a student, "Kimga" names that student and the write
 *     carries `studentId`, never a group.
 *
 * Plus: a module with no published task is listed but DISABLED, with the reason in
 * words, instead of failing with the server's English sentence.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "../../shared/i18n";
import { AssignTaskScreen } from "./AssignTaskScreen";
import type { AssignTaskProps } from "./AssignTaskScreen";

const t = i18n.getFixedT("uz", "common");

const BASE: AssignTaskProps = {
  tasks: [{ id: "q-1", kind: "task", title: "Do'konda xarid", subtitle: "A2" }],
  modules: [
    { id: "m-1", kind: "module", title: "Kundalik", subtitle: "A2", taskCount: 3 },
    {
      id: "m-2",
      kind: "module",
      title: "Bo'sh modul",
      subtitle: "B1",
      taskCount: 0,
      disabledReason: "Bu modulda nashr qilingan vazifa yo'q",
    },
  ],
  groups: [{ id: "g-1", name: "Kechki-3", memberCount: 5 }],
  initialGroupId: "g-1",
};

async function pickTask(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(screen.getByRole("button", { name: new RegExp(t("teacher.assignTask.pickPrompt")) }));
  const picker = screen.getByRole("dialog", { name: t("teacher.assignTask.pickTitle") });
  await user.click(within(picker).getByRole("button", { name: new RegExp(title) }));
}

describe("one press, one write", () => {
  it("goes inert after a success and re-arms when the teacher changes something", async () => {
    const onAssign = vi.fn().mockResolvedValue({ created: 2, alreadyHad: 3 });
    const user = userEvent.setup();
    render(<AssignTaskScreen {...BASE} onAssign={onAssign} />);

    await pickTask(user, "Do'konda xarid");
    const submit = screen.getByRole("button", { name: t("teacher.assignTask.submit", { count: 5 }) });
    await user.click(submit);
    expect(onAssign).toHaveBeenCalledTimes(1);

    // The honest split, from the server's response.
    expect(
      await screen.findByText(t("teacher.assignTask.createdSplit", { count: 2, already: 3 })),
    ).toBeInTheDocument();

    const done = screen.getByRole("button", { name: t("teacher.assignTask.submitted") });
    expect(done).toBeDisabled();
    await user.click(done);
    expect(onAssign).toHaveBeenCalledTimes(1);

    // Changing the attempt budget is a different assignment — the button re-arms.
    await user.click(screen.getByRole("button", { name: t("teacher.assignTask.attemptsN", { count: 3 }) }));
    expect(screen.getByRole("button", { name: t("teacher.assignTask.submit", { count: 5 }) })).toBeEnabled();
  });

  it("stays live after a FAILED write so the teacher can retry", async () => {
    const onAssign = vi.fn().mockResolvedValue({ created: 0, error: t("teacher.assignTask.failed") });
    const user = userEvent.setup();
    render(<AssignTaskScreen {...BASE} onAssign={onAssign} />);
    await pickTask(user, "Do'konda xarid");
    await user.click(screen.getByRole("button", { name: t("teacher.assignTask.submit", { count: 5 }) }));
    expect(await screen.findByText(t("teacher.assignTask.failed"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("teacher.assignTask.submit", { count: 5 }) })).toBeEnabled();
  });
});

describe("one student (A6 → ?student=)", () => {
  it("names the student instead of offering groups, and sends studentId only", async () => {
    const onAssign = vi.fn().mockResolvedValue({ created: 1, alreadyHad: 0 });
    const user = userEvent.setup();
    render(
      <AssignTaskScreen {...BASE} initialGroupId={null} student={{ id: "s-9", name: "Dilfuza R." }} onAssign={onAssign} />,
    );

    expect(screen.getByText("Dilfuza R.")).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).toBeNull();

    await pickTask(user, "Do'konda xarid");
    await user.click(screen.getByRole("button", { name: t("teacher.assignTask.submit", { count: 1 }) }));
    expect(onAssign).toHaveBeenCalledWith(
      expect.objectContaining({ studentId: "s-9", groupId: null }),
    );
    expect(
      await screen.findByText(t("teacher.assignTask.createdStudents", { count: 1 })),
    ).toBeInTheDocument();
  });

  it("says so when the student is not on the teacher's roster", () => {
    render(<AssignTaskScreen {...BASE} studentMissing />);
    expect(screen.getByText(t("teacher.assignTask.studentMissing"))).toBeInTheDocument();
  });
});

describe("a module with nothing to send", () => {
  it("is listed disabled with its reason, and cannot be picked", async () => {
    const user = userEvent.setup();
    render(<AssignTaskScreen {...BASE} />);
    await user.click(screen.getByRole("button", { name: new RegExp(t("teacher.assignTask.pickPrompt")) }));
    const picker = screen.getByRole("dialog");
    const empty = within(picker).getByRole("button", { name: /Bo'sh modul/ });
    expect(empty).toBeDisabled();
    expect(within(empty).getByText("Bu modulda nashr qilingan vazifa yo'q")).toBeInTheDocument();
  });
});
