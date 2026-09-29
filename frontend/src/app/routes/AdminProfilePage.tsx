/**
 * AdminProfilePage (`/admin/profile`) — the admin's own account, opened from the
 * header avatar on every admin screen.
 *
 *   • identity from the auth context (`GET /api/auth/me`)
 *   • `GET /api/settings/links` → the Yordam modal
 *   • `PATCH /api/auth/me`      ← the Ma'lumot edit, the notification switch and the
 *                                  interface language (`preferred_language`)
 *   • phone change / avatar     ← the same endpoints every other profile uses
 *
 * The handlers mirror {@link TeacherProfilePage} deliberately — same endpoints, same
 * error contract (rejections propagate so the dialogs report inline instead of
 * closing as if the change had landed), same `loadMe`/`hydrateUser` refresh.
 *
 * Unlike the teacher page nothing here is load-bearing but identity, which the auth
 * guard already holds, so the page renders at once and the help links fill in.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AdminProfileScreen } from "../../screens/admin";
import type { AdminProfileTabKey } from "../../screens/admin";
import type { EditableInfo, ProfileUser, SettingsLanguage } from "../../screens/profile";
import { endpoints } from "../../shared/api";
import { useAuth } from "../../shared/auth";
import { getLang, setLang } from "../../shared/i18n";
import type { AppLang } from "../../shared/i18n";
import { applyTheme, getEffectiveTheme, storeTheme } from "../../widgets";
import type { ThemeMode } from "../../widgets";
import { PageError } from "../PageState";
import { ADMIN_NAV_PATH, useAdminNavHandler } from "../nav";

const TABS: AdminProfileTabKey[] = ["info", "settings"];

export default function AdminProfilePage() {
  const { user, logout, loadMe, hydrateUser } = useAuth();
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const onNavigate = useAdminNavHandler();
  const [params, setParams] = useSearchParams();

  const rawTab = params.get("tab");
  const tab: AdminProfileTabKey = TABS.includes(rawTab as AdminProfileTabKey)
    ? (rawTab as AdminProfileTabKey)
    : "info";

  const [links, setLinks] = useState<{ tgSupportUrl: string; tgChannelUrl: string } | null>(null);
  const [theme, setTheme] = useState<ThemeMode>(() => getEffectiveTheme());
  const [notifications, setNotifications] = useState(true);

  useEffect(() => {
    let alive = true;
    // Not load-bearing: without it only the Yordam sheet loses its two links.
    endpoints
      .settingsLinks()
      .then((l) => alive && setLinks({ tgSupportUrl: l.tg_support_url, tgChannelUrl: l.tg_channel_url }))
      .catch(() => alive && setLinks(null));
    return () => {
      alive = false;
    };
  }, []);

  // Adopt the stored preference whenever identity (re)loads.
  useEffect(() => {
    if (user) setNotifications(user.notifications_enabled);
  }, [user]);

  const setTab = useCallback(
    (key: AdminProfileTabKey) => {
      const next = new URLSearchParams(params);
      if (key === "info") next.delete("tab");
      else next.set("tab", key);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const handleSaveInfo = useCallback(
    async ({ fullName, region, district }: EditableInfo) => {
      await endpoints.updateProfile({
        full_name: fullName,
        // Tri-state PATCH: `undefined` leaves the stored value alone.
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
      await loadMe();
    },
    [loadMe],
  );

  const handleChangeAvatar = useCallback(
    async (file: File) => hydrateUser(await endpoints.uploadAvatar(file)),
    [hydrateUser],
  );

  const handleRemoveAvatar = useCallback(
    async () => hydrateUser(await endpoints.removeAvatar()),
    [hydrateUser],
  );

  /** Apply immediately, then persist to the ACCOUNT so the choice follows the admin
   * to another device. A failed write puts the previous language back rather than
   * leaving a choice on screen that the next device will not see. */
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

  /** Theme stays per-device on purpose, as on every other profile. */
  const changeTheme = useCallback((next: ThemeMode) => {
    applyTheme(next);
    storeTheme(next);
    setTheme(next);
  }, []);

  /** Optimistic, reverted on failure — the same contract as the other profiles. */
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

  if (!user) return <PageError onRetry={() => void loadMe()} />;

  const profileUser: ProfileUser = {
    name: user.full_name,
    phone: user.phone,
    region: user.region,
    district: user.district,
    level: null,
    levelLabel: null,
    registeredAt: user.created_at,
    avatarUrl: user.avatar_url ?? undefined,
    verified: user.is_active,
  };

  return (
    <AdminProfileScreen
      user={profileUser}
      language={language}
      theme={theme}
      notifications={notifications}
      links={links}
      activeTab={tab}
      onChangeTab={setTab}
      activeNavKey="home"
      onNavigate={onNavigate}
      onBack={() => navigate(ADMIN_NAV_PATH.home)}
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
