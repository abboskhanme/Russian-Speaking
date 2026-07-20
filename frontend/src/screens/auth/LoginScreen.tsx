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
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "../../shared/ui";
import { ThemeToggle } from "../../widgets";
import { useAuth } from "../../shared/auth";
import { isApiError, type OtpRequestResponse } from "../../shared/api";
import { AuthHero } from "./AuthHero";
import { IconInput } from "./IconInput";
import { OtpStep } from "./OtpStep";
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

  function mapError(err: unknown): string {
    if (isApiError(err)) {
      if (err.status === 401) return t("auth.errors.badCode");
      if (err.status === 400) return err.detail || t("auth.errors.badPhone");
      if (err.status === 403) return err.detail || t("auth.errors.blocked");
      if (err.status === 0) return t("auth.errors.network");
    }
    return t("auth.errors.generic");
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
      setError(mapError(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitCode() {
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
        } catch {
          /* non-fatal — the user can hit resend */
        }
        setCode("");
        setInfo(t("auth.otp.needName"));
        return;
      }
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(mapError(err));
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
      setError(mapError(err));
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
  }

  return (
    <div className={styles.page}>
      <ThemeToggle className={styles.themeToggle} />
      <AuthHero active="login" />

      <div className={styles.content}>
        {step === "phone" ? (
          <form className={styles.form} onSubmit={submitPhone} noValidate>
            {error && (
              <div className={styles.error} role="alert">
                {error}
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
              {t("auth.login.submit")}
            </Button>
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
              error={error}
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
      </div>
    </div>
  );
}
