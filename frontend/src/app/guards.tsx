/**
 * app/guards — route guards (docs/08 auth slice, priority #4).
 *
 *   RequireAuth — wraps the whole app; redirects to `/login` (remembering the
 *                 attempted path) when unauthenticated.
 *   PublicOnly  — wraps `/login` + `/register`; redirects to `/` when already
 *                 signed in.
 *   RequireRole — splits the authed app by role: the teacher subtree
 *                 (teacher/admin) vs the student subtree. A user outside the
 *                 allowed set is bounced to `/`, where {@link RoleHome} sends
 *                 them to the right home for their role.
 *   RoleHome    — the role-aware `/`: admins → the admin panel; teachers → the
 *                 teacher dashboard; students → the student Home.
 *
 * The auth guards wait out the boot hydration (a stored token being validated)
 * behind a full-screen Spinner so we never flash the login page for a returning
 * user.
 */
import { lazy } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Spinner } from "../shared/ui";
import { useAuth } from "../shared/auth";
import type { UserRole } from "../shared/api";

const HomePage = lazy(() => import("./routes/HomePage"));

function BootFallback() {
  return (
    <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center", background: "var(--bg)" }}>
      <Spinner size="lg" label="Yuklanmoqda…" />
    </div>
  );
}

export function RequireAuth() {
  const { status, isAuthenticated } = useAuth();
  const location = useLocation();
  if (status === "boot") return <BootFallback />;
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <Outlet />;
}

export function PublicOnly() {
  const { status, isAuthenticated } = useAuth();
  if (status === "boot") return <BootFallback />;
  if (isAuthenticated) return <Navigate to="/" replace />;
  return <Outlet />;
}

/** Roles admitted to the teacher app. An admin may use it too (the backend's
 * `IsTeacher` treats admin as a super-teacher), but lands in their OWN app under
 * `/admin/*` — see {@link RoleHome}. */
export const TEACHER_ROLES: readonly UserRole[] = ["teacher", "admin"];

/**
 * Gate an authed subtree by role. Mounted INSIDE {@link RequireAuth}, so `user`
 * is present; a user whose role is not in `allow` is redirected to `/`, which
 * {@link RoleHome} then resolves to the correct home for their role. This is what
 * keeps a teacher out of the student screens (and vice-versa) without any
 * per-page role checks.
 */
export function RequireRole({ allow }: { allow: readonly UserRole[] }) {
  const { user } = useAuth();
  if (user && allow.includes(user.role)) return <Outlet />;
  return <Navigate to="/" replace />;
}

/**
 * The role-aware `/`. A teacher/admin is sent to the teacher dashboard
 * (`/teacher`); a student gets the student Home in place. Keeping `/` as the
 * student home (rather than redirecting students too) preserves the student
 * nav's "home" destination.
 */
export function RoleHome() {
  const { user } = useAuth();
  // An admin gets the ADMIN home, not the teacher one. Until the admin panel
  // existed they were folded in with teachers, which meant signing in as an admin
  // landed on a dashboard about someone else's groups.
  if (user?.role === "admin") {
    return <Navigate to="/admin" replace />;
  }
  if (user && TEACHER_ROLES.includes(user.role)) {
    return <Navigate to="/teacher" replace />;
  }
  return <HomePage />;
}
