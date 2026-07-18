/**
 * ProfilePage (`/profile`) — wires the presentational ProfileScreen to the
 * router + mock fixture. The language selector is wired to the real i18n
 * instance, so switching it changes the app language live. Lazy-loaded.
 */
import { useTranslation } from "react-i18next";
import {
  ProfileScreen,
  mockPremium,
  mockProfileUser,
  mockSettings,
} from "../../screens/profile";
import type { AppLanguage } from "../../screens/profile";
import { setLang } from "../../shared/i18n";
import { useNavHandler } from "../nav";

export default function ProfilePage() {
  const onNavigate = useNavHandler();
  const { i18n } = useTranslation();
  const language = ((["uz", "ru", "en"] as const).includes(
    i18n.language as AppLanguage,
  )
    ? i18n.language
    : "uz") as AppLanguage;

  return (
    <ProfileScreen
      user={mockProfileUser}
      premium={mockPremium}
      language={language}
      settings={mockSettings}
      onChangeLanguage={(lang) => setLang(lang)}
      onUpgrade={() => undefined}
      onEditSetting={() => undefined}
      onLogout={() => undefined}
      activeNavKey="profile"
      onNavigate={onNavigate}
    />
  );
}
