/**
 * LoginScreen (`/login`) — phone + Telegram-bot OTP sign-in, rebuilt to the
 * mockup ("1 · KIRISH", frame A1 login). Two steps:
 *   1. phone → `requestOtp` → the code step.
 *   2. code → `verifyOtp` → tokens → navigate to the guard's redirect.
 * A new phone comes back as `needs_registration`: the code is consumed
 * server-side, so we send a fresh one, reveal the name field, and complete
 * registration on the next verify. Composed from `shared/ui` + Ovoz DS tokens;
 * i18n via `auth.*`. No email/password anywhere.
 */
import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "../../shared/ui";
import { ThemeToggle } from "../../widgets";
import { tokenStore, useAuth } from "../../shared/auth";
import { endpoints } from "../../shared/api";
import type { DevUserResponse, OtpRequestResponse } from "../../shared/api";
import { AuthHero } from "./AuthHero";
import { IconInput } from "./IconInput";
import { OtpStep } from "./OtpStep";
import { TryLink } from "./TryLink";
import { otpErrorKey, throttleFrom, throttleMessage, useThrottle } from "./throttle";
import { PhoneIcon, UserIcon } from "./icons";
import { formatDisplay, groupNational, isValidUz, nationalDigits, toE164 } from "./phone";
import styles from "./Auth.module.css";

interface FromState {
  from?: { pathname?: string };
}

