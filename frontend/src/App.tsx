/**
 * App — the student router (docs/08 Faza 4.1 / 4.8).
 *
 * Maps the 5 student destinations to their screens and lazy-loads each route so
 * every screen is its own bundle (the §4.1 code-split budget). The `Nav` active
 * state and navigation are wired per-page via `app/nav` (`activeNavKey` +
 * `onNavigate`). Unknown paths fall back to Home.
 *
 *   /          → Home
 *   /practice  → Practice
 *   /chat      → AI Suhbat (placeholder — Faza 6.5)
 *   /progress  → Progress
 *   /profile   → Profile
 */
import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Spinner } from "./shared/ui";
import { PublicOnly, RequireAuth } from "./app/guards";

const HomePage = lazy(() => import("./app/routes/HomePage"));
const PracticePage = lazy(() => import("./app/routes/PracticePage"));
const ChatPage = lazy(() => import("./app/routes/ChatPage"));
const ProgressPage = lazy(() => import("./app/routes/ProgressPage"));
const ProfilePage = lazy(() => import("./app/routes/ProfilePage"));
const LoginPage = lazy(() => import("./app/routes/LoginPage"));
const RegisterPage = lazy(() => import("./app/routes/RegisterPage"));
const PlacementPage = lazy(() => import("./app/routes/PlacementPage"));
const TryPlacementPage = lazy(() => import("./app/routes/TryPlacementPage"));

function RouteFallback() {
  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        background: "var(--bg)",
      }}
    >
      <Spinner size="lg" label="Yuklanmoqda…" />
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        {/* Pre-auth: redirect to Home when already signed in. */}
        <Route element={<PublicOnly />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Route>

        {/* Public "try before you register" level test — reachable while logged out,
            so it lives OUTSIDE RequireAuth (and PublicOnly, so a curious signed-in
            user can revisit it too). Uses the auth-less guest placement endpoints. */}
        <Route path="/try" element={<TryPlacementPage />} />

        {/* Student app: redirect to /login when unauthenticated. */}
        <Route element={<RequireAuth />}>
          {/* One-time post-register placement ("dastlabki sinov"). */}
          <Route path="/placement" element={<PlacementPage />} />
          <Route path="/" element={<HomePage />} />
          <Route path="/practice" element={<PracticePage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/progress" element={<ProgressPage />} />
          <Route path="/profile" element={<ProfilePage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
