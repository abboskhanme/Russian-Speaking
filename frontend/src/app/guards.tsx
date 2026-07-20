/**
 * app/guards — route guards (docs/08 auth slice, priority #4).
 *
 *   RequireAuth — wraps the student app; redirects to `/login` (remembering the
 *                 attempted path) when unauthenticated.
 *   PublicOnly  — wraps `/login` + `/register`; redirects to `/` when already
 *                 signed in.
 *
 * Both wait out the boot hydration (a stored token being validated) behind a
 * full-screen Spinner so we never flash the login page for a returning user.
 */
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Spinner } from "../shared/ui";
import { useAuth } from "../shared/auth";

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
