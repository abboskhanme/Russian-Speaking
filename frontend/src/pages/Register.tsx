import { useEffect, useState } from "react";
import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { Button, Icon, Loading, Logo, Mascot } from "../components/govori";
import type { IconName } from "../components/govori";
import { Dropdown, type DropdownOption } from "../components/Dropdown";
import { GoogleSignIn } from "../components/GoogleSignIn";
import { GOOGLE_CLIENT_ID } from "../lib/plan";
import { UZ_REGIONS, districtsOf } from "../lib/regions";
import { canonicalUzPhone, formatUzPhone, isValidUzPhone, uzPhoneDigits } from "../lib/phone";

const OTP_LENGTH = 6;
const RESEND_COOLDOWN = 60; // seconds before "resend code" is allowed again

type StepKey = "account" | "verify" | "contact" | "address";

const STEP_META: Record<StepKey, { labelKey: string; icon: IconName }> = {
  account: { labelKey: "stepAccount", icon: "user" },
  verify: { labelKey: "stepVerify", icon: "message" },
  contact: { labelKey: "stepContact", icon: "phone" },
  address: { labelKey: "stepAddress", icon: "flag" },
};

interface AuthInputProps {
  icon: IconName;
  type?: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  minLength?: number;
  inputMode?: "numeric";
  autoFocus?: boolean;
}

function AuthInput({ icon, type = "text", placeholder, value, onChange, required, minLength, inputMode, autoFocus }: AuthInputProps) {
  return (
    <div
      className="row gap-3"
      style={{
        border: "1.5px solid var(--line-2)",
        borderRadius: "var(--r-md)",
        padding: "12px 15px",
        background: "var(--surface-2)",
        alignItems: "center",
      }}
    >
      <Icon name={icon} size={19} style={{ color: "var(--muted)" }} />
      <input
        type={type}
        inputMode={inputMode}
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        minLength={minLength}
        style={{
          border: "none",
          background: "transparent",
          outline: "none",
          flex: 1,
          fontSize: 15,
          color: "var(--ink)",
        }}
      />
    </div>
  );
}

