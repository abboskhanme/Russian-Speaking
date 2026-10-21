import { useTranslation } from "react-i18next";
import styles from "./AccountButton.module.css";

export interface AccountButtonProps {
  /** The signed-in person's name — initials on the button, full name as tooltip. */
  fullName: string;
  /** Opens their own account page (profile, language, theme, sign out). */
  onOpen: () => void;
}

/** "Admin Demo" → "AD". */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * AccountButton — the header avatar. Every role layout puts it at the right end of
 * the top bar, after the bell, so the cluster is the same on every page of every
 * role. For teachers and admins it is the only way to their own account (their nav
 * has no Profil item); for students it mirrors the Profil tab.
 */
export function AccountButton({ fullName, onOpen }: AccountButtonProps) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className={styles.avatar}
      onClick={onOpen}
      aria-label={t("nav.account")}
      title={fullName || undefined}
    >
      <span aria-hidden>{initialsOf(fullName) || "·"}</span>
    </button>
  );
}
