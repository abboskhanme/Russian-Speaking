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
 *   /task?task=:id           → the task recording screen
 *   /chat/:scenarioId        → AI conversation (E3 chat + E4 summary, stubbed)
 *   /progress                → Progress
 *   /profile                 → Profile
 *   /teacher                 → teacher A1 Obzor (its own nav: Bosh · Klasslar ·
 *                              Navbat · Kontent · Analitika)
 */
import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Spinner } from "./shared/ui";
import { PublicOnly, RequireAuth, RequireRole, RoleHome, TEACHER_ROLES } from "./app/guards";
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
const PracticeHubPage = lazy(() => import("./app/routes/PracticeHubPage"));
const ModuleDetailPage = lazy(() => import("./app/routes/ModuleDetailPage"));
const PracticePage = lazy(() => import("./app/routes/PracticePage"));
const ConversationHubPage = lazy(() => import("./app/routes/ConversationHubPage"));
const ConversationPage = lazy(() => import("./app/routes/ConversationPage"));
const ProgressPage = lazy(() => import("./app/routes/ProgressPage"));
const GroupPage = lazy(() => import("./app/routes/GroupPage"));
const AllResultsPage = lazy(() => import("./app/routes/AllResultsPage"));
const AttemptDetailPage = lazy(() => import("./app/routes/AttemptDetailPage"));
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
            <Route path="/progress" element={<ProgressPage />} />
            {/* Group view (classmates + group leaderboard), reached from Home. */}
            <Route path="/group" element={<GroupPage />} />
            {/* Results drill-down: Profile → all history → one attempt's detail. */}
            <Route path="/results" element={<AllResultsPage />} />
            <Route path="/results/:id" element={<AttemptDetailPage />} />
            <Route path="/profile" element={<ProfilePage />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
