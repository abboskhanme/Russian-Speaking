import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { friendlyError } from "../lib/errors";
import { useI18n } from "../lib/i18n";
import { formatUzPhone } from "../lib/phone";
import type { AdminStudent } from "../lib/types";
import {
  Avatar,
  Button,
  Card,
  DataTable,
  Field,
  Loading,
  PageHead,
  Pill,
  SearchInput,
  Toolbar,
  type Column,
  inp,
} from "../components/govori";
import { useConfirm } from "../components/ConfirmDialog";

export function AdminStudents() {
  const { t } = useI18n();
  const nav = useNavigate();
  const ask = useConfirm();
  const qc = useQueryClient();
  const [q, setQ] = useState("");

  // Create-student form
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-students"],
    queryFn: async () => (await api.get<AdminStudent[]>("/admin/students")).data,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-students"] });

  const create = useMutation({
    mutationFn: async () =>
      (await api.post("/admin/students", { full_name: name, email, password })).data,
    onSuccess: () => {
      invalidate();
      setOpen(false);
      setName("");
      setEmail("");
      setPassword("");
      setError(null);
    },
    onError: (e: unknown) => {
      // Never echo the raw server `detail` — show a safe, friendly message.
      setError(friendlyError(e, t));
    },
  });

  const toggle = useMutation({
    mutationFn: async (s: AdminStudent) =>
      (await api.patch(`/admin/students/${s.id}`, { is_active: !s.is_active })).data,
    onSuccess: invalidate,
  });

  const premium = useMutation({
    mutationFn: async (s: AdminStudent) =>
      (await api.patch(`/admin/students/${s.id}`, { is_premium: !s.is_premium })).data,
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/admin/students/${id}`),
    onSuccess: invalidate,
  });

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!data) return [];
    if (!s) return data;
    return data.filter(
      (u) => u.full_name.toLowerCase().includes(s) || u.email.toLowerCase().includes(s),
    );
  }, [data, q]);

  const columns: Column<AdminStudent>[] = [
    {
      key: "name",
      header: t("colName"),
      width: 260,
      render: (s) => (
        <div className="row gap-3" style={{ minWidth: 0 }}>
          <Avatar name={s.full_name} size={36} />
          <div className="col" style={{ minWidth: 0 }}>
            <span style={{ fontWeight: 700, fontSize: 14.5 }} className="truncate">
              {s.full_name}
            </span>
            <span style={{ fontSize: 12.5, color: "var(--muted)" }} className="truncate">
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
      header: t("submissionsCount"),
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
      render: (s) => (
        <span className="row gap-2 wrap">
          <span
            className="row gap-2"
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: s.is_active ? "var(--success)" : "var(--faint)",
              whiteSpace: "nowrap",
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
          {s.is_premium && (
            <Pill hue={70} size="sm" icon="sparkles">
              {t("premium")}
            </Pill>
          )}
        </span>
      ),
    },
    {
      key: "actions",
      header: t("colActions"),
      align: "right",
      render: (s) => (
        <div
          className="row gap-2"
          style={{ justifyContent: "flex-end", whiteSpace: "nowrap" }}
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            size="sm"
            variant="ghost"
            icon="sparkles"
            style={{ color: s.is_premium ? "var(--muted)" : "oklch(0.55 0.14 70)" }}
            onClick={() => premium.mutate(s)}
          >
            {s.is_premium ? t("revokePremium") : t("grantPremium")}
          </Button>
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
      ),
    },
  ];

  return (
    <div className="focus-wrap">
      <PageHead title={t("studentsTitle")} sub={t("studentsHint")} />

      <Toolbar
        left={<SearchInput value={q} onChange={setQ} placeholder={t("searchPh")} />}
        right={
          <Button icon="plus" onClick={() => setOpen((o) => !o)}>
            {t("addStudent")}
          </Button>
        }
      />

      {open && (
        <Card style={{ marginBottom: 18 }}>
          <form
            className="col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <Field label={t("fullName")}>
              <input style={inp} required value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={t("email")}>
              <input
                style={inp}
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="student@example.com"
              />
            </Field>
            <Field label={t("password")}>
              <input
                style={inp}
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            {error && (
              <p style={{ fontSize: 14, fontWeight: 700, color: "var(--danger)", margin: 0 }}>{error}</p>
            )}
            <Button type="submit" full disabled={create.isPending}>
              {create.isPending ? t("saving") : t("addStudent")}
            </Button>
          </form>
        </Card>
      )}

      {isLoading ? (
        <Loading />
      ) : (
        <DataTable
          columns={columns}
          rows={list}
          rowKey={(s) => s.id}
          onRowClick={(s) => nav(`/admin/students/${s.id}`)}
          minWidth={1000}
          empty={t("noStudents")}
        />
      )}
    </div>
  );
}
