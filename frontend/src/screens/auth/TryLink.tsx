/**
 * TryLink — the secondary "experience the system before signing up" text link shown low on BOTH the
 * login and register screens (product: try the level test without an account). Deliberately a subtle
 * text link (not a big button) → the public `/try` guest placement flow. i18n via `auth.tryLink`.
 */
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import styles from "./Auth.module.css";

export function TryLink() {
  const { t } = useTranslation();
  return (
    <Link to="/try" className={styles.tryLink}>
      {t("auth.tryLink")}
    </Link>
  );
}
