import { useState } from "react";
import type { CSSProperties } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { Button, Icon, Logo, Mascot } from "../components/govori";
import type { IconName } from "../components/govori";
import { GoogleSignIn } from "../components/GoogleSignIn";
import { GOOGLE_CLIENT_ID } from "../lib/plan";

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

export function Login() {
  const { user, login } = useAuth();
  const { t } = useI18n();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      nav("/");
    } catch {
      setError(t("loginError"));
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
            <Mascot size={120} mood="happy" />
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
            <button className="tap" style={tab(true)}>{t("signIn")}</button>
            <button className="tap" style={tab(false)} onClick={() => nav("/register")}>{t("signUp")}</button>
          </div>

          <h2 style={{ fontSize: 25 }}>{t("welcomeBack")} 👋</h2>
          <p style={{ color: "var(--muted)", marginTop: 5, marginBottom: 20, fontSize: 14.5 }}>{t("appName")}</p>

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

          <form onSubmit={submit}>
            <div className="col gap-3" style={{ marginBottom: 18 }}>
              <AuthInput icon="message" type="email" placeholder={t("email")} value={email} onChange={setEmail} required />
              <AuthInput icon="lock" type="password" placeholder={t("password")} value={password} onChange={setPassword} required />
            </div>

            {error && <p style={{ color: "var(--danger, #e5484d)", fontSize: 13.5, fontWeight: 700, marginBottom: 14 }}>{error}</p>}

            <Button full size="lg" iconR="chevR" type="submit" disabled={busy}>
              {busy ? t("loading") : t("signIn")}
            </Button>
          </form>

          {/* Value-first funnel: try a free speech check without an account. */}
          <button
            onClick={() => nav("/try")}
            className="tap row center gap-2"
            style={{
              width: "100%", marginTop: 14, padding: "12px 14px", cursor: "pointer",
              borderRadius: "var(--r-md)", border: "1.5px dashed var(--primary)",
              background: "var(--primary-tint)", color: "var(--primary-press)",
              fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 14.5,
            }}
          >
            <Icon name="mic" size={17} /> {t("guestStartBtn")}
          </button>

          <p style={{ textAlign: "center", fontSize: 13.5, color: "var(--muted)", marginTop: 16 }}>
            {t("noAccount")}{" "}
            <button
              onClick={() => nav("/register")}
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--primary-press)", fontWeight: 800, fontSize: 13.5, fontFamily: "var(--font-display)" }}
            >
              {t("signUp")}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
