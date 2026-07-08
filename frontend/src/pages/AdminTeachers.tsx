import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import type { AdminTeacher } from "../lib/types";
import {
  Avatar,
  Button,
  Card,
  DataTable,
  Field,
  Loading,
  PageHead,
  SearchInput,
  Toolbar,
  type Column,
  inp,
} from "../components/govori";
import { useConfirm } from "../components/ConfirmDialog";

export function AdminTeachers() {
  const { t } = useI18n();
  const nav = useNavigate();
  const ask = useConfirm();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-teachers"],
    queryFn: async () => (await api.get<AdminTeacher[]>("/admin/teachers")).data,
  });

  const create = useMutation({
    mutationFn: async () =>
      (await api.post("/admin/teachers", { full_name: name, email, password })).data,
    onSuccess: () => {
      setName("");
      setEmail("");
      setPassword("");
      setOpen(false);
      setError(null);
      qc.invalidateQueries({ queryKey: ["admin-teachers"] });
    },
    onError: () => setError(t("registerError")),
  });

  const toggle = useMutation({
    mutationFn: async (tch: AdminTeacher) =>
      (await api.patch(`/admin/teachers/${tch.id}`, { is_active: !tch.is_active })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-teachers"] }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/admin/teachers/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-teachers"] }),
  });

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!data) return [];
    if (!s) return data;
    return data.filter(
      (u) => u.full_name.toLowerCase().includes(s) || u.email.toLowerCase().includes(s),
    );
  }, [data, q]);

  const columns: Column<AdminTeacher>[] = [
    {
      key: "name",
      header: t("colName"),
      render: (tch) => (
        <div className="row gap-3" style={{ minWidth: 0 }}>
          <Avatar name={tch.full_name} size={36} />
          <div className="col" style={{ minWidth: 0 }}>
            <span style={{ fontWeight: 700, fontSize: 14.5 }} className="truncate">
              {tch.full_name}
            </span>
            <span style={{ fontSize: 12.5, color: "var(--muted)" }} className="truncate">
              {tch.email}
            </span>
          </div>
        </div>
      ),
    },
    {
      key: "tests",
      header: t("testsCount"),
      align: "right",
      hideSm: true,
      render: (tch) => (
        <span className="mono" style={{ color: "var(--muted)" }}>
          {tch.question_count}
        </span>
      ),
    },
    {
      key: "status",
      header: t("colStatus"),
      hideSm: true,
      render: (tch) => (
        <span
          className="row gap-2"
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: tch.is_active ? "var(--success)" : "var(--faint)",
            whiteSpace: "nowrap",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: tch.is_active ? "var(--success)" : "var(--faint)",
            }}
          />
          {tch.is_active ? t("active") : t("inactive")}
        </span>
      ),
    },
    {
      key: "actions",
      header: t("colActions"),
      align: "right",
      render: (tch) => (
        <div
          className="row gap-2 wrap"
          style={{ justifyContent: "flex-end" }}
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            size="sm"
            variant="ghost"
            icon={tch.is_active ? "x" : "check"}
            onClick={() => toggle.mutate(tch)}
          >
            {tch.is_active ? t("deactivate") : t("activate")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon="trash"
            style={{ color: "var(--danger)" }}
            onClick={async () => {
              if (
                await ask({
                  message: t("deleteTeacherConfirm"),
                  confirmText: t("delete"),
                  destructive: true,
                })
              )
                remove.mutate(tch.id);
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
      <PageHead title={t("teachersTitle")} sub={t("teachersHint")} />

      <Toolbar
        left={<SearchInput value={q} onChange={setQ} placeholder={t("searchPh")} />}
        right={
          <Button icon="plus" onClick={() => setOpen((o) => !o)}>
            {t("addTeacher")}
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
              <input
                style={inp}
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label={t("email")}>
              <input
                style={inp}
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teacher@example.com"
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
              {create.isPending ? t("saving") : t("addTeacher")}
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
          rowKey={(tch) => tch.id}
          onRowClick={(tch) => nav(`/admin/teachers/${tch.id}`)}
          minWidth={640}
          empty={t("noTeachers")}
        />
      )}
    </div>
  );
}
