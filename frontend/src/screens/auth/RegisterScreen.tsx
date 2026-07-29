/**
 * RegisterScreen (`/register`) — phone + Telegram-bot OTP sign-up, rebuilt to
 * the mockup's 3-step stepper (frames A4/A5/A6): Hisob → Aloqa → Manzil.
 *   1. Hisob  — name + phone → `requestOtp` → the code step.
 *   2. Aloqa  — code → `verifyOtp(phone, code, fullName, { hydrate:false })` →
 *               tokens stored (account created) WITHOUT flipping isAuthenticated
 *               yet, so PublicOnly doesn't bounce us before the address step.
 *   3. Manzil — region + district (+ optional street) → `updateProfile` →
 *               `hydrateUser` → navigate to `/` (Home).
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
import { endpoints, isApiError, type OtpRequestResponse } from "../../shared/api";
import { AuthHero } from "./AuthHero";
import { AddressStep } from "./AddressStep";
import { IconInput } from "./IconInput";
import { OtpStep } from "./OtpStep";
import { RegisterStepper } from "./RegisterStepper";
import { TryLink } from "./TryLink";
import { PhoneIcon, UserIcon } from "./icons";
import { formatDisplay, groupNational, isValidUz, nationalDigits, toE164 } from "./phone";
import { districtsFor } from "../../shared/uz-regions";
import styles from "./Auth.module.css";

type Step = "phone" | "code" | "address";

export default function RegisterScreen() {
  const { t } = useTranslation();
  const { requestOtp, verifyOtp, hydrateUser } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>("phone");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState(""); // national digits (max 9)
  const [code, setCode] = useState("");
  const [otpInfo, setOtpInfo] = useState<OtpRequestResponse | null>(null);
  const [region, setRegion] = useState("");
  const [district, setDistrict] = useState("");
  const [street, setStreet] = useState("");
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
    if (busy) return;
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      // Name captured in step 1 → one-shot register (never needs_registration).
      // hydrate:false keeps the tokens but defers isAuthenticated so the guard
      // doesn't skip the Manzil step; we flip it after the address PATCH.
      await verifyOtp(e164, code, name.trim(), { hydrate: false });
      setStep("address");
    } catch (err) {
      setError(mapError(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitAddress() {
    setError(null);
    if (!region || !district) return;
    setBusy(true);
    try {
      const me = await endpoints.updateProfile({
        region,
        district,
        address: street.trim(),
      });
      hydrateUser(me); // flip isAuthenticated now that the flow is complete
      navigate("/", { replace: true });
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

  function backToPhone() {
    setStep("phone");
    setCode("");
    setError(null);
    setInfo(null);
  }

  function backToCode() {
    setStep("code");
    setError(null);
    setInfo(null);
  }

  function onRegionChange(value: string) {
    setRegion(value);
    // The tuman list is region-specific — drop a now-invalid district.
    if (!districtsFor(value).includes(district)) setDistrict("");
  }

  return (
    <div className={styles.page}>
      <ThemeToggle className={styles.themeToggle} />
      <AuthHero active="register" />

      <div className={styles.content}>
        {step === "phone" && (
          <form className={styles.form} onSubmit={submitDetails} noValidate>
            <RegisterStepper current="hisob" />
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
            <TryLink />
          </form>
        )}

        {step === "code" && otpInfo && (
          <OtpStep
            phoneDisplay={formatDisplay(phone)}
            delivery={otpInfo}
            code={code}
            onCodeChange={setCode}
            onVerify={submitCode}
            onBack={backToPhone}
            onResend={resend}
            submitLabel={t("auth.otp.verify")}
            busy={busy}
            error={error}
            info={info}
            topSlot={<RegisterStepper current="aloqa" />}
          />
        )}

        {step === "address" && (
          <AddressStep
            region={region}
            district={district}
            street={street}
            onRegionChange={onRegionChange}
            onDistrictChange={setDistrict}
            onStreetChange={setStreet}
            onSubmit={submitAddress}
            onBack={backToCode}
            busy={busy}
            error={error}
          />
        )}
      </div>
    </div>
  );
}
