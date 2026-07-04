import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api, uploadToPresigned } from "../lib/api";
import { useAuth } from "../lib/auth";
import { LANGUAGES, useI18n, type Lang } from "../lib/i18n";
import { Avatar, Button, Card, Icon, Toggle, inp } from "../components/govori";
import { Dropdown, type DropdownOption } from "../components/Dropdown";
import { UZ_REGIONS, districtsOf } from "../lib/regions";
import { canonicalUzPhone, formatUzPhone, isValidUzPhone, uzPhoneDigits } from "../lib/phone";

function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div className="col gap-3">
      <span
        style={{
          fontSize: 12.5,
          fontWeight: 800,
          color: "var(--faint)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {title}
      </span>
      <Card pad={0}>{children}</Card>
    </div>
  );
}

function Row({
  label,
  sub,
  children,
  last,
}: {
  label: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className="row between gap-4"
      style={{ padding: "15px 20px", borderBottom: last ? "none" : "1px solid var(--line)" }}
    >
      <div className="col" style={{ minWidth: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>{label}</span>
        {sub && <span style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>{sub}</span>}
      </div>
      {children}
    </div>
  );
}

export function Settings() {
  const { user, refreshUser, logout } = useAuth();
  const { t, lang, setLang } = useI18n();
  const nav = useNavigate();

  const [name, setName] = useState(user?.full_name ?? "");
  const [telegram, setTelegram] = useState(user?.telegram ?? "");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState(user?.phone ? uzPhoneDigits(user.phone) : "");
  const [age, setAge] = useState(user?.age ? String(user.age) : "");
  const [region, setRegion] = useState(user?.region ?? "");
  const [district, setDistrict] = useState(user?.district ?? "");
  const isTeacher = user?.role === "teacher" || user?.role === "admin";
  const isStudent = user?.role === "student";
  const [savingProfile, setSavingProfile] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);
  const [profileErr, setProfileErr] = useState<string | null>(null);

  const regionOptions: DropdownOption<string>[] = [
    { value: "", label: t("selectRegion") },
    ...UZ_REGIONS.map((r) => ({ value: r.name, label: r.name })),
  ];
  const districtOptions: DropdownOption<string>[] = [
    { value: "", label: t("selectDistrict") },
    ...districtsOf(region).map((d) => ({ value: d, label: d })),
  ];
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  async function onAvatarPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    setUploadingAvatar(true);
    try {
      const { data } = await api.post<{ upload_url: string; avatar_key: string }>(
        "/auth/me/avatar-upload-url",
        { content_type: file.type },
      );
      await uploadToPresigned(data.upload_url, file, file.type);
      await api.patch("/auth/me", { avatar_key: data.avatar_key });
      await refreshUser();
    } finally {
      setUploadingAvatar(false);
    }
  }

  // Local notification toggles (UI preference only).
  const [tg, setTg] = useState({ daily: true, feedback: true, streak: true, email: false });
  const setTgKey = (k: keyof typeof tg) => (v: boolean) => setTg((s) => ({ ...s, [k]: v }));

  const roleText =
    user?.role === "admin" ? t("adminRole") : user?.role === "teacher" ? t("teacher") : t("student");

  async function changeLang(l: Lang) {
    setLang(l);
    try {
      await api.patch("/auth/me", { preferred_language: l });
      await refreshUser();
    } catch {
      /* language still applied locally */
    }
  }

  async function changeGoal(n: number) {
    try {
      await api.patch("/auth/me", { daily_goal: n });
      await refreshUser();
    } catch {
      /* ignore */
    }
  }

  async function saveProfile() {
    setProfileErr(null);
    if (phone && !isValidUzPhone(phone)) {
      setProfileErr(t("phoneInvalid"));
      return;
    }
    setSavingProfile(true);
    setSavedMsg(false);
    try {
      await api.patch("/auth/me", {
        full_name: name || undefined,
        password: password || undefined,
        ...(phone ? { phone: canonicalUzPhone(phone) } : {}),
        ...(region ? { region } : {}),
        ...(district ? { district } : {}),
        ...(isStudent && age ? { age: Number(age) } : {}),
        ...(isTeacher ? { telegram } : {}),
      });
      await refreshUser();
      setPassword("");
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 2000);
    } finally {
      setSavingProfile(false);
    }
  }

  const langs: [Lang, string][] = LANGUAGES.map((l) => [l.code, l.label]);

  return (
    <div className="focus-wrap" style={{ maxWidth: 720, marginInline: "auto" }}>
      <div className="col gap-1" style={{ marginBottom: 22 }}>
        <h2 style={{ fontSize: 26 }}>{t("settings")}</h2>
      </div>

      <div className="col gap-5">
        {/* ---- Account ---- */}
        <Section title={t("account")}>
          <Row label={user?.full_name ?? user?.email ?? ""} sub={roleText}>
            <label
              title={t("changePhoto")}
              style={{ position: "relative", cursor: uploadingAvatar ? "default" : "pointer", flexShrink: 0 }}
            >
              <span style={{ display: "block", opacity: uploadingAvatar ? 0.5 : 1, transition: "opacity .15s" }}>
                <Avatar name={user?.full_name ?? user?.email} size={48} src={user?.avatar_url} />
              </span>
              <span
                style={{
                  position: "absolute",
                  right: -2,
                  bottom: -2,
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: "var(--primary)",
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 0 0 2px var(--surface)",
                }}
              >
                <Icon name="edit" size={11} />
              </span>
              <input
                type="file"
                accept="image/*"
                disabled={uploadingAvatar}
                onChange={onAvatarPick}
                style={{ display: "none" }}
              />
            </label>
          </Row>
          <Row label={t("email")} sub={user?.email} last />
        </Section>

        {/* ---- Profile (editable) ---- */}
        <Section title={t("profile")}>
          <div className="col gap-3" style={{ padding: 16 }}>
            <label className="col gap-2">
              <span style={{ fontSize: 13, fontWeight: 800, color: "var(--ink-soft)" }}>{t("fullName")}</span>
              <input value={name} onChange={(e) => setName(e.target.value)} style={inp} />
            </label>
            <label className="col gap-2">
              <span style={{ fontSize: 13, fontWeight: 800, color: "var(--ink-soft)" }}>{t("phone")}</span>
              <input
                inputMode="tel"
                value={phone ? formatUzPhone(phone) : ""}
                onChange={(e) => setPhone(uzPhoneDigits(e.target.value))}
                placeholder="+998 90 123 45 67"
                style={inp}
              />
            </label>
            {isStudent && (
              <label className="col gap-2">
                <span style={{ fontSize: 13, fontWeight: 800, color: "var(--ink-soft)" }}>{t("ageLabel")}</span>
                <input
                  inputMode="numeric"
                  value={age}
                  onChange={(e) => setAge(e.target.value.replace(/\D/g, "").slice(0, 3))}
                  placeholder={t("agePh")}
                  style={inp}
                />
              </label>
            )}
            <div className="col gap-2">
              <span style={{ fontSize: 13, fontWeight: 800, color: "var(--ink-soft)" }}>{t("regionLabel")}</span>
              <Dropdown
                value={region}
                onChange={(v) => {
                  setRegion(v);
                  setDistrict("");
                }}
                options={regionOptions}
                placeholder={t("selectRegion")}
              />
            </div>
            <div className="col gap-2">
              <span style={{ fontSize: 13, fontWeight: 800, color: "var(--ink-soft)" }}>{t("districtLabel")}</span>
              <Dropdown
                value={district}
                onChange={setDistrict}
                options={districtOptions}
                placeholder={region ? t("selectDistrict") : t("selectRegionFirst")}
              />
            </div>
            {isTeacher && (
              <label className="col gap-2">
                <span style={{ fontSize: 13, fontWeight: 800, color: "var(--ink-soft)" }}>{t("telegram")}</span>
                <input
                  value={telegram}
                  onChange={(e) => setTelegram(e.target.value)}
                  placeholder="@username"
                  style={inp}
                />
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("telegramHint")}</span>
              </label>
            )}
            <label className="col gap-2">
              <span style={{ fontSize: 13, fontWeight: 800, color: "var(--ink-soft)" }}>{t("changePassword")}</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("newPasswordPh")}
                style={inp}
              />
            </label>
            {profileErr && (
              <span style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700 }}>{profileErr}</span>
            )}
            <Button variant="soft" full disabled={savingProfile} onClick={saveProfile}>
              {savingProfile ? t("saving") : savedMsg ? t("saved") : t("save")}
            </Button>
          </div>
        </Section>

        {/* ---- Language ---- */}
        <Section title={t("appLanguage")}>
          <div style={{ padding: 14 }}>
            <div className="row gap-2">
              {langs.map(([code, label]) => {
                const active = lang === code;
                return (
                  <button
                    key={code}
                    onClick={() => changeLang(code)}
                    className="tap"
                    style={{
                      flex: 1,
                      padding: "11px",
                      borderRadius: "var(--r-sm)",
                      cursor: "pointer",
                      border: active ? "2px solid var(--primary)" : "2px solid var(--line)",
                      background: active ? "var(--primary-tint)" : "var(--surface)",
                      color: active ? "var(--primary-press)" : "var(--ink-soft)",
                      fontFamily: "var(--font-display)",
                      fontWeight: 800,
                      fontSize: 14,
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </Section>

        {/* ---- Daily goal (students only) ---- */}
        {user?.role === "student" && (
          <Section title={t("dailyGoal")}>
            <div style={{ padding: 14 }}>
              <div className="row gap-2">
                {[1, 2, 3, 4, 5].map((n) => {
                  const active = (user.daily_goal ?? 1) === n;
                  return (
                    <button
                      key={n}
                      onClick={() => changeGoal(n)}
                      className="tap"
                      style={{
                        flex: 1,
                        padding: "11px",
                        borderRadius: "var(--r-sm)",
                        cursor: "pointer",
                        border: active ? "2px solid var(--primary)" : "2px solid var(--line)",
                        background: active ? "var(--primary-tint)" : "var(--surface)",
                        color: active ? "var(--primary-press)" : "var(--ink-soft)",
                        fontFamily: "var(--font-display)",
                        fontWeight: 800,
                        fontSize: 14,
                      }}
                    >
                      {n}
                    </button>
                  );
                })}
              </div>
              <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10 }}>{t("perDay")}</p>
            </div>
          </Section>
        )}

        {/* ---- Notifications ---- */}
        <Section title={t("notifTitle")}>
          <Row label={t("goalToday")}>
            <Toggle on={tg.daily} set={setTgKey("daily")} />
          </Row>
          <Row label={t("teacherFeedback")}>
            <Toggle on={tg.feedback} set={setTgKey("feedback")} />
          </Row>
          <Row label={t("streakTitle")}>
            <Toggle on={tg.streak} set={setTgKey("streak")} />
          </Row>
          <Row label={t("email")} last>
            <Toggle on={tg.email} set={setTgKey("email")} />
          </Row>
        </Section>

        <Button
          variant="ghost"
          icon="logout"
          full
          style={{ color: "var(--danger)", borderColor: "var(--danger-tint)" }}
          onClick={() => {
            logout();
            nav("/login");
          }}
        >
          {t("logout")}
        </Button>
      </div>
    </div>
  );
}
