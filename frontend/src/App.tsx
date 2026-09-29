/**
 * App — the app router (docs/08 Faza 4.1 / 4.8 · Teacher panel Faza 4.9).
 *
 * Lazy-loads each route so every screen is its own bundle (the §4.1 code-split
 * budget). The `Nav` active state + navigation are wired per-page via `app/nav`
 * (`activeNavKey` + `onNavigate`).
 *
 * Role split: authed users land on `/`, which {@link RoleHome} resolves — a
 * teacher/admin is sent to the teacher app under `/teacher/*`, a student stays on
 * the student Home. {@link RequireRole} then keeps each subtree to its own role
 * (a student can't reach `/teacher/*`, a teacher can't reach the student
 * screens). Unknown paths fall back to `/`, which re-resolves per role.
 *
 *   /                        → Home (student) · redirect to /teacher (teacher)
 *   /practice                → Mashq hub (Modullar · Topshiriqlar · Suhbat)
 *   /practice/module/:id     → module detail (D2) + complete (D3)
 *   /task?task=:id           → the task recording screen (+ `&from=daily` from the
 *                              daily session, which adds a way back to it)
 *   /chat                    → AI Suhbat scenario grid (the centre FAB)
 *   /chat/:scenarioId        → AI conversation (E3 chat + E4 summary, live roleplay API)
 *   /j/:code                 → a teacher's invite link (public; files the join request)
 *   /review                  → Xatolar ustida — the xato-replay drill (flagged)
 *   /daily                   → Bugungi 5 daqiqa — the daily session (flagged)
 *   /drill                   → Tovushlar mashqi — minimal-pair drill (flagged)
 *   /progress                → Progress
 *   /profile                 → Profile
 *   /premium                 → Premium (obuna holati + tariflar)
 *   /teacher                 → teacher A1 Obzor (its own nav: Bosh · Klasslar ·
 *                              Navbat · Kontent · Analitika)
 */
import { Suspense, lazy } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ErrorBoundary, Spinner } from "./shared/ui";
import { useTranslation } from "react-i18next";
import {
  JoinLink,
  PublicOnly,
  RequireAuth,
  RequireRole,
  RoleHome,
  TEACHER_ROLES,
} from "./app/guards";
const TeacherDashboardPage = lazy(() => import("./app/routes/TeacherDashboardPage"));
const ClassesPage = lazy(() => import("./app/routes/ClassesPage"));
const GroupDetailPage = lazy(() => import("./app/routes/GroupDetailPage"));
const GroupInvitePage = lazy(() => import("./app/routes/GroupInvitePage"));
const StudentProfilePage = lazy(() => import("./app/routes/StudentProfilePage"));
const ReviewQueuePage = lazy(() => import("./app/routes/ReviewQueuePage"));
const AttemptReviewPage = lazy(() => import("./app/routes/AttemptReviewPage"));
const ContentPage = lazy(() => import("./app/routes/ContentPage"));
const ModuleEditorPage = lazy(() => import("./app/routes/ModuleEditorPage"));
const AnalyticsPage = lazy(() => import("./app/routes/AnalyticsPage"));
const AssignTaskPage = lazy(() => import("./app/routes/AssignTaskPage"));
const TeacherProfilePage = lazy(() => import("./app/routes/TeacherProfilePage"));
const AdminDashboardPage = lazy(() => import("./app/routes/AdminDashboardPage"));
const AdminTeachersPage = lazy(() => import("./app/routes/AdminTeachersPage"));
const AdminStudentsPage = lazy(() => import("./app/routes/AdminStudentsPage"));
const AdminSettingsPage = lazy(() => import("./app/routes/AdminSettingsPage"));
const AdminBillingPage = lazy(() => import("./app/routes/AdminBillingPage"));
const PracticeHubPage = lazy(() => import("./app/routes/PracticeHubPage"));
const ModuleDetailPage = lazy(() => import("./app/routes/ModuleDetailPage"));
const PracticePage = lazy(() => import("./app/routes/PracticePage"));
const ConversationHubPage = lazy(() => import("./app/routes/ConversationHubPage"));
const ConversationPage = lazy(() => import("./app/routes/ConversationPage"));
const ReviewDrillPage = lazy(() => import("./app/routes/ReviewDrillPage"));
const DailyPage = lazy(() => import("./app/routes/DailyPage"));
const DrillPage = lazy(() => import("./app/routes/DrillPage"));
const ProgressPage = lazy(() => import("./app/routes/ProgressPage"));
const GroupPage = lazy(() => import("./app/routes/GroupPage"));
const AllResultsPage = lazy(() => import("./app/routes/AllResultsPage"));
const AttemptDetailPage = lazy(() => import("./app/routes/AttemptDetailPage"));
const ProfilePage = lazy(() => import("./app/routes/ProfilePage"));
const PremiumPage = lazy(() => import("./app/routes/PremiumPage"));
const LoginPage = lazy(() => import("./app/routes/LoginPage"));
const RegisterPage = lazy(() => import("./app/routes/RegisterPage"));
const PlacementPage = lazy(() => import("./app/routes/PlacementPage"));
const TryPlacementPage = lazy(() => import("./app/routes/TryPlacementPage"));

