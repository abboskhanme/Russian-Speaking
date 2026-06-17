import { useNavigate } from "react-router-dom";
import { useI18n } from "../lib/i18n";
import { Button, Mascot } from "../components/govori";

export function NotFound() {
  const { t } = useI18n();
  const nav = useNavigate();
  return (
    <div className="focus-wrap" style={{ maxWidth: 460, marginInline: "auto", textAlign: "center", paddingTop: 36 }}>
      <Mascot size={120} mood="thinking" />
      <h1
        style={{
          fontSize: 72,
          marginTop: 8,
          background: "linear-gradient(135deg, oklch(0.72 0.18 52), oklch(0.62 0.19 38))",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          letterSpacing: "-0.04em",
        }}
      >
        404
      </h1>
      <p style={{ color: "var(--muted)", fontSize: 15, marginTop: 12 }}>{t("notfound.text")}</p>
      <Button size="lg" icon="home" style={{ marginTop: 22 }} onClick={() => nav("/")}>
        {t("notfound.home")}
      </Button>
    </div>
  );
}
