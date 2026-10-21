/**
 * RoleLayout — the route-level frame for one role's screens (student · teacher ·
 * admin). It renders the AppShell ONCE: logo, the role's nav (sidebar + bottom
 * bar, active item derived from the URL), and the top bar's right-hand cluster —
 * always the notifications bell then the account avatar, on every page of every
 * role. Screens render only `<Page title width>` inside it; the page's title is
 * portalled into the top bar's leading slot (see `widgets/Page`).
 *
 * Opting out: a route that must own the whole viewport (the `/task` recorder,
 * placement, a live chat) is simply declared OUTSIDE this layout element in
 * `App.tsx` — no flag, no prop on the screen.
 *
 * Nav items are one data-driven array per role (`navItemsFor` in app/features),
 * already filtered by the feature switches — so a switched-off destination is gone
 * from the sidebar and the bottom bar alike.
 */
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useFeatures, useOptionalAuth } from "../../shared/auth";
import { useUiLang } from "../../shared/i18n";
import { endpoints } from "../../shared/api";
import { Spinner } from "../../shared/ui";
import {
  AccountButton,
  AppShell,
  Brand,
  NotificationsBell,
  PageChromeContext,
} from "../../widgets";
import { navItemsFor } from "../features";
import type { NavRole } from "../features";
import {
  ADMIN_NAV_PATH,
  ADMIN_PROFILE_PATH,
  NAV_PATH,
  STUDENT_NAV_ALIASES,
  TEACHER_NAV_ALIASES,
  TEACHER_NAV_PATH,
  TEACHER_PROFILE_PATH,
  activeKeyForPath,
} from "../nav";

export type LayoutRole = NavRole;

interface RoleConfig {
  paths: Record<string, string>;
  aliases: Record<string, string>;
  profilePath: string;
}

const ROLE: Record<LayoutRole, RoleConfig> = {
  student: { paths: NAV_PATH, aliases: STUDENT_NAV_ALIASES, profilePath: NAV_PATH.profile },
  teacher: { paths: TEACHER_NAV_PATH, aliases: TEACHER_NAV_ALIASES, profilePath: TEACHER_PROFILE_PATH },
  admin: { paths: ADMIN_NAV_PATH, aliases: {}, profilePath: ADMIN_PROFILE_PATH },
};

/** The teacher's Navbat badge. Re-read on every navigation so it follows the
 * queue as the teacher works through it. */
function useQueuedCount(enabled: boolean, pathname: string): number {
  const [queued, setQueued] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    endpoints
      .teacherReviewCount()
      .then((r) => alive && setQueued(r.count))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [enabled, pathname]);
  return queued;
}

function ContentFallback() {
  const { t } = useTranslation();
  return (
    <div style={{ display: "grid", placeItems: "center", minHeight: "50vh" }}>
      <Spinner size="lg" label={t("common.loading")} />
    </div>
  );
}

export default function RoleLayout({ role, children }: { role: LayoutRole; children?: ReactNode }) {
  // Bound to the language explicitly: this frame mounts before `/me` can switch the
  // language, and a `t` that missed that switch left the nav in Uzbek around an English
  // page until the next navigation (see useUiLang).
  const { i18n } = useTranslation();
  const lang = useUiLang();
  const t = useMemo(() => i18n.getFixedT(lang), [i18n, lang]);
  // Optional: the frame must not take a screen down when rendered without auth
  // (a test, a demo) — the avatar just shows no initials then.
  const user = useOptionalAuth()?.user;
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const cfg = ROLE[role];

  const queued = useQueuedCount(role === "teacher", pathname);
  const { roleplay } = useFeatures();
  const items = useMemo(
    () => navItemsFor(role, t, { queued, features: { roleplay } }),
    [role, t, queued, roleplay],
  );
  const activeKey = activeKeyForPath(pathname, cfg.paths, cfg.aliases);

  const onNavigate = useCallback(
    (key: string) => {
      const path = cfg.paths[key];
      if (path) navigate(path);
    },
    [cfg, navigate],
  );

  // The top bar's leading slot. A callback ref into state, so pages re-render
  // (and portal their title in) once the node exists.
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  const chrome = useMemo(() => ({ headerSlot }), [headerSlot]);

  return (
    <PageChromeContext.Provider value={chrome}>
      <AppShell
        brand={<Brand />}
        nav={{ items, activeKey, onNavigate, label: t("nav.landmark") }}
        headerStart={<div ref={setHeaderSlot} data-header-slot="" />}
        headerEnd={
          <>
            <NotificationsBell />
            <AccountButton
              fullName={user?.full_name ?? ""}
              onOpen={() => navigate(cfg.profilePath)}
            />
          </>
        }
      >
        {/* Its own boundary, so a lazy page loading keeps the frame on screen. */}
        <Suspense fallback={<ContentFallback />}>
          {children ?? <Outlet />}
        </Suspense>
      </AppShell>
    </PageChromeContext.Provider>
  );
}