function RouteFallback() {
  const { t } = useTranslation();
  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        background: "var(--bg)",
      }}
    >
      <Spinner size="lg" label={t("common.loading")} />
    </div>
  );
}

export default function App() {
  // The route boundary's reset key. Any navigation clears a caught error, which is
  // what makes a crashed page a crashed PAGE: the fallback does not follow the
  // person to the next screen.
  const { pathname } = useLocation();

  return (
    /* TWO boundaries, not one, and the difference is the whole point.
     *
     * The inner one wraps the route content, so one screen throwing costs that
     * screen and nothing else — press "Bosh sahifaga", or navigate any other way,
     * and the app is working again. It sits INSIDE `Suspense` deliberately: a lazy
     * chunk that fails to download (a phone that lost signal mid-session) throws
     * where the lazy element renders, and this is the nearest boundary to it.
     *
     * The outer one is the last line of defence. It catches what the inner one
     * cannot be under — `Suspense` itself, and anything App renders around the
     * routes — so that even those end at a page with a way out instead of at a
     * blank white screen with none. */
    <ErrorBoundary>
      <Suspense fallback={<RouteFallback />}>
        <ErrorBoundary resetKey={pathname}>
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

            {/* A teacher's invite link. Public, because the student who taps it may be
                signed out (or have no account yet): the guard remembers the code, sends
                them to sign in when needed, and the student Home files the join request
                once. Teachers/admins are sent home without joining. */}
            <Route path="/j/:code" element={<JoinLink />} />

            {/* Authed app: redirect to /login when unauthenticated. */}
            <Route element={<RequireAuth />}>
              {/* Role-aware root: teacher/admin → /teacher, student → student Home. */}
              <Route path="/" element={<RoleHome />} />

              {/* Teacher app (teacher/admin only) — its own /teacher/* space, its own
                  design and nav (never a re-skin of the student screens). Phases 1–2
                  ship A1 Obzor + Klasslar; Navbat/Kontent/Analitika follow. */}
              <Route element={<RequireRole allow={TEACHER_ROLES} />}>
                <Route path="/teacher" element={<TeacherDashboardPage />} />
                {/* Klasslar — Guruhlar | So'rovlar | O'quvchilar tabs (?tab=…). */}
                <Route path="/teacher/classes" element={<ClassesPage />} />
                {/* A5 group detail → A7 invite (join code + waiting students). */}
                <Route path="/teacher/classes/:groupId" element={<GroupDetailPage />} />
                <Route path="/teacher/classes/:groupId/invite" element={<GroupInvitePage />} />
                {/* A6 student profile, reached from a roster row or the students tab. */}
                <Route path="/teacher/students/:studentId" element={<StudentProfilePage />} />
                {/* Navbat — the grading queue (B1) → one attempt's detail + manual
                    grading (B2/B3). This is what the centre FAB opens. */}
                <Route path="/teacher/queue" element={<ReviewQueuePage />} />
                <Route path="/teacher/queue/:attemptId" element={<AttemptReviewPage />} />
                {/* Kontent — Modullar | Vazifalar (C1) → the module editor (C4), which
                    hosts the library picker (C5) and the new-task sheet (C2). */}
                <Route path="/teacher/content" element={<ContentPage />} />
                <Route path="/teacher/content/:blockId" element={<ModuleEditorPage />} />
                {/* Analitika — Insaytlar | Jurnal (D1/D2), `?tab=grades` for the
                    gradebook, `?group=` for the per-group filter. */}
                <Route path="/teacher/analytics" element={<AnalyticsPage />} />
                {/* Topshiriq berish — bulk assign (D3). `?group=` preselects, which is
                    how the A2 group cards and the A5 group detail already link here. */}
                <Route path="/teacher/assign" element={<AssignTaskPage />} />
                {/* Profil — reached from the A1 header avatar, NOT from the nav bar
                    (the teacher's bar has no Profil item, by design). */}
                <Route path="/teacher/profile" element={<TeacherProfilePage />} />
              </Route>

              {/* Admin app (admins ONLY — teachers are deliberately not allowed here,
                  unlike the /teacher subtree which admits both). Its own /admin/*
                  space, its own four-item nav, its own design. */}
              <Route element={<RequireRole allow={["admin"]} />}>
                <Route path="/admin" element={<AdminDashboardPage />} />
                <Route path="/admin/teachers" element={<AdminTeachersPage />} />
                <Route path="/admin/students" element={<AdminStudentsPage />} />
                <Route path="/admin/settings" element={<AdminSettingsPage />} />
                {/* Tariflar — the plan editor + who holds a subscription. */}
                <Route path="/admin/billing" element={<AdminBillingPage />} />
              </Route>

              {/* Student app (students only). */}
              <Route element={<RequireRole allow={["student"]} />}>
                {/* One-time post-register placement ("dastlabki sinov"). */}
                <Route path="/placement" element={<PlacementPage />} />
                {/* Mashq hub + its drill-downs. The recording screen lives at /task so
                    /practice is free for the hub (now just Modullar · Topshiriqlar). */}
                <Route path="/practice" element={<PracticeHubPage />} />
                <Route path="/practice/module/:moduleId" element={<ModuleDetailPage />} />
                <Route path="/task" element={<PracticePage />} />
                {/* AI Suhbat — the centre FAB's own destination: the scenario grid,
                    then each scenario's chat. */}
                <Route path="/chat" element={<ConversationHubPage />} />
                <Route path="/chat/:scenarioId" element={<ConversationPage />} />
                {/* Xatolar ustida — the F5 replay drill (flagged; the route 404s
                    itself back to /practice when the deployment has it off). This is
                    the path `review_added` notifications have always linked to. */}
                <Route path="/review" element={<ReviewDrillPage />} />
                {/* Bugungi 5 daqiqa — the F3 daily session (flagged; the route
                    404s itself back to Home when the deployment has it off). It
                    keeps `activeNavKey="home"`: it is the shape of today's
                    practice, not a sixth destination, and the bar stays 5 items. */}
                <Route path="/daily" element={<DailyPage />} />
                {/* Tovushlar mashqi — the F2 minimal-pair drill (flagged). Unlike
                    the two above it does NOT bounce when the flag is off: the
                    screen distinguishes "not enabled here" from "no speech key is
                    wired" from "today's attempts are used", and each needs saying. */}
                <Route path="/drill" element={<DrillPage />} />
                <Route path="/progress" element={<ProgressPage />} />
                {/* Group view (classmates + group leaderboard), reached from Home. */}
                <Route path="/group" element={<GroupPage />} />
                {/* Results drill-down: Profile → all history → one attempt's detail. */}
                <Route path="/results" element={<AllResultsPage />} />
                <Route path="/results/:id" element={<AttemptDetailPage />} />
                <Route path="/profile" element={<ProfilePage />} />
                {/* Premium — obuna holati + tariflar. Reached from the profile's PRO
                    card and from the paywall a 402 raises. */}
                <Route path="/premium" element={<PremiumPage />} />
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ErrorBoundary>
      </Suspense>
    </ErrorBoundary>
  );
}
