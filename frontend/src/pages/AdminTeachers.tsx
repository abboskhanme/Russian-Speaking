import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import type { AdminTeacher } from "../lib/types";
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  Field,
  Loading,
  PageHead,
  inp,
} from "../components/govori";
import { useConfirm } from "../components/ConfirmDialog";

export function AdminTeachers() {
  const { t } = useI18n();
  const ask = useConfirm();
  const qc = useQueryClient();
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

  const cols = "2.2fr 1fr 1fr 1.4fr";

  return (
    <div className="focus-wrap">
      <PageHead
        title={t("teachersTitle")}
        sub={t("teachersHint")}
        action={
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
      ) : !data?.length ? (
        <EmptyState text={t("noTeachers")} />
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
            <span>{t("testsCount")}</span>
            <span>{t("colStatus")}</span>
            <span style={{ textAlign: "right" }}>{t("colActions")}</span>
          </div>
          {data.map((tch, i) => (
            <div
              key={tch.id}
              className="t-row"
              style={{
                display: "grid",
                gridTemplateColumns: cols,
                padding: "12px 20px",
                borderBottom: i < data.length - 1 ? "1px solid var(--line)" : "none",
                alignItems: "center",
              }}
            >
              <div className="row gap-3" style={{ minWidth: 0 }}>
                <Avatar name={tch.full_name} size={38} />
                <div className="col" style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 700, fontSize: 14.5 }} className="truncate">
                    {tch.full_name}
                  </span>
                  <span style={{ fontSize: 12.5, color: "var(--muted)" }} className="truncate">
                    {tch.email}
                  </span>
                </div>
              </div>
              <span
                className="t-hide-sm mono"
                style={{ fontSize: 13.5, color: "var(--muted)" }}
              >
                {tch.question_count} {t("testsCount")}
              </span>
              <span className="t-hide-sm">
                <span
                  className="row gap-2"
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: tch.is_active ? "var(--success)" : "var(--faint)",
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
              </span>
              <div className="row gap-2" style={{ justifyContent: "flex-end" }}>
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
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
