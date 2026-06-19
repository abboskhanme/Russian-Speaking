import { useState } from "react";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { Button, Icon, Logo, Mascot } from "../components/govori";
import { canonicalUzPhone, formatUzPhone, isValidUzPhone, uzPhoneDigits } from "../lib/phone";

/** Shown after a Google sign-up (or any account missing a phone). Phone is
 *  required for students and teachers, so we gate the app until it's provided. */
export function CompleteProfile() {
  const { user, completeProfile, logout } = useAuth();
  const { t } = useI18n();
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValidUzPhone(phone)) {
      setError(t("phoneInvalid"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await completeProfile(canonicalUzPhone(phone));
      // On success the user now has a phone; the app re-renders past the gate.
    } catch {
      setError(t("registerError"));
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "var(--bg)",
      }}
    >
      <div style={{ width: "100%", maxWidth: 420 }} className="anim-fade-up">
        <div style={{ marginBottom: 22 }}>
          <Logo size={38} />
        </div>
        <div className="col gap-2" style={{ alignItems: "center", marginBottom: 18 }}>
          <Mascot size={92} mood="happy" />
        </div>
        <h2 style={{ fontSize: 24 }}>{t("completeProfileTitle")}</h2>
        <p style={{ color: "var(--muted)", marginTop: 6, marginBottom: 20, fontSize: 14.5, lineHeight: 1.6 }}>
          {t("completeProfileDesc")}
        </p>

        <form onSubmit={submit}>
          <div
            className="row gap-3"
            style={{
              border: "1.5px solid var(--line-2)",
              borderRadius: "var(--r-md)",
              padding: "12px 15px",
              background: "var(--surface-2)",
              alignItems: "center",
              marginBottom: 16,
            }}
          >
            <Icon name="phone" size={19} style={{ color: "var(--muted)" }} />
            <input
              type="tel"
              autoFocus
              placeholder={t("phone")}
              value={phone ? formatUzPhone(phone) : ""}
              onChange={(e) => setPhone(uzPhoneDigits(e.target.value))}
              required
              style={{ border: "none", background: "transparent", outline: "none", flex: 1, fontSize: 15, color: "var(--ink)" }}
            />
          </div>

          {error && (
            <p style={{ color: "var(--danger, #e5484d)", fontSize: 13.5, fontWeight: 700, marginBottom: 14 }}>{error}</p>
          )}

          <Button full size="lg" iconR="chevR" type="submit" disabled={busy}>
            {busy ? t("loading") : t("save")}
          </Button>
        </form>

        <p style={{ textAlign: "center", fontSize: 13.5, color: "var(--muted)", marginTop: 16 }}>
          {user?.email}{" "}
          <button
            onClick={logout}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--primary-press)", fontWeight: 800, fontSize: 13.5, fontFamily: "var(--font-display)" }}
          >
            {t("logout")}
          </button>
        </p>
      </div>
    </div>
  );
}
