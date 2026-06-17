import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import type { AppNotification } from "../lib/types";
import { Button, Card, Icon, Loading, EmptyState, type IconName } from "../components/govori";

const META: Record<string, { icon: IconName; hue: number }> = {
  assignment_new: { icon: "book", hue: 305 },
  assignment_done: { icon: "check", hue: 152 },
  result_ready: { icon: "award", hue: 80 },
};
function meta(type: string): { icon: IconName; hue: number } {
  return META[type] ?? { icon: "bell", hue: 47 };
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "hozir";
  if (m < 60) return `${m} daq`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} soat`;
  return `${Math.floor(h / 24)} kun`;
}

export function Notifications() {
  const { t } = useI18n();
  const nav = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => (await api.get<AppNotification[]>("/notifications")).data,
  });

  // Mark everything read on open, then refresh the bell badge.
  useEffect(() => {
    api.post("/notifications/read-all").then(() => {
      qc.invalidateQueries({ queryKey: ["notif-unread"] });
    });
  }, [qc]);

  const removeOne = useMutation({
    mutationFn: async (id: string) => api.delete(`/notifications/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const clearAll = useMutation({
    mutationFn: async () => api.delete("/notifications"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  return (
    <div className="focus-wrap" style={{ maxWidth: 680, marginInline: "auto" }}>
      <div className="row between wrap gap-4" style={{ marginBottom: 20 }}>
        <div className="col gap-1">
          <h2 style={{ fontSize: 26 }}>{t("notifTitle")}</h2>
        </div>
        {data && data.length > 0 && (
          <Button variant="ghost" size="sm" icon="check" onClick={() => clearAll.mutate()}>
            {t("notifClearAll")}
          </Button>
        )}
      </div>

      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <EmptyState text={t("notifEmpty")} />
      ) : (
        <Card pad={0}>
          {data.map((n, i) => {
            const m = meta(n.type);
            return (
              <div
                key={n.id}
                className="row gap-3"
                style={{
                  padding: "14px 18px",
                  borderBottom: i < data.length - 1 ? "1px solid var(--line)" : "none",
                  background: n.is_read ? "transparent" : "var(--primary-tint)",
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    background: `oklch(0.95 0.05 ${m.hue})`,
                    color: `oklch(0.5 0.15 ${m.hue})`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Icon name={m.icon} size={19} />
                </div>
                <button
                  className="col grow truncate"
                  onClick={() => n.link && nav(n.link)}
                  disabled={!n.link}
                  style={{
                    minWidth: 0,
                    textAlign: "left",
                    border: "none",
                    background: "transparent",
                    padding: 0,
                    cursor: n.link ? "pointer" : "default",
                  }}
                >
                  <span style={{ fontSize: 14.5, fontWeight: 700, color: "var(--ink)" }}>{n.title}</span>
                  {n.body && <span style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>{n.body}</span>}
                </button>
                <span style={{ fontSize: 12, color: "var(--faint)", whiteSpace: "nowrap", alignSelf: "center" }}>
                  {timeAgo(n.created_at)}
                </span>
                {!n.is_read && (
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: "var(--primary)",
                      flexShrink: 0,
                      alignSelf: "center",
                    }}
                  />
                )}
                <button
                  onClick={() => removeOne.mutate(n.id)}
                  aria-label={t("delete")}
                  title={t("delete")}
                  className="tap"
                  style={{
                    flexShrink: 0,
                    border: "none",
                    background: "transparent",
                    color: "var(--faint)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    padding: 4,
                  }}
                >
                  <Icon name="x" size={17} />
                </button>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
