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

/*
 * The official catalog ("Rasmiy katalog"). Most classes work through it, so a
 * teacher must be able to set homework from content they did not author — and a
 * teacher who has authored NOTHING must not be told "no content" while the
 * official catalog is right there.
 */
describe("the official catalog", () => {
  const OFFICIAL: NonNullable<AssignTaskProps["official"]> = [
    {
      module: { id: "om-1", kind: "module", title: "Rasmiy: Kundalik hayot", subtitle: "A2", taskCount: 2 },
      tasks: [
        { id: "oq-1", kind: "task", title: "Nonvoyxonada", subtitle: "A2" },
        { id: "oq-2", kind: "task", title: "Metroda", subtitle: "A2" },
      ],
    },
  ];

  async function openPicker(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: new RegExp(t("teacher.assignTask.pickPrompt")) }));
    return screen.getByRole("dialog", { name: t("teacher.assignTask.pickTitle") });
  }

  it("is its own labelled section beside the teacher's own content, module and tasks alike", async () => {
    const user = userEvent.setup();
    render(<AssignTaskScreen {...BASE} official={OFFICIAL} />);
    const picker = await openPicker(user);

    // Own content is still offered as before…
    expect(within(picker).getByRole("button", { name: /Do'konda xarid/ })).toBeInTheDocument();
    // …and the official catalog sits in its own, named section.
    const section = within(picker).getByRole("region", { name: t("teacher.assignTask.officialSection") });
    expect(within(section).getByText(t("teacher.assignTask.officialSection"))).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: /Rasmiy: Kundalik hayot/ })).toBeEnabled();
    expect(within(section).getByRole("button", { name: /Nonvoyxonada/ })).toBeEnabled();
    expect(within(section).getByRole("button", { name: /Metroda/ })).toBeEnabled();
    // Own content never lands inside it.
    expect(within(section).queryByRole("button", { name: /Do'konda xarid/ })).toBeNull();
  });

  it("assigns an official task and an official module exactly like own content", async () => {
    const onAssign = vi.fn().mockResolvedValue({ created: 5, alreadyHad: 0 });
    const user = userEvent.setup();
    render(<AssignTaskScreen {...BASE} official={OFFICIAL} onAssign={onAssign} />);

    let picker = await openPicker(user);
    await user.click(within(picker).getByRole("button", { name: /Metroda/ }));
    await user.click(screen.getByRole("button", { name: t("teacher.assignTask.submit", { count: 5 }) }));
    expect(onAssign).toHaveBeenLastCalledWith(
      expect.objectContaining({
        selection: expect.objectContaining({ id: "oq-2", kind: "task" }),
        groupId: "g-1",
      }),
    );

    // The module re-arms the button (a different assignment) and goes out as a module.
    // The pick row now names the current choice instead of the prompt.
    await user.click(screen.getByRole("button", { name: /Metroda/ }));
    picker = screen.getByRole("dialog", { name: t("teacher.assignTask.pickTitle") });
    await user.click(within(picker).getByRole("button", { name: /Rasmiy: Kundalik hayot/ }));
    await user.click(screen.getByRole("button", { name: t("teacher.assignTask.submit", { count: 5 }) }));
    expect(onAssign).toHaveBeenLastCalledWith(
      expect.objectContaining({ selection: expect.objectContaining({ id: "om-1", kind: "module" }) }),
    );
    expect(onAssign).toHaveBeenCalledTimes(2);
  });

  it("filters by the search box — a module name keeps its tasks, a task name keeps its module", async () => {
    const user = userEvent.setup();
    render(<AssignTaskScreen {...BASE} official={OFFICIAL} />);
    const picker = await openPicker(user);
    await user.type(within(picker).getByRole("searchbox"), "metro");
    const section = within(picker).getByRole("region", { name: t("teacher.assignTask.officialSection") });
    expect(within(section).getByRole("button", { name: /Metroda/ })).toBeInTheDocument();
    expect(within(section).queryByRole("button", { name: /Nonvoyxonada/ })).toBeNull();
    expect(within(section).getByRole("button", { name: /Rasmiy: Kundalik hayot/ })).toBeInTheDocument();
  });

  it("lets a teacher with NO own content assign from it — the empty state is not shown", async () => {
    const onAssign = vi.fn().mockResolvedValue({ created: 5, alreadyHad: 0 });
    const user = userEvent.setup();
    render(<AssignTaskScreen {...BASE} tasks={[]} modules={[]} official={OFFICIAL} onAssign={onAssign} />);

    expect(screen.queryByText(t("teacher.assignTask.noContent"))).toBeNull();
    const picker = await openPicker(user);
    await user.click(within(picker).getByRole("button", { name: /Nonvoyxonada/ }));
    await user.click(screen.getByRole("button", { name: t("teacher.assignTask.submit", { count: 5 }) }));
    expect(onAssign).toHaveBeenCalledWith(
      expect.objectContaining({ selection: expect.objectContaining({ id: "oq-1", kind: "task" }) }),
    );
  });

  it("shows the no-content empty state only when BOTH sources are empty", () => {
    render(<AssignTaskScreen {...BASE} tasks={[]} modules={[]} official={[]} />);
    expect(screen.getByText(t("teacher.assignTask.noContent"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: new RegExp(t("teacher.assignTask.pickPrompt")) })).toBeNull();
  });
});
