import { useState } from "react";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { Button, Icon, Logo, Mascot } from "../components/govori";
import { Dropdown, type DropdownOption } from "../components/Dropdown";
import { UZ_REGIONS, districtsOf } from "../lib/regions";
import { canonicalUzPhone, formatUzPhone, isValidUzPhone, uzPhoneDigits } from "../lib/phone";

/** Shown after a Google sign-up (or any account missing required profile data).
 *  Phone is required for everyone; students must also provide age and address. */
export function CompleteProfile() {
  const { user, completeProfile, logout } = useAuth();
  const { t } = useI18n();
  const isStudent = user?.role === "student";

  const [phone, setPhone] = useState(user?.phone ? uzPhoneDigits(user.phone) : "");
  const [age, setAge] = useState(user?.age ? String(user.age) : "");
  const [region, setRegion] = useState(user?.region ?? "");
  const [district, setDistrict] = useState(user?.district ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const regionOptions: DropdownOption<string>[] = [
    { value: "", label: t("selectRegion") },
    ...UZ_REGIONS.map((r) => ({ value: r.name, label: r.name })),
  ];
  const districtOptions: DropdownOption<string>[] = [
    { value: "", label: t("selectDistrict") },
    ...districtsOf(region).map((d) => ({ value: d, label: d })),
  ];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValidUzPhone(phone)) {
      setError(t("phoneInvalid"));
      return;
    }
    const ageNum = Number(age);
    if (isStudent) {
      if (!ageNum || ageNum < 5 || ageNum > 100) {
        setError(t("ageInvalid"));
        return;
      }
      if (!region || !district) {
        setError(t("addressRequired"));
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      await completeProfile(
        isStudent
          ? { phone: canonicalUzPhone(phone), age: ageNum, region, district }
          : { phone: canonicalUzPhone(phone) },
      );
      // On success the user now has the required fields; the app re-renders past the gate.
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
          {isStudent ? t("completeProfileDescFull") : t("completeProfileDesc")}
        </p>

        <form onSubmit={submit} className="col gap-3">
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

          {isStudent && (
            <>
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
                <Icon name="grad" size={19} style={{ color: "var(--muted)" }} />
                <input
                  type="number"
                  inputMode="numeric"
                  placeholder={t("agePh")}
                  value={age}
                  onChange={(e) => setAge(e.target.value.replace(/\D/g, "").slice(0, 3))}
                  required
                  style={{ border: "none", background: "transparent", outline: "none", flex: 1, fontSize: 15, color: "var(--ink)" }}
                />
              </div>

              <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {t("addressLabel")}
              </span>
              <Dropdown
                value={region}
                onChange={(v) => {
                  setRegion(v);
                  setDistrict("");
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
            </>
          )}

          {error && (
            <p style={{ color: "var(--danger, #e5484d)", fontSize: 13.5, fontWeight: 700 }}>{error}</p>
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
