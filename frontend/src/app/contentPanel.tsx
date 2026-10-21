/**
 * app/contentPanel — which panel the Kontent pages are running in.
 *
 * `ContentPage` and `ModuleEditorPage` are the teacher's C1/C4 screens, and the
 * admin's Kontent section (`/admin/content`) is the SAME two pages, not a fork: an
 * official module is authored exactly like a teacher's, and two copies of an editor
 * drift the moment either gains a field. What differs is small and lives here:
 *
 *   • where the links point (`/teacher/content` vs `/admin/content`), so a click
 *     inside the admin's editor never drops them into the teacher panel;
 *   • which shell frames the page (the admin nav + header avatar);
 *   • what a new module starts as — an admin's starts OFFICIAL (`public`), since the
 *     admin's content section exists to build the catalog every student sees;
 *   • three admin-only render slots (owner + visibility on each row, the visibility
 *     picker in the editor, the empty-catalog explainer), whose components live in
 *     `screens/admin` so the teacher files carry only the slot, never admin UI.
 *
 * The default value IS the teacher panel, so the teacher routes need no provider and
 * behave exactly as before.
 */
import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type {
  CreateBlockArgs,
  TeacherBlockDetailResponse,
  TeacherBlockResponse,
} from "../shared/api";
import type { NavItem } from "../widgets";
import { TEACHER_NAV_PATH } from "./nav";

export interface ContentPanel {
  /** The list route; a module's editor is `${basePath}/${id}`. */
  basePath: string;
  /** Replaces the teacher shell's nav + header. Absent = the teacher shell. */
  shell?: { navItems: NavItem[]; headerEnd?: ReactNode };
  /** Replaces the teacher nav handler when `shell` swaps the nav. */
  onNavigate?: (key: string, item?: NavItem) => void;
  /** Merged into `POST /api/blocks` when "+ Yaratish" makes a module. */
  createDefaults?: Partial<CreateBlockArgs>;
  /** An extra line under a module row's meta (the admin: owner + visibility). */
  renderModuleExtra?: (block: TeacherBlockResponse) => ReactNode;
  /** An extra card under the editor's name/topic/level form (the admin: visibility). */
  renderEditorExtra?: (block: TeacherBlockDetailResponse, onChanged: () => void) => ReactNode;
  /** Replaces the Modullar tab's empty line (the admin: what the catalog is for). */
  renderModulesEmpty?: (create: () => void) => ReactNode;
  /** Replaces the Modullar cards on a wide screen (the admin: a sortable table of
   * every module). Called only at ≥1080px. */
  renderModulesTable?: (blocks: TeacherBlockResponse[], open: (id: string) => void) => ReactNode;
}

/** The teacher panel — the default, so `/teacher/content` needs no provider. */
export const TEACHER_CONTENT_PANEL: ContentPanel = { basePath: TEACHER_NAV_PATH.content };

export const ContentPanelContext = createContext<ContentPanel>(TEACHER_CONTENT_PANEL);

export function useContentPanel(): ContentPanel {
  return useContext(ContentPanelContext);
}
