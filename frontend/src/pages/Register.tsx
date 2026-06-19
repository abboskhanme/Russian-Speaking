import { useState } from "react";
import type { CSSProperties } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { Button, Icon, Logo, Mascot } from "../components/govori";
import type { IconName } from "../components/govori";
import { GoogleSignIn } from "../components/GoogleSignIn";
import { GOOGLE_CLIENT_ID } from "../lib/plan";
import { canonicalUzPhone, formatUzPhone, isValidUzPhone, uzPhoneDigits } from "../lib/phone";

type Role = "student" | "teacher";

interface AuthInputProps {
  icon: IconName;
  type?: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  minLength?: number;
}

function AuthInput({ icon, type = "text", placeholder, value, onChange, required, minLength }: AuthInputProps) {
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
  const { user, register } = useAuth();
  const { t } = useI18n();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const referralCode = params.get("ref") || undefined; // teacher's group join code
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState(""); // 9 national digits only
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("student");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValidUzPhone(phone)) {
      setError(t("phoneInvalid"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await register(email, password, fullName, role, canonicalUzPhone(phone), referralCode);
      if (res.pending) setPending(true); // teacher awaiting admin approval
      else nav("/");
    } catch {
      setError(t("registerError"));
    } finally {
      setBusy(false);
    }
  }

  const tab = (active: boolean): CSSProperties => ({
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

  const roleOptions: { id: Role; icon: IconName; hue: number }[] = [
    { id: "student", icon: "grad", hue: 47 },
    { id: "teacher", icon: "headphones", hue: 152 },
  ];

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
          <p style={{ color: "var(--muted)", marginTop: 5, marginBottom: 20, fontSize: 14.5 }}>{t("appName")}</p>

          {referralCode && !pending && (
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

          {GOOGLE_CLIENT_ID && (
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

          {pending ? (
            <div
              className="col gap-3"
              style={{
                textAlign: "center",
                padding: "24px 18px",
                background: "var(--primary-tint)",
                borderRadius: "var(--r-md)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "center" }}>
                <div
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: "50%",
                    background: "oklch(0.7 0.16 152)",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon name="check" size={26} sw={3} />
                </div>
              </div>
              <h3 style={{ fontSize: 19 }}>{t("teacherPendingTitle")}</h3>
              <p style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.6, margin: 0 }}>
                {t("teacherPendingMsg")}
              </p>
              <Button full onClick={() => nav("/login")}>
                {t("signIn")}
              </Button>
            </div>
          ) : (
          <form onSubmit={submit}>
            <div className="col gap-3" style={{ marginBottom: 18 }}>
              <AuthInput icon="user" placeholder={t("fullName")} value={fullName} onChange={setFullName} required />
              <AuthInput icon="message" type="email" placeholder={t("email")} value={email} onChange={setEmail} required />
              <AuthInput
                icon="phone"
                type="tel"
                placeholder={t("phone")}
                value={phone ? formatUzPhone(phone) : ""}
                onChange={(v) => setPhone(uzPhoneDigits(v))}
                required
              />
              <AuthInput icon="lock" type="password" placeholder={t("minCharsPwd")} value={password} onChange={setPassword} required minLength={6} />
            </div>

            <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {t("role")}
            </span>
            <div className="row gap-2" style={{ margin: "10px 0 20px" }}>
              {roleOptions.map((r) => {
                const active = role === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setRole(r.id)}
                    className="tap"
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 6,
                      padding: "13px 6px",
                      borderRadius: "var(--r-md)",
                      cursor: "pointer",
                      border: active ? `2px solid oklch(0.7 0.16 ${r.hue})` : "2px solid var(--line)",
                      background: active ? `oklch(0.97 0.03 ${r.hue})` : "var(--surface)",
                    }}
                  >
                    <div
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 11,
                        background: `oklch(0.94 0.06 ${r.hue})`,
                        color: `oklch(0.5 0.16 ${r.hue})`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Icon name={r.icon} size={20} />
                    </div>
                    <span style={{ fontWeight: 800, fontFamily: "var(--font-display)", fontSize: 12.5 }}>{t(r.id)}</span>
                  </button>
                );
              })}
            </div>

            {error && <p style={{ color: "var(--danger, #e5484d)", fontSize: 13.5, fontWeight: 700, marginBottom: 14 }}>{error}</p>}

            <Button full size="lg" iconR="chevR" type="submit" disabled={busy}>
              {busy ? t("loading") : t("signUp")}
            </Button>
          </form>
          )}

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
