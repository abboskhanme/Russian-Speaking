/**
 * ProfilePage (`/profile`) — the real Profile. Identity comes from the auth
 * store (`/api/auth/me`); the premium card reflects `is_premium`; Logout calls
 * `logout()` and returns to `/login`. The language selector switches i18n live
 * and persists the choice. Settings are local-only for now (no endpoint yet).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ProfileScreen } from "../../screens/profile";
import type {
  AppLanguage,
  ProfilePremium,
  ProfileSettings,
  ProfileUser,
} from "../../screens/profile";
import { setLang } from "../../shared/i18n";
import { useAuth } from "../../shared/auth";
import { useNavHandler } from "../nav";

export default function ProfilePage() {
  const onNavigate = useNavHandler();
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const { user, logout } = useAuth();

  const language = ((["uz", "ru", "en"] as const).includes(i18n.language as AppLanguage)
    ? i18n.language
    : "uz") as AppLanguage;

  // Settings have no backend endpoint yet → local state (persists for the session).
  const [settings, setSettings] = useState<ProfileSettings>({
    dailyGoalMinutes: 5,
    notifications: true,
  });

  const profileUser: ProfileUser = {
    name: user?.full_name ?? "",
    email: user?.email ?? "",
    verified: user?.is_active ?? false,
  };

  const premium: ProfilePremium = user?.is_premium
    ? { active: true }
    : { active: false };

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <ProfileScreen
      user={profileUser}
      premium={premium}
      language={language}
      settings={settings}
      onChangeLanguage={(lang) => setLang(lang)}
      onUpgrade={() => undefined}
      onEditSetting={(key) =>
        key === "notifications"
          ? setSettings((s) => ({ ...s, notifications: !s.notifications }))
          : undefined
      }
      onLogout={handleLogout}
      activeNavKey="profile"
      onNavigate={onNavigate}
    />
  );
}
