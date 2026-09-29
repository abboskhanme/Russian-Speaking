/**
 * AdminContentPage (`/admin/content`) — the admin's Kontent: the teacher's C1 list
 * (Modullar | Vazifalar) inside the admin shell, listing EVERY module with its author
 * and visibility. See {@link AdminContentPanel}.
 */
import ContentPage from "./ContentPage";
import { AdminContentPanel } from "./AdminContentPanel";

export default function AdminContentPage() {
  return (
    <AdminContentPanel>
      <ContentPage />
    </AdminContentPanel>
  );
}
