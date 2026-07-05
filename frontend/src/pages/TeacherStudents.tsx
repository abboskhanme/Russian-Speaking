import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import type { StudentManage } from "../lib/types";
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  Icon,
  Loading,
  PageHead,
  Pill,
} from "../components/govori";

const COLS = "2fr 0.8fr 1.3fr 1fr 1.1fr";

export function TeacherStudents() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [q, setQ] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["manage-students"],
    queryFn: async () => (await api.get<StudentManage[]>("/users/students")).data,
  });

  const setPremium = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: boolean }) =>
      (await api.patch(`/users/students/${id}/premium`, { is_premium: value })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["manage-students"] }),
  });

  const list = (data ?? []).filter((s) => {
    const needle = q.toLowerCase();
    return (
      s.full_name.toLowerCase().includes(needle) ||
      s.email.toLowerCase().includes(needle)
    );
  });

  return (
    <div className="focus-wrap">
      <PageHead title={t("studentsTitle")} sub={t("studentsManageHint")} />

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
              gridTemplateColumns: COLS,
              columnGap: 12,
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
            <span className="t-hide-sm">{t("colLevel")}</span>
            <span className="t-hide-sm">{t("trialAttempts")}</span>
            <span className="t-hide-sm">{t("premiumBadge")}</span>
            <span style={{ textAlign: "right" }}>{t("colActions")}</span>
          </div>

          {list.map((s, i) => {
            const busy =
              setPremium.isPending && setPremium.variables?.id === s.id;
            const used = s.submission_count;
            return (
              <div
                key={s.id}
                className="t-row"
                style={{
                  display: "grid",
                  gridTemplateColumns: COLS,
                  columnGap: 12,
                  padding: "12px 20px",
                  borderBottom:
                    i < list.length - 1 ? "1px solid var(--line)" : "none",
                  alignItems: "center",
                }}
              >
                <div className="row gap-3" style={{ minWidth: 0 }}>
                  <Avatar name={s.full_name} size={38} />
                  <div className="col" style={{ minWidth: 0 }}>
                    <span
                      className="truncate"
                      style={{ fontWeight: 700, fontSize: 14.5 }}
                    >
                      {s.full_name}
                    </span>
                    <span
                      className="truncate"
                      style={{ fontSize: 12.5, color: "var(--muted)" }}
                    >
                      {s.email}
                    </span>
                  </div>
                </div>

                <span className="t-hide-sm">
                  {s.is_premium ? (
                    <Pill hue={47} size="sm" icon="star">
                      {t("premiumBadge")}
                    </Pill>
                  ) : (
                    <Pill hue={248} size="sm">
                      {t("freeBadge")}
                    </Pill>
                  )}
                </span>

                <div className="row gap-2 t-hide-sm" style={{ minWidth: 0, alignItems: "center" }}>
                  <span
                    className="mono"
                    style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-soft)", whiteSpace: "nowrap" }}
                  >
                    {used}
                  </span>
                  <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{t("trialAttempts")}</span>
                </div>

                <span className="t-hide-sm" style={{ fontSize: 13, color: "var(--muted)" }}>
                  {s.is_premium ? t("premiumBadge") : t("freeBadge")}
                </span>

                <div style={{ justifySelf: "end" }}>
                  {s.is_premium ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="x"
                      disabled={busy}
                      onClick={() =>
                        setPremium.mutate({ id: s.id, value: false })
                      }
                    >
                      {busy ? "…" : t("revokePremium")}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="soft"
                      icon="star"
                      disabled={busy}
                      onClick={() =>
                        setPremium.mutate({ id: s.id, value: true })
                      }
                    >
                      {busy ? "…" : t("grantPremium")}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
