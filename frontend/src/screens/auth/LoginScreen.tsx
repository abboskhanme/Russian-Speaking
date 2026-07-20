/**
 * LoginScreen (`/login`) — email + password sign-in (docs/08 auth slice,
 * priority #3). Composed from `shared/ui` (Card / Input / Button / Mascot /
 * Text) + tokens; i18n via `auth.*` keys. Submit → `login()` → navigate to the
 * page the guard bounced from (or `/`). A 401 shows "email/parol noto'g'ri",
 * a 403 shows the account-inactive message.
 */
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { Button, Card, Input, Mascot, Text } from "../../shared/ui";
import { Brand, ThemeToggle } from "../../widgets";
import { useAuth } from "../../shared/auth";
import { isApiError } from "../../shared/api";
import styles from "./Auth.module.css";

interface FromState {
  from?: { pathname?: string };
}

export default function LoginScreen() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = (location.state as FromState | null)?.from?.pathname ?? "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      if (isApiError(err)) {
        if (err.status === 401) setError(t("auth.errors.invalidCredentials"));
        else if (err.status === 403) setError(err.detail || t("auth.errors.inactive"));
        else if (err.status === 0) setError(t("auth.errors.network"));
        else setError(t("auth.errors.generic"));
      } else {
        setError(t("auth.errors.generic"));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.topbar}>
        <Brand />
        <ThemeToggle />
      </div>

      <div className={styles.body}>
        <Card variant="raised" padding="lg" className={styles.card}>
          <div className={styles.head}>
            <Mascot mood="idle" size={72} label="Govo" />
            <Text as="h1" variant="title-l">
              {t("auth.login.title")}
            </Text>
            <Text as="p" variant="body-l" color="ink-soft">
              {t("auth.login.subtitle")}
            </Text>
          </div>

          {error && (
            <div className={styles.error} role="alert">
              {error}
            </div>
          )}

          <form className={styles.form} onSubmit={onSubmit} noValidate>
            <Input
              label={t("auth.email")}
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              placeholder={t("auth.emailPlaceholder")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
            <Input
              label={t("auth.password")}
              type="password"
              name="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <Button type="submit" variant="primary" size="lg" fullWidth loading={busy}>
              {t("auth.login.submit")}
            </Button>
          </form>

          <div className={styles.footer}>
            <Text as="span" variant="body-s" color="muted">
              {t("auth.login.noAccount")}
            </Text>
            <Link to="/register" className={styles.link}>
              {t("auth.login.registerLink")}
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
