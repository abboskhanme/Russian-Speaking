import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import type { AdminStudent } from "../lib/types";
import { Avatar, Button, Card, EmptyState, Icon, Loading, PageHead } from "../components/govori";
import { useConfirm } from "../components/ConfirmDialog";

export function AdminStudents() {
  const { t } = useI18n();
  const ask = useConfirm();
  const qc = useQueryClient();
  const [q, setQ] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-students"],
    queryFn: async () => (await api.get<AdminStudent[]>("/admin/students")).data,
  });

  const toggle = useMutation({
    mutationFn: async (s: AdminStudent) =>
      (await api.patch(`/admin/students/${s.id}`, { is_active: !s.is_active })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-students"] }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/admin/students/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-students"] }),
  });

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!data) return [];
    if (!s) return data;
    return data.filter(
      (u) => u.full_name.toLowerCase().includes(s) || u.email.toLowerCase().includes(s),
    );
  }, [data, q]);

  const cols = "2.2fr 1fr 1fr 1.4fr";

  return (
    <div className="focus-wrap">
      <PageHead title={t("studentsTitle")} sub={t("studentsHint")} />

      <div
        className="row gap-2"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--line-2)",
          borderRadius: "var(--r-pill)",
          padding: "9px 16px",
          marginBottom: 18,
          maxWidth: 360,
        }}
      >
        <Icon name="search" size={18} style={{ color: "var(--muted)" }} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("searchPh")}
          style={{
            border: "none",
            background: "transparent",
            outline: "none",
            flex: 1,
            fontSize: 14,
            color: "var(--ink)",
          }}
        />
      </div>

      {isLoading ? (
        <Loading />
      ) : !list.length ? (
        <EmptyState text={t("noStudents")} />
      ) : (
        <Card pad={0}>
          <div
            className="t-head"
            style={{
              display: "grid",
              gridTemplateColumns: cols,
              padding: "14px 20px",
              borderBottom: "1px solid var(--line)",
              fontSize: 12,
              fontWeight: 800,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            <span>{t("colName")}</span>
            <span>{t("submissionsCount")}</span>
            <span>{t("colStatus")}</span>
            <span style={{ textAlign: "right" }}>{t("colActions")}</span>
          </div>
          {list.map((s, i) => (
            <div
              key={s.id}
              className="t-row"
              style={{
                display: "grid",
                gridTemplateColumns: cols,
                padding: "12px 20px",
                borderBottom: i < list.length - 1 ? "1px solid var(--line)" : "none",
                alignItems: "center",
              }}
            >
              <div className="row gap-3" style={{ minWidth: 0 }}>
                <Avatar name={s.full_name} size={38} />
                <div className="col" style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 700, fontSize: 14.5 }} className="truncate">
                    {s.full_name}
                  </span>
                  <span style={{ fontSize: 12.5, color: "var(--muted)" }} className="truncate">
                    {s.email}
                  </span>
                </div>
              </div>
              <span className="t-hide-sm mono" style={{ fontSize: 13.5, color: "var(--muted)" }}>
                {s.submission_count} {t("submissionsCount")}
              </span>
              <span className="t-hide-sm">
                <span
                  className="row gap-2"
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: s.is_active ? "var(--success)" : "var(--faint)",
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: s.is_active ? "var(--success)" : "var(--faint)",
                    }}
                  />
                  {s.is_active ? t("active") : t("inactive")}
                </span>
              </span>
              <div className="row gap-2" style={{ justifyContent: "flex-end" }}>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={s.is_active ? "x" : "check"}
                  onClick={() => toggle.mutate(s)}
                >
                  {s.is_active ? t("deactivate") : t("activate")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="trash"
                  style={{ color: "var(--danger)" }}
                  onClick={async () => {
                    if (
                      await ask({
                        message: t("deleteStudentConfirm"),
                        confirmText: t("delete"),
                        destructive: true,
                      })
                    )
                      remove.mutate(s.id);
                  }}
                >
                  {t("delete")}
                </Button>
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
