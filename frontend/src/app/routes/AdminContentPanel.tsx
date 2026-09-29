/**
 * AdminContentPanel — the admin's Kontent section (`/admin/content`,
 * `/admin/content/:blockId`), "Modul, vazifa va ssenariylar" in the admin mockup.
 *
 * It is the teacher's C1/C4 pages, reused rather than forked, inside the admin shell:
 * this provider swaps the frame (admin nav + header avatar), keeps every link inside
 * `/admin/content`, makes a new module start OFFICIAL, and fills the three admin-only
 * slots (owner + visibility per row, the visibility picker, the empty-catalog card).
 * See `app/contentPanel` for why each exists.
 *
 * Why a new module starts `public`: on a fresh install nothing is seeded, and this
 * section is where the official catalog every student sees gets built. A module is a
 * DRAFT until published, so starting it official reaches nobody early — while starting
 * it `group` would let an admin publish it to "their own students", who do not exist,
 * and conclude the catalog is live when no one can see it. The picker in the editor
 * changes it either way.
 */
import { useMemo } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { endpoints } from "../../shared/api";
import { AdminAccountButton } from "../../screens/admin/AdminChrome";
import {
  AdminCatalogEmpty,
  AdminModuleMeta,
  AdminVisibilityCard,
} from "../../screens/admin/AdminContentExtras";
import { NotificationsBell, adminNavItems } from "../../widgets";
import { ContentPanelContext } from "../contentPanel";
import type { ContentPanel } from "../contentPanel";
import { ADMIN_NAV_PATH, useAdminNavHandler } from "../nav";

export function AdminContentPanel({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const onNavigate = useAdminNavHandler();

  const panel = useMemo<ContentPanel>(
    () => ({
      basePath: ADMIN_NAV_PATH.content,
      shell: {
        navItems: adminNavItems(t),
        headerEnd: (
          <>
            <NotificationsBell />
            <AdminAccountButton />
          </>
        ),
      },
      onNavigate,
      createDefaults: { visibility: "public" },
      renderModuleExtra: (block) => (
        <AdminModuleMeta visibility={block.visibility} ownerName={block.owner_name} />
      ),
      renderEditorExtra: (block, onChanged) => (
        <AdminVisibilityCard
          visibility={block.visibility}
          ownerName={block.owner_name}
          onChange={async (visibility) => {
            await endpoints.updateBlock(block.id, { visibility });
            onChanged();
          }}
        />
      ),
      renderModulesEmpty: (create) => <AdminCatalogEmpty onCreate={create} />,
    }),
    [t, onNavigate],
  );

  return <ContentPanelContext.Provider value={panel}>{children}</ContentPanelContext.Provider>;
}
