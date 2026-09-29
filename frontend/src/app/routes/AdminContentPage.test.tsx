/**
 * The admin's Kontent section — the teacher's C1/C4 pages reused inside the admin
 * shell.
 *
 * WHY THIS IS TESTED. There is no starter content: on a fresh install this section is
 * the ONLY way the official catalog comes to exist, so the path has to work end to end
 * — and reuse is exactly where it breaks quietly:
 *
 *   • a hard-coded `/teacher/content/…` link inside a reused page drops the admin into
 *     the teacher panel (a different nav, a different app) the first time they click;
 *   • a module created here with the teacher default (`group`) and then published
 *     reaches the admin's own students — who do not exist — so the admin believes the
 *     catalog is live while no student can see it;
 *   • the "Rasmiy" option must exist for the admin and must NOT exist for a teacher
 *     (the server answers a teacher's `public` with 403).
 *
 * Driven through the real pages and router, with only the network stubbed.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import i18n from "../../shared/i18n";
import type {
  CreateBlockArgs,
  TeacherBlockDetailResponse,
  TeacherBlockResponse,
  UpdateBlockArgs,
} from "../../shared/api";
import AdminContentPage from "./AdminContentPage";
import AdminModuleEditorPage from "./AdminModuleEditorPage";
import ModuleEditorPage from "./ModuleEditorPage";

const t = i18n.getFixedT("uz", "common");

const block = (over: Partial<TeacherBlockResponse> = {}): TeacherBlockResponse => ({
  id: "b-1",
  name: "A1 · Tanishuv",
  topic: null,
  level: "A1",
  ru_style: null,
  visibility: "public",
  owner_name: "Admin Demo",
  is_published: false,
  sort_order: 0,
  task_count: 0,
  student_count: 0,
  created_at: "2026-09-29T10:00:00Z",
  updated_at: "2026-09-29T10:00:00Z",
  ...over,
});

let blocks: TeacherBlockResponse[] = [];
let detail: TeacherBlockDetailResponse = { ...block(), tasks: [] };
const createCalls = vi.fn();
const updateCalls = vi.fn();

vi.mock("../../shared/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared/api")>();
  return {
    ...actual,
    endpoints: {
      ...actual.endpoints,
      teacherBlocks: () => Promise.resolve(blocks),
      teacherQuestions: () => Promise.resolve([]),
      teacherReviewQueue: () => Promise.resolve([]),
      teacherBlock: () => Promise.resolve(detail),
      createBlock: (args: CreateBlockArgs) => {
        createCalls(args);
        return Promise.resolve({ ...block({ id: "b-new", name: args.name }), tasks: [] });
      },
      updateBlock: (id: string, args: UpdateBlockArgs) => {
        updateCalls(id, args);
        return Promise.resolve(detail);
      },
    },
  };
});

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/content" element={<AdminContentPage />} />
        <Route path="/admin/content/:blockId" element={<AdminModuleEditorPage />} />
        <Route path="/teacher/content/:blockId" element={<ModuleEditorPage />} />
        <Route path="*" element={null} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
  return userEvent.setup();
}

const where = () => screen.getByTestId("where").textContent;

beforeEach(() => {
  blocks = [];
  detail = { ...block(), tasks: [] };
  createCalls.mockClear();
  updateCalls.mockClear();
});

describe("/admin/content — the empty catalog of a fresh install", () => {
  it("explains what an official module is and creates one that starts OFFICIAL", async () => {
    const user = renderAt("/admin/content");

    expect(await screen.findByText(t("admin.catalog.emptyTitle"))).toBeInTheDocument();
    expect(screen.getByText(t("admin.catalog.emptyBody"))).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: t("admin.catalog.createFirst") }));

    expect(createCalls).toHaveBeenCalledWith({ name: t("teacher.newModule"), visibility: "public" });
    // …and the editor that opens is the ADMIN's, not the teacher panel's.
    await waitFor(() => expect(where()).toBe("/admin/content/b-new"));
  });
});

describe("/admin/content — the list", () => {
  it("frames the teacher list in the admin shell, with author and visibility per row", async () => {
    blocks = [
      block(),
      block({ id: "b-2", name: "Guruh moduli", visibility: "group", owner_name: "Aziz Karimov" }),
    ];
    const user = renderAt("/admin/content");

    expect(await screen.findByText("A1 · Tanishuv")).toBeInTheDocument();
    expect(screen.getByText(t("admin.catalog.public"))).toBeInTheDocument();
    expect(screen.getByText(t("admin.catalog.group"))).toBeInTheDocument();
    expect(screen.getByText(t("admin.catalog.owner", { name: "Aziz Karimov" }))).toBeInTheDocument();

    // The admin's nav, not the teacher's: Tariflar is there, the grading queue is not.
    expect(screen.getAllByRole("button", { name: t("nav.adminBilling") }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: t("nav.queue") })).not.toBeInTheDocument();

    await user.click(screen.getByText("Guruh moduli"));
    await waitFor(() => expect(where()).toBe("/admin/content/b-2"));
  });
});

describe("/admin/content/:id — the editor", () => {
  it("offers Rasmiy, saves the choice, and goes back inside /admin/content", async () => {
    detail = { ...block({ visibility: "group", owner_name: "Aziz Karimov" }), tasks: [] };
    const user = renderAt("/admin/content/b-1");

    // An option's accessible name is its label followed by its hint.
    const option = (label: string) => ({ name: (name: string) => name.startsWith(label) });
    const official = await screen.findByRole("radio", option(t("admin.catalog.publicOption")));
    expect(screen.getByRole("radio", option(t("admin.catalog.groupOption")))).toBeChecked();

    await user.click(official);
    expect(updateCalls).toHaveBeenCalledWith("b-1", { visibility: "public" });

    await user.click(screen.getByRole("button", { name: t("common.back") }));
    await waitFor(() => expect(where()).toBe("/admin/content"));
  });

  it("is never offered to a teacher", async () => {
    renderAt("/teacher/content/b-1");

    expect(await screen.findByDisplayValue("A1 · Tanishuv")).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(screen.queryByText(t("admin.catalog.publicOption"))).not.toBeInTheDocument();
  });
});
