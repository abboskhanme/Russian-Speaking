/**
 * AdminLayout — the `/admin/*` layout route. Renders nothing of its own; it gives
 * every admin screen's header avatar the signed-in admin and the way to their own
 * account (see `AdminChromeContext`), once, instead of threading the same two values
 * through each screen's props.
 */
import { useMemo } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../../shared/auth";
import { AdminChromeContext } from "../../screens/admin/AdminChrome";
import type { AdminChromeValue } from "../../screens/admin/AdminChrome";
import { ADMIN_PROFILE_PATH } from "../nav";

export default function AdminLayout() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const fullName = user?.full_name ?? "";

  const chrome = useMemo<AdminChromeValue>(
    () => ({ fullName, onOpenProfile: () => navigate(ADMIN_PROFILE_PATH) }),
    [fullName, navigate],
  );

  return (
    <AdminChromeContext.Provider value={chrome}>
      <Outlet />
    </AdminChromeContext.Provider>
  );
}
