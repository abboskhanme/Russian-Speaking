/**
 * TeacherProfilePage (`/teacher/profile`) — Phase 7. The destination of the A1
 * header avatar, which is the teacher panel's only profile entry (its nav bar is
 * `Bosh · Klasslar · Navbat · Kontent · Analitika`, with no Profil item).
 *
 *   • identity from the auth context (`GET /api/auth/me`)
 *   • `GET /api/groups`         → GURUHLARIM
 *   • `GET /api/settings/links` → the Yordam modal
 *   • `PATCH /api/auth/me`      ← the Ma'lumot edit + the notification switch
 *   • phone change / avatar     ← the same endpoints the student profile uses
 *
 * The avatar has navigated here since Phase 1; until this route existed the path
 * fell through to the `*` catch-all and bounced straight back to Obzor.
 *
 * The handlers mirror {@link ProfilePage} deliberately — same endpoints, same
 * error contract (rejections propagate so the dialogs can report inline instead
 * of closing as if the change had landed), same `loadMe`/`hydrateUser` refresh so
 * the header, the identity card and the rows all repaint from one source.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { TeacherProfileScreen } from "../../screens/teacher";
import type { TeacherProfileGroup, TeacherProfileTabKey } from "../../screens/teacher";
import type { EditableInfo, ProfileUser, SettingsLanguage } from "../../screens/profile";
import { endpoints } from "../../shared/api";
import type { GroupResponse } from "../../shared/api";
import { useAuth } from "../../shared/auth";
import { getLang, setLang } from "../../shared/i18n";
import type { AppLang } from "../../shared/i18n";
import { applyTheme, getEffectiveTheme, storeTheme } from "../../widgets";
import type { ThemeMode } from "../../widgets";
import { PageError, PageLoading } from "../PageState";
import { useTeacherNavHandler } from "../nav";

const TABS: TeacherProfileTabKey[] = ["info", "settings"];

export default function TeacherProfilePage() {
  const { user, logout, loadMe, hydrateUser } = useAuth();
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const onNavigate = useTeacherNavHandler();
  const [params, setParams] = useSearchParams();

  const rawTab = params.get("tab");
  const tab: TeacherProfileTabKey = TABS.includes(rawTab as TeacherProfileTabKey)
    ? (rawTab as TeacherProfileTabKey)
    : "info";

  const [groups, setGroups] = useState<GroupResponse[]>([]);
  const [links, setLinks] = useState<{ tgSupportUrl: string; tgChannelUrl: string } | null>(null);
  const [queued, setQueued] = useState(0);
  const [theme, setTheme] = useState<ThemeMode>(() => getEffectiveTheme());
  const [notifications, setNotifications] = useState(true);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);

    // The queue count is fetched for the nav FAB's badge. It is not decoration:
    // the badge is on every other teacher screen, so dropping it on this one
    // reads as "the queue emptied" rather than "this page didn't ask".
    Promise.allSettled([
      endpoints.teacherGroups(),
      endpoints.teacherReviewCount(),
      endpoints.settingsLinks(),
    ])
      .then(([g, q, l]) => {
        if (!alive) return;
        if (g.status === "fulfilled") setGroups(g.value);
        else setFailed(true);
        setQueued(q.status === "fulfilled" ? q.value.count : 0);
        setLinks(
          l.status === "fulfilled"
            ? { tgSupportUrl: l.value.tg_support_url, tgChannelUrl: l.value.tg_channel_url }
            : null,
        );
      })
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, [reloadKey]);

  // Adopt the stored preference whenever identity (re)loads.
  useEffect(() => {
    if (user) setNotifications(user.notifications_enabled);
  }, [user]);

  const groupOptions = useMemo<TeacherProfileGroup[]>(
    () => groups.map((g) => ({ id: g.id, name: g.name, memberCount: g.member_count })),
    [groups],
  );

  const setTab = useCallback(
    (key: TeacherProfileTabKey) => {
      const next = new URLSearchParams(params);
      if (key === "info") next.delete("tab");
      else next.set("tab", key);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  /* ---- Ma'lumot: the two editing flows --------------------------------- *
   * Rejections propagate on purpose: the dialog is what decides whether a 409
   * means "already registered" or a 401 means "wrong code", and it stays open to
   * say so. Swallowing here would close it as if the change had landed. */

  const handleSaveInfo = useCallback(
    async ({ fullName, region, district }: EditableInfo) => {
      await endpoints.updateProfile({
        full_name: fullName,
        // Tri-state PATCH: `undefined` leaves the stored value alone. The dialog
        // only ever returns an empty region together with an empty district, so
        // the pair moves as a unit and cannot end up half-updated.
        region: region || undefined,
        district: district || undefined,
      });
      await loadMe();
    },
    [loadMe],
  );

  const handleRequestPhoneChange = useCallback(
    (phoneE164: string) => endpoints.phoneChangeRequest(phoneE164),
    [],
  );

  const handleConfirmPhoneChange = useCallback(
    async (code: string) => {
      await endpoints.phoneChangeConfirm(code);
      // The user id is unchanged, so the session survives — only identity has to
      // be re-read.
      await loadMe();
    },
    [loadMe],
  );

  /* ---- Identity card: avatar ------------------------------------------- */

  const handleChangeAvatar = useCallback(
    async (file: File) => hydrateUser(await endpoints.uploadAvatar(file)),
    [hydrateUser],
  );

  const handleRemoveAvatar = useCallback(
    async () => hydrateUser(await endpoints.removeAvatar()),
    [hydrateUser],
  );

  /* ---- Sozlamalar ------------------------------------------------------ */

  /** Apply immediately, then persist to the ACCOUNT so the choice follows the
   * teacher to another device. Theme stays per-device on purpose. */
  const changeLanguage = useCallback(
    (lang: SettingsLanguage) => {
      const previous = getLang();
      setLang(lang as AppLang);
      endpoints
        .updateProfile({ preferred_language: lang })
        .then(loadMe)
        .catch(() => setLang(previous));
    },
    [loadMe],
  );

  const changeTheme = useCallback((next: ThemeMode) => {
    applyTheme(next);
    storeTheme(next);
    setTheme(next);
  }, []);

  /** Optimistic: the switch moves at once, because a settings toggle that waits
   * on a round-trip feels broken. A failure puts it back — the one outcome worse
   * than a slow switch is one that lies about what was saved. */
  const changeNotifications = useCallback(
    (next: boolean) => {
      const previous = notifications;
      setNotifications(next);
      endpoints
        .updateProfile({ notifications_enabled: next })
        .then(loadMe)
        .catch(() => setNotifications(previous));
    },
    [notifications, loadMe],
  );

  const handleLogout = useCallback(() => {
    logout();
    navigate("/login", { replace: true });
  }, [logout, navigate]);

  const language = ((["uz", "ru", "en"] as const).includes(i18n.language as SettingsLanguage)
    ? i18n.language
    : "uz") as SettingsLanguage;

  if (loading) return <PageLoading />;
  if (failed || !user) return <PageError onRetry={() => setReloadKey((k) => k + 1)} />;

  const profileUser: ProfileUser = {
    name: user.full_name,
    phone: user.phone,
    region: user.region,
    district: user.district,
    // A teacher has no CEFR band — InfoTab's `showLevel={false}` hides the row
    // rather than printing "kiritilmagan" against a number that never arrives.
    level: null,
    levelLabel: null,
    registeredAt: user.created_at,
    avatarUrl: user.avatar_url ?? undefined,
    verified: user.is_active,
  };

  return (
    <TeacherProfileScreen
      user={profileUser}
      groups={groupOptions}
      language={language}
      theme={theme}
      notifications={notifications}
      links={links}
      activeTab={tab}
      onChangeTab={setTab}
      activeNavKey="home"
      onNavigate={onNavigate}
      queuedCount={queued}
      onBack={() => navigate("/teacher")}
      onOpenGroup={(id) => navigate(`/teacher/classes/${id}`)}
      onSaveInfo={handleSaveInfo}
      onRequestPhoneChange={handleRequestPhoneChange}
      onConfirmPhoneChange={handleConfirmPhoneChange}
      onChangeAvatar={handleChangeAvatar}
      onRemoveAvatar={handleRemoveAvatar}
      onChangeLanguage={changeLanguage}
      onChangeTheme={changeTheme}
      onChangeNotifications={changeNotifications}
      onLogout={handleLogout}
    />
  );
}
