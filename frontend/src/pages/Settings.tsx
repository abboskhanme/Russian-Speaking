import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { LANGUAGES, useI18n, type Lang } from "../lib/i18n";
import { Avatar, Button, Card, Toggle, inp } from "../components/govori";

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
  const [password, setPassword] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);

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
    setSavingProfile(true);
    setSavedMsg(false);
    try {
      await api.patch("/auth/me", {
        full_name: name || undefined,
        password: password || undefined,
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
            <Avatar name={user?.full_name ?? user?.email} size={42} />
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
              <span style={{ fontSize: 13, fontWeight: 800, color: "var(--ink-soft)" }}>{t("changePassword")}</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("newPasswordPh")}
                style={inp}
              />
            </label>
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
