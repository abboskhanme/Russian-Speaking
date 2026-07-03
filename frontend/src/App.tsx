import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { api } from "./lib/api";
import { NotFound } from "./pages/NotFound";
import { useI18n, type Lang } from "./lib/i18n";
import { TELEGRAM_CHANNEL_URL, TELEGRAM_SUPPORT_URL } from "./lib/contact";
import { useStudentStats } from "./lib/useStats";
import { FREE_ATTEMPT_LIMIT } from "./lib/plan";
import { Login } from "./pages/Login";
import { Register } from "./pages/Register";
import { CompleteProfile } from "./pages/CompleteProfile";
import { StudentHome } from "./pages/StudentHome";
import { StudentProgress } from "./pages/StudentProgress";
import { StudentQuestions } from "./pages/StudentQuestions";
import { AnswerQuestion } from "./pages/AnswerQuestion";
import { SubmissionResult } from "./pages/SubmissionResult";
import { Leaderboard } from "./pages/Leaderboard";
import { Review } from "./pages/Review";
import { Shadowing } from "./pages/Shadowing";
import { Notifications } from "./pages/Notifications";
import { StudentAssignments } from "./pages/StudentAssignments";
import { TeacherDashboard } from "./pages/TeacherDashboard";
import { TeacherQuestions } from "./pages/TeacherQuestions";
import { TeacherBlocks } from "./pages/TeacherBlocks";
import { TeacherSubmissions } from "./pages/TeacherSubmissions";
import { TeacherStudents } from "./pages/TeacherStudents";
import { TeacherAssignments } from "./pages/TeacherAssignments";
import { TeacherGroups } from "./pages/TeacherGroups";
import { TeacherGroupDetail } from "./pages/TeacherGroupDetail";
import { TeacherGradebook } from "./pages/TeacherGradebook";
import { TeacherTopics } from "./pages/TeacherTopics";
import { CreateQuestion } from "./pages/CreateQuestion";
import { PremiumInfo } from "./pages/PremiumInfo";
import { AdminDashboard } from "./pages/AdminDashboard";
import { AdminTeachers } from "./pages/AdminTeachers";
import { AdminTeacherDetail } from "./pages/AdminTeacherDetail";
import { AdminStudents } from "./pages/AdminStudents";
import { AdminStudentDetail } from "./pages/AdminStudentDetail";
import { AdminTests } from "./pages/AdminTests";
import { Settings } from "./pages/Settings";
import {
  Avatar,
  AttemptDots,
  Icon,
  Loading,
  Logo,
  Mascot,
  Pill,
  iconBtn,
  type IconName,
} from "./components/govori";

/* ─── Role labels ───────────────────────────────────────── */
export function roleLabel(role: string, t: (k: "adminRole" | "teacher" | "student") => string) {
  return role === "admin" ? t("adminRole") : role === "teacher" ? t("teacher") : t("student");
}

interface NavItem {
  to: string;
  icon: IconName;
  label: string;
  badge?: number;
  heading?: boolean; // non-clickable section header (super-admin combined nav)
}

function useNavItems(): NavItem[] {
  const { user } = useAuth();
  const { t } = useI18n();
  if (!user) return [];
  if (user.role === "admin")
    // Super-admin: ONE clean oversight menu over everything — not a stack of
    // per-role menus. These pages already show ALL teachers'/students' data for
    // an admin (backend grants universal access).
    return [
      { to: "/admin", icon: "home", label: t("navOverview") },
      { to: "/admin/teachers", icon: "grad", label: t("tabTeachers") },
      { to: "/admin/students", icon: "users", label: t("tabStudents") },
      { to: "/teacher/questions", icon: "message", label: t("navTests") },
      { to: "/teacher/blocks", icon: "layers", label: t("blocks") },
      { to: "/teacher/groups", icon: "users", label: t("navGroups") },
      { to: "/teacher/submissions", icon: "headphones", label: t("navAnswers") },
      { to: "/teacher/gradebook", icon: "chart", label: t("navGradebook") },
      { to: "/shadowing", icon: "volume", label: t("navShadow") },
    ];
  if (user.role === "teacher")
    return [
      { to: "/teacher", icon: "home", label: t("navOverview") },
      { to: "/teacher/questions", icon: "message", label: t("navTests") },
      { to: "/teacher/blocks", icon: "layers", label: t("blocks") },
      { to: "/teacher/groups", icon: "users", label: t("navGroups") },
      { to: "/teacher/submissions", icon: "headphones", label: t("navAnswers") },
      { to: "/teacher/gradebook", icon: "grad", label: t("navGradebook") },
      { to: "/shadowing", icon: "volume", label: t("navShadow") },
    ];
  return [
    { to: "/", icon: "home", label: t("navHome") },
    { to: "/questions", icon: "mic", label: t("navPractice") },
    { to: "/shadowing", icon: "headphones", label: t("navShadow") },
    { to: "/leaderboard", icon: "trophy", label: t("navRating") },
    { to: "/progress", icon: "chart", label: t("navProgress") },
  ];
}

