import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { Card, Button, Pill, Icon, Mascot } from "../components/govori";

export function PremiumInfo() {
  const { user } = useAuth();
  const { t } = useI18n();
  const nav = useNavigate();
  const perks = [t("premiumCardText"), t("tip2"), t("achievements")];

  return (
    <div
      className="focus-wrap anim-fade-up"
      style={{ maxWidth: 520, marginInline: "auto", textAlign: "center", paddingTop: 12 }}
    >
      <button
        onClick={() => nav(-1)}
        className="row gap-2 tap"
        style={{
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: "var(--ink-soft)",
          fontFamily: "var(--font-display)",
          fontWeight: 800,
          fontSize: 15,
          marginBottom: 8,
        }}
      >
        <Icon name="chevL" size={18} />
        {t("back")}
      </button>

      <Mascot size={104} mood="proud" />
      <h2 style={{ fontSize: 28, marginTop: 8 }}>{t("premiumAccess")}</h2>
      <p style={{ color: "var(--muted)", fontSize: 15, marginTop: 6 }}>{t("premiumCardText")}</p>

      {user?.is_premium && (
        <div style={{ marginTop: 16, display: "flex", justifyContent: "center" }}>
          <Pill hue={152} icon="check">
            {t("premiumActive")}
          </Pill>
        </div>
      )}

      <Card style={{ marginTop: 22, textAlign: "left" }}>
        <div className="col gap-3">
          {perks.map((p, i) => (
            <div key={i} className="row gap-3">
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 7,
                  background: "var(--success-tint)",
                  color: "var(--success)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Icon name="check" size={14} sw={3} />
              </div>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{p}</span>
            </div>
          ))}
        </div>

        {!user?.is_premium && (
          <div
            style={{
              marginTop: 18,
              padding: 14,
              background: "var(--surface-2)",
              borderRadius: "var(--r-md)",
              textAlign: "center",
            }}
          >
            <div style={{ fontWeight: 800, fontFamily: "var(--font-display)", fontSize: 16 }}>
              {t("contactTeacher")}
            </div>
            <span style={{ fontSize: 12.5, color: "var(--faint)" }}>{t("limitReachedHint")}</span>
          </div>
        )}
      </Card>

      <div className="col gap-2" style={{ marginTop: 18 }}>
        <Button full size="lg" icon="sparkles" onClick={() => nav("/questions")}>
          {t("startPracticing")}
        </Button>
      </div>
    </div>
  );
}
