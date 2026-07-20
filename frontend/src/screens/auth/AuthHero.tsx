/**
 * AuthHero — the orange hero + segmented Kirish / Ro'yxatdan o'tish toggle that
 * tops both auth screens (mockup "1 · KIRISH", frame A1). The wordmark reuses
 * `Brand` (recoloured white for the primary hero), the mascot reuses `Mascot`
 * (idle Govo). The toggle is real navigation — each half is a `<Link>` to
 * `/login` or `/register`, with `active` marking the current route's pill.
 */
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Mascot, Text } from "../../shared/ui";
import { Brand } from "../../widgets";
import styles from "./Auth.module.css";

export interface AuthHeroProps {
  active: "login" | "register";
}

export function AuthHero({ active }: AuthHeroProps) {
  const { t } = useTranslation();
  return (
    <>
      <header className={styles.hero}>
        <div className={styles.heroInner}>
          <Brand className={styles.heroBrand} style={{ color: "var(--primary-on)" }} />
          <Mascot mood="idle" size={78} label="Govo" className={styles.heroMascot} />
          <Text as="h1" variant="title-m" className={styles.heroTitle}>
            {t("auth.hero.tagline")}
          </Text>
          <Text as="p" variant="body-s" className={styles.heroSub}>
            {t("auth.hero.taglineRu")}
          </Text>
        </div>
      </header>

      <nav className={styles.tabs} aria-label={t("auth.hero.tabsAria")}>
        <Link
          to="/login"
          className={styles.tab}
          data-active={active === "login" || undefined}
          aria-current={active === "login" ? "page" : undefined}
        >
          {t("auth.hero.login")}
        </Link>
        <Link
          to="/register"
          className={styles.tab}
          data-active={active === "register" || undefined}
          aria-current={active === "register" ? "page" : undefined}
        >
          {t("auth.hero.register")}
        </Link>
      </nav>
    </>
  );
}
