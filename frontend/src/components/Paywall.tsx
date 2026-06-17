import { useI18n } from "../lib/i18n";
import { Button, Card, Icon, Mascot } from "./govori";

/** Shown when a free student has used all their free attempts. */
export function Paywall() {
  const { t } = useI18n();
  const perks = [
    t("perkUnlimited"),
    t("perkAnalysis"),
    t("perkHistory"),
    t("perkGroups"),
  ];
  return (
    <div className="focus-wrap" style={{ maxWidth: 520, marginInline: "auto", textAlign: "center", paddingTop: 12 }}>
      <Mascot size={104} mood="proud" />
      <h2 style={{ fontSize: 28, marginTop: 8 }}>{t("limitReached")}</h2>
      <p style={{ color: "var(--muted)", fontSize: 15, marginTop: 6 }}>{t("limitReachedHint")}</p>

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

        <div
          style={{
            marginTop: 18,
            padding: 14,
            background: "var(--surface-2)",
            borderRadius: "var(--r-md)",
            textAlign: "center",
          }}
        >
          <span style={{ fontSize: 13, color: "var(--muted)" }}>{t("premiumGrantedByLabel")}</span>
          <div style={{ fontWeight: 800, fontFamily: "var(--font-display)", fontSize: 16, marginTop: 2 }}>
            {t("premiumGrantedBy")}
          </div>
          <span style={{ fontSize: 12.5, color: "var(--faint)" }}>{t("paymentsComingSoon")}</span>
        </div>
      </Card>

      <div className="col gap-2" style={{ marginTop: 18 }}>
        <Button full size="lg" icon="message">
          {t("contactTeacher")}
        </Button>
      </div>
    </div>
  );
}
