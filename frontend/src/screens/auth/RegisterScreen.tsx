/**
 * RegisterScreen (`/register`) — phone + Telegram-bot OTP sign-up, rebuilt to
 * the mockup ("1 · KIRISH", frame A1 register). Two steps:
 *   1. name + phone → `requestOtp` → the code step.
 *   2. code → `verifyOtp(phone, code, fullName)` → tokens (one-shot register) →
 *      navigate to `/`.
 * Because the name is captured up front, the verify is a single call — the
 * `needs_registration` branch never fires here. Composed from `shared/ui` +
 * Ovoz DS tokens; i18n via `auth.*`. No email/password anywhere.
 */
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "../../shared/ui";
import { ThemeToggle } from "../../widgets";
import { useAuth } from "../../shared/auth";
import { isApiError, type OtpRequestResponse } from "../../shared/api";
import { AuthHero } from "./AuthHero";
import { AuthNote } from "./AuthNote";
import { IconInput } from "./IconInput";
import { OtpStep } from "./OtpStep";
import { PhoneIcon, UserIcon } from "./icons";
import { clearPlaced } from "../placement";
import { formatDisplay, groupNational, isValidUz, nationalDigits, toE164 } from "./phone";
import styles from "./Auth.module.css";

export default function RegisterScreen() {
  const { t } = useTranslation();
  const { requestOtp, verifyOtp } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<"phone" | "code">("phone");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState(""); // national digits (max 9)
  const [code, setCode] = useState("");
  const [otpInfo, setOtpInfo] = useState<OtpRequestResponse | null>(null);
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

  async function submitDetails(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (!name.trim()) {
      setError(t("auth.errors.nameRequired"));
      return;
    }
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
    setBusy(true);
    try {
      // Name captured in step 1 → one-shot register (never needs_registration).
      // A brand-new user goes to the one-time placement test, not straight Home.
      await verifyOtp(e164, code, name.trim());
      clearPlaced();   // fresh account → always show the one-time placement (device flag is global)
      navigate("/placement", { replace: true });
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
    setError(null);
    setInfo(null);
  }

  return (
    <div className={styles.page}>
      <ThemeToggle className={styles.themeToggle} />
      <AuthHero active="register" />

      <div className={styles.content}>
        {step === "phone" ? (
          <form className={styles.form} onSubmit={submitDetails} noValidate>
            {error && (
              <div className={styles.error} role="alert">
                {error}
              </div>
            )}
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
            />
            <Button
              type="submit"
              variant="primary"
              size="lg"
              fullWidth
              loading={busy}
              disabled={!name.trim() || !isValidUz(phone)}
            >
              {t("auth.register.submit")}
            </Button>
            <AuthNote tone="info">{t("auth.register.placementNote")}</AuthNote>
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
              submitLabel={t("auth.otp.verify")}
              busy={busy}
              error={error}
              info={info}
            />
          )
        )}
      </div>
    </div>
  );
}
