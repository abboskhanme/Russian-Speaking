/**
 * AssignTaskPage — D3 wired to the API, for the official catalog.
 *
 * WHY A PAGE TEST. The screen test proves the picker shows a "Rasmiy katalog"
 * section; only the page proves what it SENDS. An official task must go out
 * through `POST /api/assignments` with its own id, an official module through
 * `POST /api/assignments/module` — the same two routes own content uses — and a
 * teacher who has authored nothing must reach them at all rather than read
 * "no content".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import i18n from "../../shared/i18n";
import type {
  GroupResponse,
  OfficialCatalogModuleResponse,
  TeacherBlockResponse,
} from "../../shared/api";
import AssignTaskPage from "./AssignTaskPage";

const t = i18n.getFixedT("uz", "common");

const GROUP: GroupResponse = {
  id: "g-1",
  name: "Kechki-3",
  join_code: "ABC234",
  member_count: 4,
  teacher_id: "t-1",
  teacher_name: "Ustoz",
  created_at: new Date().toISOString(),
};

const OFFICIAL: OfficialCatalogModuleResponse[] = [
  {
    id: "om-1",
    name: "Kundalik hayot",
    level: "A2",
    topic: "daily",
    tasks: [
      { id: "oq-1", title: "Nonvoyxonada", level: "A2", topic: "shop" },
      { id: "oq-2", title: "Metroda", level: null, topic: null },
    ],
  },
];

// Hoisted with the mock below, which runs before this module's own statements.
const { groups, questions, blocks, official, createOne, createModule } = vi.hoisted(() => ({
  groups: vi.fn(),
  questions: vi.fn(),
  blocks: vi.fn(),
  official: vi.fn(),
  createOne: vi.fn(),
  createModule: vi.fn(),
}));

vi.mock("../../shared/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared/api")>();
  return {
    ...actual,
    endpoints: {
      ...actual.endpoints,
      teacherGroups: () => groups(),
      teacherQuestions: () => questions(),
      teacherBlocks: () => blocks(),
      officialCatalog: () => official(),
      teacherReviewCount: () => Promise.resolve({ count: 0 }),
      createAssignments: (...args: unknown[]) => createOne(...args),
      createModuleAssignments: (...args: unknown[]) => createModule(...args),
      unreadCount: () => Promise.resolve({ count: 0 }),
    },
  };
});

beforeEach(() => {
  groups.mockReset().mockResolvedValue([GROUP]);
  // A teacher who has authored NOTHING.
  questions.mockReset().mockResolvedValue([]);
  blocks.mockReset().mockResolvedValue([]);
  official.mockReset().mockResolvedValue(OFFICIAL);
  createOne.mockReset().mockResolvedValue([{ student_id: "s-1" }, { student_id: "s-2" }]);
  createModule.mockReset().mockResolvedValue([{ student_id: "s-1" }]);
});

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/teacher/assign?group=g-1"]}>
      <AssignTaskPage />
    </MemoryRouter>,
  );
  return userEvent.setup();
}

async function pick(user: ReturnType<typeof userEvent.setup>, opener: RegExp, title: RegExp) {
  await user.click(await screen.findByRole("button", { name: opener }));
  const picker = screen.getByRole("dialog", { name: t("teacher.assignTask.pickTitle") });
  const section = within(picker).getByRole("region", { name: t("teacher.assignTask.officialSection") });
  await user.click(within(section).getByRole("button", { name: title }));
}

describe("D3 · Rasmiy katalog", () => {
  it("assigns an official task through POST /api/assignments with its id", async () => {
    const user = renderPage();
    expect(await screen.findByRole("button", { name: new RegExp(t("teacher.assignTask.pickPrompt")) })).toBeInTheDocument();
    expect(screen.queryByText(t("teacher.assignTask.noContent"))).toBeNull();

    await pick(user, new RegExp(t("teacher.assignTask.pickPrompt")), /Metroda/);
    await user.click(screen.getByRole("button", { name: t("teacher.assignTask.submit", { count: 4 }) }));

    expect(createOne).toHaveBeenCalledWith({ question_id: "oq-2", group_id: "g-1" });
    expect(createModule).not.toHaveBeenCalled();
    // The result line reads the server's rows: 2 got it, the other 2 already had it.
    expect(
      await screen.findByText(t("teacher.assignTask.createdSplit", { count: 2, already: 2 })),
    ).toBeInTheDocument();
  });

  it("assigns an official module through POST /api/assignments/module", async () => {
    const user = renderPage();
    await pick(user, new RegExp(t("teacher.assignTask.pickPrompt")), /Kundalik hayot/);
    await user.click(screen.getByRole("button", { name: t("teacher.assignTask.submit", { count: 4 }) }));

    expect(createModule).toHaveBeenCalledWith({ block_id: "om-1", group_id: "g-1" });
    expect(createOne).not.toHaveBeenCalled();
  });

  it("does not repeat a module the teacher's own list already offers", async () => {
    const own: TeacherBlockResponse = {
      id: "om-1",
      name: "Kundalik hayot",
      topic: null,
      level: "A2",
      ru_style: null,
      visibility: "public",
      is_published: true,
      sort_order: 0,
      task_count: 2,
      student_count: 4,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      owner_name: "Admin",
    };
    blocks.mockResolvedValue([own]);
    const user = renderPage();
    await user.click(await screen.findByRole("button", { name: new RegExp(t("teacher.assignTask.pickPrompt")) }));
    const picker = screen.getByRole("dialog", { name: t("teacher.assignTask.pickTitle") });
    expect(within(picker).queryByRole("region", { name: t("teacher.assignTask.officialSection") })).toBeNull();
    expect(within(picker).getAllByRole("button", { name: /Kundalik hayot/ })).toHaveLength(1);
  });

  it("says there is no content only when the official catalog is empty too", async () => {
    official.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(t("teacher.assignTask.noContent"))).toBeInTheDocument();
  });
});
