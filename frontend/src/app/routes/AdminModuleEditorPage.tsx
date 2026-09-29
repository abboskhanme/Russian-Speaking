/**
 * AdminModuleEditorPage (`/admin/content/:blockId`) — the teacher's C4 module editor
 * inside the admin shell, plus the visibility picker whose "Rasmiy" option makes a
 * module part of the official catalog. See {@link AdminContentPanel}.
 */
import ModuleEditorPage from "./ModuleEditorPage";
import { AdminContentPanel } from "./AdminContentPanel";

export default function AdminModuleEditorPage() {
  return (
    <AdminContentPanel>
      <ModuleEditorPage />
    </AdminContentPanel>
  );
}
