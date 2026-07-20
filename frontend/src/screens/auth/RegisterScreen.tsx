/**
 * RegisterScreen (`/register`) — self-service student sign-up (docs/08 auth
 * slice, priority #3). Implements the OTP flow request-code → verify-code →
 * register when the API reports email verification is ON (`/auth/config`); when
 * OFF it registers directly. The dev OTP is NOT emailed (LoggingOtpSender) — an
 * inline hint tells the user the code is printed in the API logs. Registration
 * always creates an active student and logs straight in → navigate to `/`.
 */
import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, Link } from "react-router-dom";
import { Button, Card, Input, Mascot, Text } from "../../shared/ui";
import { Brand, ThemeToggle } from "../../widgets";
import { useAuth } from "../../shared/auth";
import { endpoints, isApiError, type RegisterPayload } from "../../shared/api";
import styles from "./Auth.module.css";

type Step = "details" | "otp";

export default function RegisterScreen() {
  const { t } = useTranslation();
  const { register, requestEmailCode, verifyEmailCode } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>("details");
  const [emailVerification, setEmailVerification] = useState<boolean | null>(null);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [age, setAge] = useState("");
  const [region, setRegion] = useState("");
  const [district, setDistrict] = useState("");
  const [groupCode, setGroupCode] = useState("");
  const [code, setCode] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Discover whether the OTP step is required (fail-safe: assume ON on error).
  useEffect(() => {
    let alive = true;
    endpoints
      .authConfig()
      .then((c) => alive && setEmailVerification(c.email_verification))
      .catch(() => alive && setEmailVerification(true));
    return () => {
      alive = false;
    };
  }, []);

  function basePayload(email_verify_token?: string): RegisterPayload {
    return {
      email: email.trim(),
      password,
      full_name: fullName.trim(),
      phone: phone.trim(),
      age: Number(age) || 0,
      region: region.trim(),
      district: district.trim(),
      email_verify_token: email_verify_token ?? null,
      group_code: groupCode.trim() || null,
    };
  }

  function mapError(err: unknown): string {
    if (isApiError(err)) {
      if (err.status === 409) return t("auth.errors.emailTaken");
      if (err.status === 400) return err.detail || t("auth.errors.badCode");
      if (err.status === 422) return err.detail || t("auth.errors.validation");
      if (err.status === 0) return t("auth.errors.network");
    }
    return t("auth.errors.generic");
  }

  async function doRegister(email_verify_token?: string) {
    await register(basePayload(email_verify_token));
    navigate("/", { replace: true });
  }

  async function onSubmitDetails(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      if (emailVerification) {
        await requestEmailCode(email.trim());
        setStep("otp");
      } else {
        await doRegister();
      }
    } catch (err) {
      setError(mapError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitOtp(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const token = await verifyEmailCode(email.trim(), code.trim());
      await doRegister(token);
    } catch (err) {
      setError(mapError(err));
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
            <Mascot mood="idle" size={64} label="Govo" />
            <Text as="h1" variant="title-l">
              {t("auth.register.title")}
            </Text>
            <Text as="p" variant="body-l" color="ink-soft">
              {step === "details" ? t("auth.register.subtitle") : t("auth.register.otpSubtitle")}
            </Text>
          </div>

          {error && (
            <div className={styles.error} role="alert">
              {error}
            </div>
          )}

          {step === "details" ? (
            <form className={styles.form} onSubmit={onSubmitDetails} noValidate>
              <Input
                label={t("auth.fullName")}
                name="full_name"
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                autoFocus
              />
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
              />
              <Input
                label={t("auth.password")}
                type="password"
                name="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <Input
                label={t("auth.phone")}
                type="tel"
                name="phone"
                autoComplete="tel"
                inputMode="tel"
                placeholder="+998 90 123 45 67"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
              <div className={styles.grid2}>
                <Input
                  label={t("auth.age")}
                  type="number"
                  name="age"
                  inputMode="numeric"
                  min={1}
                  max={120}
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  required
                />
                <Input
                  label={t("auth.region")}
                  name="region"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  required
                />
              </div>
              <Input
                label={t("auth.district")}
                name="district"
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                required
              />
              <Input
                label={t("auth.groupCode")}
                name="group_code"
                hint={t("auth.groupCodeHint")}
                value={groupCode}
                onChange={(e) => setGroupCode(e.target.value)}
              />
              <Button type="submit" variant="primary" size="lg" fullWidth loading={busy}>
                {emailVerification ? t("auth.register.sendCode") : t("auth.register.submit")}
              </Button>
            </form>
          ) : (
            <form className={styles.form} onSubmit={onSubmitOtp} noValidate>
              <div className={styles.hint}>
                <Text as="p" variant="body-s">
                  {t("auth.register.devHint")}
                </Text>
              </div>
              <Input
                label={t("auth.register.codeLabel", { email })}
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                autoFocus
              />
              <Button type="submit" variant="primary" size="lg" fullWidth loading={busy}>
                {t("auth.register.submit")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="md"
                fullWidth
                onClick={() => {
                  setError(null);
                  setStep("details");
                }}
              >
                {t("common.back")}
              </Button>
            </form>
          )}

          <div className={styles.footer}>
            <Text as="span" variant="body-s" color="muted">
              {t("auth.register.haveAccount")}
            </Text>
            <Link to="/login" className={styles.link}>
              {t("auth.register.loginLink")}
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