export default function LoginScreen() {
  const { t } = useTranslation();
  const { requestOtp, verifyOtp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = (location.state as FromState | null)?.from?.pathname ?? "/";

  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState(""); // national digits (max 9)
  const [code, setCode] = useState("");
  const [otpInfo, setOtpInfo] = useState<OtpRequestResponse | null>(null);
  const [needsName, setNeedsName] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const e164 = toE164(phone);
  // The server's two 429s (see ./throttle): the per-phone resend cooldown, and the
  // lockout after too many wrong codes. Each counts itself down and clears at zero.
  const cooldown = useThrottle();
  const lockout = useThrottle();
  // A waiting line outranks any older error — it is the one that is true right now.
  const shownError = lockout.throttle
    ? throttleMessage(t, lockout.throttle, lockout.remainingSec)
    : cooldown.throttle
      ? throttleMessage(t, cooldown.throttle, cooldown.remainingSec)
      : error;

  /** Status → a localized sentence. Never the server's `detail` (English for some
   * refusals, Uzbek for others, whatever language this screen is in). */
  function mapError(err: unknown): string {
    return t(otpErrorKey(err));
  }

  /** A refused code REQUEST: a 429 with a wait starts the cooldown, anything else is an error. */
  function failRequest(err: unknown) {
    const wait = throttleFrom(err, "cooldown");
    if (wait) cooldown.start(wait);
    else setError(mapError(err));
  }

  async function submitPhone(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (!isValidUz(phone)) {
      setError(t("auth.errors.badPhone"));
      return;
    }
    setBusy(true);
    try {
      const res = await requestOtp(e164);
      setOtpInfo(res);
      setCode("");
      setStep("code");
    } catch (err) {
      failRequest(err);
    } finally {
      setBusy(false);
    }
  }

  async function submitCode() {
    if (busy) return;
    setError(null);
    setInfo(null);
    if (needsName && !name.trim()) {
      setError(t("auth.errors.nameRequired"));
      return;
    }
    setBusy(true);
    try {
      const res = await verifyOtp(e164, code, needsName ? name.trim() : undefined);
      if (res.needsRegistration) {
        // Unknown phone → registration. The verify just consumed the code, so
        // request a fresh one and reveal the name field to finish sign-up.
        setNeedsName(true);
        try {
          const fresh = await requestOtp(e164);
          setOtpInfo(fresh);
        } catch (err) {
          // Non-fatal — the user can hit resend; a cooldown still shows its wait.
          const wait = throttleFrom(err, "cooldown");
          if (wait) cooldown.start(wait);
        }
        setCode("");
        setInfo(t("auth.otp.needName"));
        return;
      }
      navigate(redirectTo, { replace: true });
    } catch (err) {
      // The lockout refuses even the right code: say how long, not "wrong code".
      const wait = throttleFrom(err, "lockout");
      if (wait) lockout.start(wait);
      else setError(mapError(err));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    setBusy(true);
    try {
      const res = await requestOtp(e164);
      setOtpInfo(res);
      setCode("");
      setInfo(t("auth.otp.resent"));
    } catch (err) {
      failRequest(err);
    } finally {
      setBusy(false);
    }
  }

  function back() {
    setStep("phone");
    setCode("");
    setNeedsName(false);
    setName("");
    setError(null);
    setInfo(null);
    // Both waits are PER PHONE: going back to type another number starts clean.
    cooldown.start(null);
    lockout.start(null);
  }

  return (
    <div className={styles.page}>
      <ThemeToggle className={styles.themeToggle} />
      <AuthHero active="login" />

      <div className={styles.content}>
        {step === "phone" ? (
          <form className={styles.form} onSubmit={submitPhone} noValidate>
            {shownError && (
              <div className={styles.error} role="alert">
                {shownError}
              </div>
            )}
            <IconInput
              label={t("auth.phoneLabel")}
              icon={<PhoneIcon />}
              type="tel"
              name="phone"
              inputMode="tel"
              autoComplete="tel"
              mono
              prefix="+998"
              value={groupNational(phone)}
              onChange={(ev) => setPhone(nationalDigits(ev.target.value))}
              placeholder="90 123 45 67"
              autoFocus
            />
            <Button
              type="submit"
              variant="primary"
              size="lg"
              fullWidth
              loading={busy}
              disabled={!isValidUz(phone)}
            >
              {t("auth.otp.getCode")}
            </Button>
            <TryLink />
          </form>
        ) : (
          otpInfo && (
            <OtpStep
              phoneDisplay={formatDisplay(phone)}
              delivery={otpInfo}
              code={code}
              onCodeChange={setCode}
              onVerify={submitCode}
              onBack={back}
              onResend={resend}
              submitLabel={needsName ? t("auth.register.submit") : t("auth.otp.verify")}
              busy={busy}
              resendWaitSec={cooldown.remainingSec}
              verifyLocked={lockout.throttle !== null}
              error={shownError}
              info={info}
            >
              {needsName && (
                <IconInput
                  label={t("auth.nameLabel")}
                  icon={<UserIcon />}
                  name="full_name"
                  autoComplete="name"
                  value={name}
                  onChange={(ev) => setName(ev.target.value)}
                  placeholder="Aziz Karimov"
                  autoFocus
                />
              )}
            </OtpStep>
          )
        )}

        {/*
          DEVELOPMENT ONLY. `import.meta.env.DEV` is a literal Vite replaces at build
          time, so a production build reads `false && …` and Rollup drops both this
          element and the whole DevLoginPanel declaration below — the shipped bundle
          contains no panel, no endpoint path and no demo account. That is the second
          of two independent barriers; the first is that the backend never registers
          the routes outside Development (404, not 403). See DevLoginEndpoints.
        */}
        {import.meta.env.DEV && <DevLoginPanel />}
      </div>
    </div>
  );
}

/**
 * One-tap sign-in as a seeded demo account — a DEVELOPMENT TOOL, and it is meant to
 * look like one. It exists because testing three roles used to mean three phone
 * numbers and three Telegram OTP round-trips.
 *
 * Two rules make it safe to have on the login page at all:
 *
 *   1. **A 404 renders nothing.** `GET /api/auth/dev/users` does not exist in
 *      production, and the panel treats every failure — 404 included — as "there is
 *      nothing to offer" and returns `null`. So even in the impossible case where
 *      this code reached a production bundle, it would draw no UI.
 *   2. **It never looks like a way in.** The badge names it, the surface is dashed
 *      and off-palette from the real CTA, and each row says which role it signs in
 *      as. Anyone who sees a screenshot should read "dev tool" immediately rather
 *      than "a login button I have not seen before".
 */
function DevLoginPanel() {
  const { t } = useTranslation();
  const { hydrateUser } = useAuth();
  const navigate = useNavigate();

  const [users, setUsers] = useState<DevUserResponse[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    endpoints
      .devUsers()
      .then((list) => {
        if (alive) setUsers(list);
      })
      // Every failure is the same answer: draw nothing. A 404 IS the production
      // case, and it must not surface as an error the user is asked to care about.
      .catch(() => {
        if (alive) setUsers(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!users || users.length === 0) return null;

  async function signIn(user: DevUserResponse) {
    setBusyId(user.id);
    setFailed(false);
    try {
      const tokens = await endpoints.devLogin(user.id);
      tokenStore.set(tokens.access_token, tokens.refresh_token);
      hydrateUser(await endpoints.me(true));
      // Always "/", never the remembered `from` path: the role that is signing in is
      // not the one that was bounced here, and RoleHome is what maps a role to its
      // home (student stays on `/`, teacher → `/teacher`, admin → `/admin`).
      navigate("/", { replace: true });
    } catch {
      // A half-stored session is worse than none: clear before reporting.
      tokenStore.clear();
      setFailed(true);
      setBusyId(null);
    }
  }

  return (
    <section className={styles.devPanel} aria-labelledby="dev-login-title">
      <div className={styles.devPanelHead}>
        <span className={styles.devPanelBadge}>{t("auth.devLogin.badge")}</span>
        <h2 id="dev-login-title" className={styles.devPanelTitle}>
          {t("auth.devLogin.title")}
        </h2>
      </div>
      <p className={styles.devPanelHint}>{t("auth.devLogin.hint")}</p>

      {failed && (
        <div className={styles.error} role="alert">
          {t("auth.devLogin.failed")}
        </div>
      )}

      <div className={styles.devPanelList}>
        {users.map((user) => (
          <button
            key={user.id}
            type="button"
            className={styles.devUser}
            onClick={() => void signIn(user)}
            disabled={busyId !== null}
            data-busy={busyId === user.id ? "" : undefined}
          >
            <span className={styles.devUserName}>{user.full_name}</span>
            <span className={styles.devUserRole}>{t(`auth.devLogin.roles.${user.role}`)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