export function Register() {
  const { user, register, requestEmailCode, verifyEmailCode } = useAuth();
  const { t } = useI18n();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const referralCode = params.get("ref") || undefined; // teacher's group join code

  // Whether the server requires email verification (true only when SMTP is set up).
  const { data: cfg, isLoading: cfgLoading } = useQuery({
    queryKey: ["auth-config"],
    queryFn: async () => (await api.get<{ email_verification: boolean }>("/auth/config")).data,
    staleTime: Infinity,
  });
  const emailVerify = !!cfg?.email_verification;

  const [step, setStep] = useState(0);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [verifyToken, setVerifyToken] = useState(""); // proof email is verified
  const [phone, setPhone] = useState(""); // 9 national digits only
  const [age, setAge] = useState("");
  const [region, setRegion] = useState("");
  const [district, setDistrict] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  // Tick down the resend cooldown.
  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [resendIn]);

  if (user) return <Navigate to="/" replace />;
  if (cfgLoading) return <Loading full />;

  // The verify step only exists when the server enforces email verification.
  const stepKeys: StepKey[] = emailVerify
    ? ["account", "verify", "contact", "address"]
    : ["account", "contact", "address"];
  const currentKey = stepKeys[step];
  const isLast = step === stepKeys.length - 1;
  const steps = stepKeys.map((k) => ({ label: t(STEP_META[k].labelKey), icon: STEP_META[k].icon }));

  // Changing the email invalidates any code already sent / verified.
  function onEmailChange(v: string) {
    setEmail(v);
    setVerifyToken("");
    setCode("");
  }

  const regionOptions: DropdownOption<string>[] = [
    { value: "", label: t("selectRegion") },
    ...UZ_REGIONS.map((r) => ({ value: r.name, label: r.name })),
  ];
  const districtOptions: DropdownOption<string>[] = [
    { value: "", label: t("selectDistrict") },
    ...districtsOf(region).map((d) => ({ value: d, label: d })),
  ];

  // Synchronous validation per step; async actions live in goNext.
  function validateStep(key: StepKey): string | null {
    if (key === "account") {
      if (!fullName.trim()) return t("registerError");
      if (!/^\S+@\S+\.\S+$/.test(email)) return t("registerError");
      if (password.length < 6) return t("registerError");
    }
    if (key === "verify") {
      if (code.length !== OTP_LENGTH) return t("codeInvalid");
    }
    if (key === "contact") {
      if (!isValidUzPhone(phone)) return t("phoneInvalid");
      const ageNum = Number(age);
      if (!ageNum || ageNum < 5 || ageNum > 100) return t("ageInvalid");
    }
    if (key === "address") {
      if (!region || !district) return t("addressRequired");
    }
    return null;
  }

  // Send (or resend) the verification code to the entered email.
  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      await requestEmailCode(email);
      setResendIn(RESEND_COOLDOWN);
      return true;
    } catch (err) {
      const conflict = axios.isAxiosError(err) && err.response?.status === 409;
      setError(conflict ? t("emailTaken") : t("registerError"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function goNext() {
    const err = validateStep(currentKey);
    if (err) {
      setError(err);
      return;
    }
    setError(null);

    // Leaving the account step → send the code, then show the verify step.
    if (currentKey === "account" && emailVerify) {
      if (await sendCode()) setStep((s) => s + 1);
      return;
    }
    // Leaving the verify step → exchange the code for a proof token.
    if (currentKey === "verify") {
      setBusy(true);
      try {
        const token = await verifyEmailCode(email, code);
        setVerifyToken(token);
        setStep((s) => s + 1);
      } catch {
        setError(t("codeInvalid"));
      } finally {
        setBusy(false);
      }
      return;
    }
    setStep((s) => Math.min(stepKeys.length - 1, s + 1));
  }

  function goBack() {
    setError(null);
    setStep((s) => Math.max(0, s - 1));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    for (let s = 0; s < stepKeys.length; s++) {
      const err = validateStep(stepKeys[s]);
      if (err) {
        setError(err);
        setStep(s);
        return;
      }
    }
    if (emailVerify && !verifyToken) {
      setError(t("codeInvalid"));
      setStep(stepKeys.indexOf("verify"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await register({
        email,
        password,
        full_name: fullName,
        phone: canonicalUzPhone(phone),
        age: Number(age),
        region,
        district,
        email_verify_token: verifyToken || undefined,
        group_code: referralCode,
      });
      nav("/");
    } catch {
      setError(t("registerError"));
    } finally {
      setBusy(false);
    }
  }

  const tab = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: "9px",
    borderRadius: "var(--r-pill)",
    border: "none",
    fontFamily: "var(--font-display)",
    fontWeight: 800,
    fontSize: 14,
    cursor: "pointer",
    background: active ? "var(--surface)" : "transparent",
    color: active ? "var(--primary-press)" : "var(--muted)",
    boxShadow: active ? "var(--sh-sm)" : "none",
  });

  return (
    <div style={{ height: "100vh", display: "flex", overflow: "hidden" }}>
      {/* Brand panel */}
      <div
        className="auth-brand"
        style={{
          width: "44%",
          flexShrink: 0,
          position: "relative",
          overflow: "hidden",
          background: "linear-gradient(160deg, oklch(0.73 0.16 58), oklch(0.6 0.19 35))",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 46,
          color: "#fff",
        }}
      >
        <div style={{ position: "absolute", width: 460, height: 460, borderRadius: "50%", background: "oklch(1 0 0 / 0.08)", top: -120, right: -120 }} />
        <div style={{ position: "absolute", width: 300, height: 300, borderRadius: "50%", background: "oklch(1 0 0 / 0.06)", bottom: -80, left: -60 }} />
        <Logo size={40} light />
        <div style={{ position: "relative", zIndex: 2 }}>
          <div style={{ marginBottom: 18 }}>
            <Mascot size={120} mood="celebrate" />
          </div>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: "oklch(1 0 0 / 0.18)",
              padding: "7px 14px",
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 800,
              marginBottom: 18,
            }}
          >
            <Icon name="sparkles" size={15} /> {t("appName")}
          </div>
          <h1 style={{ fontSize: "clamp(28px, 3.2vw, 42px)", color: "#fff", lineHeight: 1.1, letterSpacing: "-0.02em" }}>
            {t("tagline")}
          </h1>
          <div className="row gap-5" style={{ marginTop: 30 }}>
            {(
              [
                ["1,284", t("student")],
                ["52K+", "AI"],
                ["+1.4", "IELTS"],
              ] as const
            ).map((s, i) => (
              <div key={i} className="col">
                <span style={{ fontSize: 26, fontWeight: 900, fontFamily: "var(--font-display)" }}>{s[0]}</span>
                <span style={{ fontSize: 12.5, opacity: 0.85 }}>{s[1]}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ position: "relative", zIndex: 2, fontSize: 13, opacity: 0.75 }}>© 2026 Govori</div>
      </div>

      {/* Form */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 32, overflowY: "auto" }}>
        <div style={{ width: "100%", maxWidth: 410 }} className="anim-fade-up">
          <div className="auth-brand-mobile" style={{ marginBottom: 22 }}>
            <Logo size={38} />
          </div>

          <div className="row gap-2" style={{ background: "var(--surface-2)", borderRadius: "var(--r-pill)", padding: 4, marginBottom: 22 }}>
            <button className="tap" style={tab(false)} onClick={() => nav("/login")}>{t("signIn")}</button>
            <button className="tap" style={tab(true)}>{t("signUp")}</button>
          </div>

          <h2 style={{ fontSize: 25 }}>{t("signUp")} 🎉</h2>
          <p style={{ color: "var(--muted)", marginTop: 5, marginBottom: 18, fontSize: 14.5 }}>{t("appName")}</p>

          {/* Step indicator */}
          <div className="row gap-2" style={{ marginBottom: 22 }}>
            {steps.map((st, i) => {
              const done = i < step;
              const active = i === step;
              return (
                <div key={i} className="col grow" style={{ gap: 7 }}>
                  <div
                    style={{
                      height: 5,
                      borderRadius: 999,
                      background: done || active ? "var(--primary)" : "var(--line-2)",
                      transition: "background .2s",
                    }}
                  />
                  <div className="row gap-1" style={{ alignItems: "center" }}>
                    <Icon
                      name={done ? "check" : st.icon}
                      size={13}
                      style={{ color: done || active ? "var(--primary-press)" : "var(--faint)" }}
                    />
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 800,
                        fontFamily: "var(--font-display)",
                        color: done || active ? "var(--ink)" : "var(--faint)",
                      }}
                    >
                      {st.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {referralCode && (
            <div
              className="row gap-2"
              style={{
                alignItems: "center",
                padding: "10px 13px",
                marginBottom: 18,
                background: "var(--primary-tint)",
                borderRadius: "var(--r-md)",
                fontSize: 13.5,
                color: "var(--primary-press)",
                fontWeight: 700,
              }}
            >
              <Icon name="users" size={17} />
              {t("invitedToGroup")}
            </div>
          )}

          {/* Google sign-up only on the first step */}
          {currentKey === "account" && GOOGLE_CLIENT_ID && (
            <>
              <div style={{ marginBottom: 16, display: "flex", justifyContent: "center" }}>
                <GoogleSignIn />
              </div>
              <div className="row gap-3" style={{ margin: "6px 0 16px", alignItems: "center" }}>
                <div style={{ flex: 1, height: 1, background: "var(--line)" }} />
                <span style={{ fontSize: 12.5, color: "var(--faint)" }}>{t("orDivider")}</span>
                <div style={{ flex: 1, height: 1, background: "var(--line)" }} />
              </div>
            </>
          )}

          <form onSubmit={submit}>
            {/* Account */}
            {currentKey === "account" && (
              <div className="col gap-3 anim-fade-in">
                <AuthInput icon="user" placeholder={t("fullName")} value={fullName} onChange={setFullName} autoFocus required />
                <AuthInput icon="message" type="email" placeholder={t("email")} value={email} onChange={onEmailChange} required />
                <AuthInput icon="lock" type="password" placeholder={t("minCharsPwd")} value={password} onChange={setPassword} required minLength={6} />
              </div>
            )}

            {/* Email verification */}
            {currentKey === "verify" && (
              <div className="col gap-3 anim-fade-in">
                <p style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.55, margin: 0 }}>
                  {t("verifySentTo")} <b style={{ color: "var(--ink)" }}>{email}</b>
                </p>
                <input
                  inputMode="numeric"
                  autoFocus
                  placeholder={"– ".repeat(OTP_LENGTH).trim()}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, OTP_LENGTH))}
                  style={{
                    border: "1.5px solid var(--line-2)",
                    borderRadius: "var(--r-md)",
                    background: "var(--surface-2)",
                    padding: "14px 15px",
                    fontSize: 26,
                    fontWeight: 800,
                    letterSpacing: 10,
                    textAlign: "center",
                    color: "var(--ink)",
                    outline: "none",
                    fontFamily: "var(--font-display)",
                  }}
                />
                <div className="row gap-1" style={{ alignItems: "center", fontSize: 13 }}>
                  <span style={{ color: "var(--muted)" }}>{t("noCode")}</span>
                  <button
                    type="button"
                    disabled={resendIn > 0 || busy}
                    onClick={sendCode}
                    style={{
                      border: "none",
                      background: "transparent",
                      color: resendIn > 0 ? "var(--faint)" : "var(--primary-press)",
                      fontWeight: 800,
                      fontFamily: "var(--font-display)",
                      fontSize: 13,
                      cursor: resendIn > 0 ? "default" : "pointer",
                      padding: 0,
                    }}
                  >
                    {resendIn > 0 ? `${t("resendCode")} (${resendIn})` : t("resendCode")}
                  </button>
                </div>
              </div>
            )}

            {/* Contact */}
            {currentKey === "contact" && (
              <div className="col gap-3 anim-fade-in">
                <AuthInput
                  icon="phone"
                  type="tel"
                  placeholder={t("phone")}
                  value={phone ? formatUzPhone(phone) : ""}
                  onChange={(v) => setPhone(uzPhoneDigits(v))}
                  autoFocus
                  required
                />
                <AuthInput
                  icon="grad"
                  type="number"
                  inputMode="numeric"
                  placeholder={t("agePh")}
                  value={age}
                  onChange={(v) => setAge(v.replace(/\D/g, "").slice(0, 3))}
                  required
                />
              </div>
            )}

            {/* Address */}
            {currentKey === "address" && (
              <div className="col gap-2 anim-fade-in">
                <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {t("addressLabel")}
                </span>
                <Dropdown
                  value={region}
                  onChange={(v) => {
                    setRegion(v);
                    setDistrict(""); // reset dependent district when region changes
                  }}
                  options={regionOptions}
                  placeholder={t("selectRegion")}
                />
                <Dropdown
                  value={district}
                  onChange={setDistrict}
                  options={districtOptions}
                  placeholder={region ? t("selectDistrict") : t("selectRegionFirst")}
                />
              </div>
            )}

            {error && <p style={{ color: "var(--danger, #e5484d)", fontSize: 13.5, fontWeight: 700, margin: "16px 0 0" }}>{error}</p>}

            {/* Navigation */}
            <div className="row gap-2" style={{ marginTop: 20 }}>
              {step > 0 && (
                <Button variant="ghost" size="lg" icon="chevL" type="button" onClick={goBack} disabled={busy}>
                  {t("back")}
                </Button>
              )}
              {isLast ? (
                <Button full size="lg" iconR="chevR" type="submit" disabled={busy}>
                  {busy ? t("loading") : t("signUp")}
                </Button>
              ) : (
                <Button full size="lg" iconR="chevR" type="button" onClick={goNext} disabled={busy}>
                  {busy ? t("loading") : t("next")}
                </Button>
              )}
            </div>
          </form>

          <p style={{ textAlign: "center", fontSize: 13.5, color: "var(--muted)", marginTop: 16 }}>
            {t("haveAccount")}{" "}
            <button
              onClick={() => nav("/login")}
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--primary-press)", fontWeight: 800, fontSize: 13.5, fontFamily: "var(--font-display)" }}
            >
              {t("signIn")}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
