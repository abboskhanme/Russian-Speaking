/**
 * AuthLangSwitch — the compact UZ · RU · EN switch on the login and register
 * pages (UI audit: there was no way to change the language before signing in;
 * the only switch lived in Profile).
 *
 * Persists exactly like the profile switch does before the server is involved:
 * `setLang()` (i18next + localStorage `govori_lang`). Once signed in, the
 * account's saved language takes over — except for an account created a moment
 * ago, which adopts this choice instead (AuthContext).
 */
import { useTranslation } from "react-i18next";
import { LANG_LABELS, SUPPORTED_LANGS, getLang, setLang } from "../../shared/i18n";
import styles from "./Auth.module.css";

export function AuthLangSwitch({ className }: { className?: string }) {
  // useTranslation re-renders on a language change, so getLang() is current.
  const { t } = useTranslation();
  const current = getLang();
  return (
    <div
      role="group"
      aria-label={t("auth.langSwitch")}
      className={[styles.langSwitch, className].filter(Boolean).join(" ")}
    >
      {SUPPORTED_LANGS.map((lang) => (
        <button
          key={lang}
          type="button"
          lang={lang}
          className={styles.langOption}
          aria-pressed={lang === current}
          aria-label={LANG_LABELS[lang]}
          title={LANG_LABELS[lang]}
          onClick={() => {
            if (lang !== current) setLang(lang);
          }}
        >
          {lang.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
