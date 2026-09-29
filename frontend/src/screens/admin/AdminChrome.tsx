import { createContext, useContext } from "react";
import { useTranslation } from "react-i18next";
import styles from "./AdminChrome.module.css";

/**
 * The signed-in admin, as the panel's header needs them: who, and where their own
 * account lives. Provided once by the `/admin/*` layout route rather than threaded
 * through every screen's props — like `NotificationsBell`, the header avatar is
 * self-managing, because it renders in every admin header and passing the same two
 * values into five screens would be noise.
 *
 * Absent (a screen rendered on its own, a test, a demo) → the avatar renders
 * nothing, so presentational screens stay renderable without an auth context.
 */
export interface AdminChromeValue {
  fullName: string;
  onOpenProfile: () => void;
}

export const AdminChromeContext = createContext<AdminChromeValue | null>(null);

/** "Admin Demo" → "AD". */
function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * The header avatar — the admin's ONLY way to their own account (profile, language,
 * theme, sign out). The admin nav has no Profil item by design; before this button
 * existed an admin could not even log out.
 *
 * Same geometry as the bell beside it (44px, the touch-target rule), so the top bar
 * keeps its rhythm.
 */
export function AdminAccountButton() {
  const { t } = useTranslation();
  const chrome = useContext(AdminChromeContext);
  if (!chrome) return null;

  return (
    <button
      type="button"
      className={styles.avatar}
      onClick={chrome.onOpenProfile}
      aria-label={t("admin.avatarAria")}
      title={chrome.fullName}
    >
      <span aria-hidden>{initialsOf(chrome.fullName) || "·"}</span>
    </button>
  );
}
