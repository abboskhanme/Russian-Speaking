import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import type { TeacherContact } from "../lib/types";
import { Avatar, Card, EmptyState, Icon, Loading, Mascot } from "../components/govori";

/** A single contact action row (phone / telegram / email). */
function ContactRow({ icon, label, value, href }: { icon: string; label: string; value: string; href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="row gap-3 tap"
      style={{
        alignItems: "center",
        padding: "12px 14px",
        borderRadius: "var(--r-sm)",
        background: "var(--surface-2)",
        textDecoration: "none",
        color: "var(--ink)",
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          background: "var(--primary-tint)",
          color: "var(--primary)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Icon name={icon} size={18} />
      </div>
      <div className="col" style={{ minWidth: 0 }}>
        <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700 }}>{label}</span>
        <span className="truncate" style={{ fontSize: 15, fontWeight: 700 }}>{value}</span>
      </div>
      <Icon name="chevR" size={16} style={{ color: "var(--faint)", marginLeft: "auto" }} />
    </a>
  );
}

export function Contact() {
  const { t } = useI18n();
  const { data, isLoading } = useQuery({
    queryKey: ["my-teachers"],
    queryFn: async () => (await api.get<TeacherContact[]>("/users/my-teachers")).data,
  });

  const tgHref = (handle: string) => {
    const h = handle.trim().replace(/^@/, "").replace(/^https?:\/\/t\.me\//, "");
    return `https://t.me/${h}`;
  };

  return (
    <div className="focus-wrap">
      <Card
        style={{
          marginBottom: 18,
          background: "linear-gradient(135deg, var(--primary-tint), var(--surface))",
        }}
      >
        <div className="row gap-3">
          <Mascot size={56} mood="happy" float={false} />
          <div className="col">
            <h3 style={{ fontSize: 19 }}>{t("contactTitle")}</h3>
            <span style={{ fontSize: 13.5, color: "var(--muted)" }}>{t("contactHint")}</span>
          </div>
        </div>
      </Card>

      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <EmptyState text={t("contactNoTeacher")} />
      ) : (
        <div className="g2">
          {data.map((tch) => (
            <Card key={tch.id}>
              <div className="row gap-3" style={{ marginBottom: 14 }}>
                <Avatar name={tch.full_name} size={44} />
                <div className="col" style={{ minWidth: 0 }}>
                  <span className="truncate" style={{ fontSize: 16, fontWeight: 800 }}>{tch.full_name}</span>
                  <span style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 600 }}>{t("teacher")}</span>
                </div>
              </div>
              <div className="col gap-2">
                {tch.phone && (
                  <ContactRow icon="phone" label={t("contactCall")} value={tch.phone} href={`tel:${tch.phone}`} />
                )}
                {tch.telegram && (
                  <ContactRow icon="send" label="Telegram" value={tch.telegram} href={tgHref(tch.telegram)} />
                )}
                {tch.email && (
                  <ContactRow icon="message" label={t("email")} value={tch.email} href={`mailto:${tch.email}`} />
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