/** The nav item whose path is the longest prefix of the current location. */
function bestMatch(items: NavItem[], pathname: string): string {
  let best = "";
  let bestLen = -1;
  for (const it of items) {
    const m = pathname === it.to || (it.to !== "/" && pathname.startsWith(it.to + "/"));
    if (m && it.to.length > bestLen) {
      best = it.to;
      bestLen = it.to.length;
    }
  }
  return best;
}

/* ─── Language switcher ─────────────────────────────────── */
function LangSwitcher() {
  const { lang, setLang } = useI18n();
  const { user, refreshUser } = useAuth();
  const [open, setOpen] = useState(false);
  const short: Record<Lang, string> = { uz: "Oʻz", ru: "Ру", en: "En" };
  const full: [Lang, string][] = [["uz", "Oʻzbekcha"], ["ru", "Русский"], ["en", "English"]];

  // Apply locally AND persist to the profile, so LanguageSync (which snaps the
  // UI back to the saved preferred_language on reload) never overrides the
  // user's choice. Without the PATCH, a header switch was lost on next load.
  async function pick(code: Lang) {
    setLang(code);
    setOpen(false);
    if (!user) return;
    try {
      await api.patch("/auth/me", { preferred_language: code });
      await refreshUser();
    } catch {
      /* language still applied locally */
    }
  }
  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        className="tap"
        style={{ ...iconBtn, width: "auto", padding: "0 12px", gap: 6, fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 14 }}
      >
        <Icon name="globe" size={18} />
        <span className="hide-sm">{short[lang]}</span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 60 }} />
          <div className="anim-fade-up" style={{ position: "absolute", right: 0, top: 48, background: "var(--surface)", borderRadius: "var(--r-md)", boxShadow: "var(--sh-lg)", border: "1px solid var(--line)", padding: 6, zIndex: 70, minWidth: 130 }}>
            {full.map(([code, label]) => (
              <button
                key={code}
                onClick={() => pick(code)}
                className="tap"
                style={{
                  display: "flex", width: "100%", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: "var(--r-sm)", border: "none",
                  background: lang === code ? "var(--primary-tint)" : "transparent",
                  color: lang === code ? "var(--primary-press)" : "var(--ink-soft)",
                  fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14, textAlign: "left", cursor: "pointer",
                }}
              >
                {label}
                {lang === code && <Icon name="check" size={15} sw={3} style={{ marginLeft: "auto" }} />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Sidebar ───────────────────────────────────────────── */
function Sidebar({ mobileOpen, setMobileOpen }: { mobileOpen: boolean; setMobileOpen: (v: boolean) => void }) {
  const { user } = useAuth();
  const { t } = useI18n();
  const { streak } = useStudentStats();
  const items = useNavItems();
  if (!user) return null;

  return (
    <>
      {mobileOpen && (
        <div onClick={() => setMobileOpen(false)} style={{ position: "fixed", inset: 0, background: "oklch(0.3 0.02 60 / 0.4)", zIndex: 40 }} className="mobile-only" />
      )}
      <aside
        className={`gov-sidebar ${mobileOpen ? "open" : ""}`}
        style={{ width: 250, flexShrink: 0, background: "var(--surface)", borderRight: "1px solid var(--line)", display: "flex", flexDirection: "column", padding: "20px 16px", zIndex: 50 }}
      >
        <NavLink to="/" onClick={() => setMobileOpen(false)} style={{ padding: "4px 8px 22px", textDecoration: "none" }}>
          <Logo />
        </NavLink>
        <nav className="col gap-1" style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          {items.map((it) =>
            it.heading ? (
              <div
                key={`h-${it.label}`}
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  color: "var(--faint)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  padding: "14px 14px 4px",
                }}
              >
                {it.label}
              </div>
            ) : (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.to === "/" || it.to === "/teacher" || it.to === "/admin"}
              onClick={() => setMobileOpen(false)}
              className="tap"
              style={({ isActive }) => ({
                display: "flex", alignItems: "center", gap: 13, padding: "12px 14px", borderRadius: "var(--r-sm)", border: "none", textDecoration: "none",
                background: isActive ? "var(--primary-tint)" : "transparent",
                color: isActive ? "var(--primary-press)" : "var(--ink-soft)",
                fontFamily: "var(--font-display)", fontWeight: isActive ? 800 : 700, fontSize: 15.5, transition: "background .15s, color .15s",
              })}
            >
              <Icon name={it.icon} size={21} />
              <span className="grow">{it.label}</span>
              {it.badge ? (
                <span style={{ background: "var(--danger)", color: "#fff", fontSize: 11, fontWeight: 800, borderRadius: 999, minWidth: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>{it.badge}</span>
              ) : null}
            </NavLink>
          ))}

          {/* Contact — external Telegram links, shown for everyone */}
          <div
            style={{
              fontSize: 11,
              fontWeight: 800,
              color: "var(--faint)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              padding: "14px 14px 4px",
            }}
          >
            {t("contactHeading")}
          </div>
          {[
            { href: TELEGRAM_SUPPORT_URL, icon: "message" as const, label: t("tgSupport") },
            { href: TELEGRAM_CHANNEL_URL, icon: "send" as const, label: t("tgChannel") },
          ].map((c) => (
            <a
              key={c.label}
              href={c.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setMobileOpen(false)}
              className="tap"
              style={{
                display: "flex", alignItems: "center", gap: 13, padding: "12px 14px", borderRadius: "var(--r-sm)", textDecoration: "none",
                background: "transparent", color: "var(--ink-soft)",
                fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15.5,
              }}
            >
              <Icon name={c.icon} size={21} />
              <span className="grow">{c.label}</span>
              <Icon name="link" size={15} style={{ color: "var(--faint)" }} />
            </a>
          ))}
        </nav>

        {user.role === "student" && streak > 0 && (
          <div style={{ background: "var(--surface-2)", borderRadius: "var(--r-md)", padding: 14, marginBottom: 12, overflow: "hidden" }}>
            <div className="row gap-3" style={{ alignItems: "center" }}>
              <Mascot size={46} float={false} mood="happy" />
              <div className="col">
                <span style={{ fontWeight: 800, fontFamily: "var(--font-display)", fontSize: 14 }}>{t("continueLabel")} 🔥</span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{streak} {t("streakUnit")}</span>
              </div>
            </div>
          </div>
        )}

        <NavLink
          to="/settings"
          onClick={() => setMobileOpen(false)}
          className="tap"
          style={{ display: "flex", alignItems: "center", gap: 12, borderRadius: "var(--r-md)", background: "var(--surface-2)", padding: 12, textDecoration: "none", color: "var(--ink)" }}
        >
          <Avatar name={user.full_name} size={38} />
          <div className="col" style={{ minWidth: 0 }}>
            <span className="truncate" style={{ fontSize: 14, fontWeight: 800, fontFamily: "var(--font-display)" }}>{user.full_name}</span>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{roleLabel(user.role, t)}</span>
          </div>
        </NavLink>
      </aside>
    </>
  );
}

/* ─── Notification bell ─────────────────────────────────── */
function NotificationBell() {
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ["notif-unread"],
    queryFn: async () => (await api.get<{ count: number }>("/notifications/unread-count")).data,
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });
  const count = data?.count ?? 0;
  return (
    <button onClick={() => navigate("/notifications")} aria-label="notifications" className="tap" style={iconBtn}>
      <Icon name="bell" size={21} />
      {count > 0 && (
        <span style={{ position: "absolute", top: 6, right: 7, minWidth: 17, height: 17, padding: "0 4px", borderRadius: 999, background: "var(--danger)", color: "#fff", fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid var(--surface)" }}>
          {count > 9 ? "9+" : count}
        </span>
      )}
    </button>
  );
}

/* ─── User menu ─────────────────────────────────────────── */
function UserMenu() {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  if (!user) return null;
  const items: [string, string, IconName][] = [
    ["/settings", t("settings"), "settings"],
    ["/notifications", t("notifTitle"), "bell"],
  ];
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen(!open)} className="tap" style={{ display: "flex", alignItems: "center", gap: 10, border: "none", background: "transparent", cursor: "pointer", paddingLeft: 8, borderLeft: "1px solid var(--line)" }}>
        <Avatar name={user.full_name} size={38} />
        <div className="col hide-sm" style={{ minWidth: 0, alignItems: "flex-start" }}>
          <span className="truncate" style={{ fontSize: 14, fontWeight: 800, fontFamily: "var(--font-display)" }}>{user.full_name}</span>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{roleLabel(user.role, t)}</span>
        </div>
        <Icon name="chevD" size={16} style={{ color: "var(--faint)" }} className="hide-sm" />
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 55 }} />
          <div className="anim-fade-up" style={{ position: "absolute", right: 0, top: 52, width: 232, background: "var(--surface)", borderRadius: "var(--r-md)", boxShadow: "var(--sh-lg)", border: "1px solid var(--line)", padding: 8, zIndex: 60 }}>
            <div className="row gap-3" style={{ padding: "8px 10px 12px", borderBottom: "1px solid var(--line)", marginBottom: 6 }}>
              <Avatar name={user.full_name} size={40} />
              <div className="col" style={{ minWidth: 0 }}>
                <span className="truncate" style={{ fontSize: 14, fontWeight: 800, fontFamily: "var(--font-display)" }}>{user.full_name}</span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{roleLabel(user.role, t)}</span>
              </div>
            </div>
            {items.map(([to, label, icon], i) => (
              <button key={i} onClick={() => { navigate(to); setOpen(false); }} className="tap" style={menuItem}>
                <Icon name={icon} size={18} />
                {label}
              </button>
            ))}
            <div style={{ height: 1, background: "var(--line)", margin: "6px 0" }} />
            <button onClick={() => { logout(); setOpen(false); }} className="tap" style={{ ...menuItem, color: "var(--danger)" }}>
              <Icon name="logout" size={18} />
              {t("logout")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
const menuItem = {
  display: "flex", width: "100%", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: "var(--r-sm)", border: "none", background: "transparent",
  color: "var(--ink-soft)", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14.5, textAlign: "left" as const, cursor: "pointer",
};

/* ─── Top bar ───────────────────────────────────────────── */
function TopBar({ onMenu }: { onMenu: () => void }) {
  const { user } = useAuth();
  const { t } = useI18n();
  const loc = useLocation();
  const navigate = useNavigate();
  const items = useNavItems();
  const { doneCount } = useStudentStats();
  if (!user) return null;
  const active = bestMatch(items, loc.pathname);
  // Titles for routes that aren't primary nav items (settings, detail pages, …).
  const extraTitles: [string, string][] = [
    ["/settings", t("settings")],
    ["/notifications", t("notifTitle")],
    ["/premium", t("premium")],
    ["/assignments", t("assignmentsTitle")],
    ["/review", t("reviewTitle")],
    ["/submissions", t("result")],
    ["/teacher/topics", t("topicsTitle")],
    ["/teacher/assignments", t("assignmentsTitle")],
    ["/teacher/questions/new", t("newTest")],
  ];
  const navTitle = items.find((i) => i.to === active)?.label;
  const extraTitle = extraTitles.find(([p]) => loc.pathname === p || loc.pathname.startsWith(p + "/"))?.[1];
  const title = navTitle || extraTitle || t("appName");
  const used = Math.min(doneCount, FREE_ATTEMPT_LIMIT);
  const left = FREE_ATTEMPT_LIMIT - used;

  return (
    <header style={{ height: "var(--header-h)", flexShrink: 0, borderBottom: "1px solid var(--line)", background: "var(--surface)", display: "flex", alignItems: "center", gap: 14, padding: "0 20px", position: "relative", zIndex: 30 }}>
      <button className="mobile-only tap" onClick={onMenu} style={iconBtn}>
        <Icon name="menu" size={22} />
      </button>
      <h2 className="truncate" style={{ fontSize: 20, lineHeight: 1.1, flex: 1, minWidth: 0 }}>{title}</h2>

      {user.role === "student" && !user.is_premium && (
        <button onClick={() => navigate("/premium")} className="tap row gap-2 hide-sm" title={t("premiumAccess")} style={{ background: "var(--primary-tint)", border: "none", cursor: "pointer", borderRadius: "var(--r-pill)", padding: "6px 12px" }}>
          <AttemptDots used={used} total={FREE_ATTEMPT_LIMIT} />
          <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--primary-press)", fontFamily: "var(--font-display)" }}>{left} {t("attempts")}</span>
        </button>
      )}
      {user.role === "student" && user.is_premium && (
        <span className="hide-sm">
          <Pill hue={80} icon="star" solid>{t("premium")}</Pill>
        </span>
      )}

      <LangSwitcher />
      <NotificationBell />
      <UserMenu />
    </header>
  );
}

/* ─── Bottom nav (mobile) ───────────────────────────────── */
function BottomNav() {
  const { user } = useAuth();
  const loc = useLocation();
  const items = useNavItems();
  if (!user) return null;
  const active = bestMatch(items, loc.pathname);
  return (
    <nav className="bottom-nav">
      {items.map((it) => {
        const isActive = active === it.to;
        return (
          <NavLink
            key={it.to}
            to={it.to}
            className="tap"
            style={{
              flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "8px 0", border: "none", background: "transparent", textDecoration: "none",
              color: isActive ? "var(--primary)" : "var(--muted)", fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 11.5,
            }}
          >
            <Icon name={it.icon} size={24} sw={isActive ? 2.4 : 2} />
            {it.label}
          </NavLink>
        );
      })}
    </nav>
  );
}

/** Root route — student dashboard, or redirect to role home. */
function Home() {
  const { user } = useAuth();
  if (user?.role === "admin") return <Navigate to="/admin" replace />;
  if (user?.role === "teacher") return <Navigate to="/teacher" replace />;
  return <StudentHome />;
}

/** Sync the saved UI language with the logged-in user's preference once. */
function LanguageSync() {
  const { user } = useAuth();
  const { lang, setLang } = useI18n();
  useEffect(() => {
    const pref = user?.preferred_language as Lang | undefined;
    if (pref && pref !== lang && ["uz", "ru", "en"].includes(pref)) setLang(pref);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  return null;
}

/* ─── App routes (authenticated) ────────────────────────── */
function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/questions" element={<StudentQuestions />} />
      <Route path="/questions/:id/answer" element={<AnswerQuestion />} />
      <Route path="/submissions/:id" element={<SubmissionResult />} />
      <Route path="/progress" element={<StudentProgress />} />
      <Route path="/leaderboard" element={<Leaderboard />} />
      <Route path="/review" element={<Review />} />
      <Route path="/shadowing" element={<Shadowing />} />
      <Route path="/notifications" element={<Notifications />} />
      <Route path="/assignments" element={<StudentAssignments />} />
      <Route path="/premium" element={<PremiumInfo />} />
      <Route path="/teacher" element={<TeacherDashboard />} />
      <Route path="/teacher/blocks" element={<TeacherBlocks />} />
      <Route path="/teacher/assignments" element={<TeacherAssignments />} />
      <Route path="/teacher/groups" element={<TeacherGroups />} />
      <Route path="/teacher/groups/:id" element={<TeacherGroupDetail />} />
      <Route path="/teacher/gradebook" element={<TeacherGradebook />} />
      <Route path="/teacher/students" element={<TeacherStudents />} />
      <Route path="/teacher/questions" element={<TeacherQuestions />} />
      <Route path="/teacher/questions/new" element={<CreateQuestion />} />
      <Route path="/teacher/questions/:id/edit" element={<CreateQuestion />} />
      <Route path="/teacher/submissions" element={<TeacherSubmissions />} />
      <Route path="/teacher/topics" element={<TeacherTopics />} />
      <Route path="/admin" element={<AdminDashboard />} />
      <Route path="/admin/teachers" element={<AdminTeachers />} />
      <Route path="/admin/teachers/:id" element={<AdminTeacherDetail />} />
      <Route path="/admin/students" element={<AdminStudents />} />
      <Route path="/admin/students/:id" element={<AdminStudentDetail />} />
      <Route path="/admin/tests" element={<AdminTests />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export default function App() {
  const { user, loading } = useAuth();
  const loc = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (loading) {
    return (
      <div className="app-shell" style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
        <Loading />
      </div>
    );
  }

  // Unauthenticated → full-screen auth, no shell.
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // Phone is mandatory for students and teachers (e.g. Google sign-ups, or older
  // accounts created before phone existed). Students must also have an address —
  // gate the app on the complete-profile step until everything is provided.
  const needsProfile =
    user.role !== "admin" &&
    (!user.phone || (user.role === "student" && (!user.age || !user.region)));
  if (needsProfile) {
    return <CompleteProfile />;
  }

  return (
    <div className="app-shell" style={{ display: "flex", background: "var(--bg)" }}>
      <LanguageSync />
      <Sidebar mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} />
      <div className="col" style={{ flex: 1, minWidth: 0 }}>
        <TopBar onMenu={() => setMobileOpen(true)} />
        <main style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }} key={loc.pathname}>
          <div className="page anim-fade-up">
            <AppRoutes />
          </div>
        </main>
        {user.role === "student" && <BottomNav />}
      </div>
    </div>
  );
}
