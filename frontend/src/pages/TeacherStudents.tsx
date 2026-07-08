import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { formatUzPhone } from "../lib/phone";
import type { StudentManage } from "../lib/types";
import {
  Avatar,
  Button,
  DataTable,
  Loading,
  PageHead,
  Pill,
  SearchInput,
  Toolbar,
  type Column,
} from "../components/govori";

export function TeacherStudents() {
  const { t } = useI18n();
  const nav = useNavigate();
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

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!data) return [];
    if (!needle) return data;
    return data.filter(
      (s) =>
        s.full_name.toLowerCase().includes(needle) ||
        s.email.toLowerCase().includes(needle),
    );
  }, [data, q]);

  const columns: Column<StudentManage>[] = [
    {
      key: "name",
      header: t("colName"),
      width: 260,
      render: (s) => (
        <div className="row gap-3" style={{ minWidth: 0 }}>
          <Avatar name={s.full_name} size={36} />
          <div className="col" style={{ minWidth: 0 }}>
            <span className="truncate" style={{ fontWeight: 700, fontSize: 14.5 }}>
              {s.full_name}
            </span>
            <span className="truncate" style={{ fontSize: 12.5, color: "var(--muted)" }}>
              {s.email}
            </span>
          </div>
        </div>
      ),
    },
    {
      key: "phone",
      header: t("colPhone"),
      hideSm: true,
      render: (s) => (
        <span className="mono" style={{ color: "var(--ink-soft)" }}>
          {s.phone ? formatUzPhone(s.phone) : "—"}
        </span>
      ),
    },
    {
      key: "address",
      header: t("colAddress"),
      hideSm: true,
      render: (s) => (
        <span className="truncate" style={{ color: "var(--ink-soft)" }}>
          {[s.region, s.district].filter(Boolean).join(", ") || "—"}
        </span>
      ),
    },
    {
      key: "registered",
      header: t("colRegistered"),
      hideSm: true,
      render: (s) => (
        <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>
          {new Date(s.created_at).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: "submissions",
      header: t("trialAttempts"),
      align: "right",
      hideSm: true,
      render: (s) => (
        <span className="mono" style={{ color: "var(--muted)" }}>
          {s.submission_count}
        </span>
      ),
    },
    {
      key: "status",
      header: t("colStatus"),
      render: (s) =>
        s.is_premium ? (
          <Pill hue={70} size="sm" icon="star">
            {t("premiumBadge")}
          </Pill>
        ) : (
          <Pill hue={248} size="sm">
            {t("freeBadge")}
          </Pill>
        ),
    },
    {
      key: "actions",
      header: t("colActions"),
      align: "right",
      render: (s) => {
        const busy = setPremium.isPending && setPremium.variables?.id === s.id;
        return (
          <div
            className="row"
            style={{ justifyContent: "flex-end", whiteSpace: "nowrap" }}
            onClick={(e) => e.stopPropagation()}
          >
            {s.is_premium ? (
              <Button
                size="sm"
                variant="ghost"
                icon="x"
                disabled={busy}
                onClick={() => setPremium.mutate({ id: s.id, value: false })}
              >
                {busy ? "…" : t("revokePremium")}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                icon="star"
                style={{ color: "oklch(0.55 0.14 70)" }}
                disabled={busy}
                onClick={() => setPremium.mutate({ id: s.id, value: true })}
              >
                {busy ? "…" : t("grantPremium")}
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="focus-wrap">
      <PageHead title={t("studentsTitle")} sub={t("studentsManageHint")} />

      <Toolbar
        left={<SearchInput value={q} onChange={setQ} placeholder={t("searchPh")} />}
      />

      {isLoading ? (
        <Loading />
      ) : (
        <DataTable
          columns={columns}
          rows={list}
          rowKey={(s) => s.id}
          onRowClick={(s) => nav(`/teacher/students/${s.id}`)}
          minWidth={1000}
          empty={t("noStudents")}
        />
      )}
    </div>
  );
}
