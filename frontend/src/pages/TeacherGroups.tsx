import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import type { Group } from "../lib/types";
import { useConfirm } from "../components/ConfirmDialog";
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  Icon,
  Loading,
  PageHead,
  Pill,
  inp,
} from "../components/govori";

/** Stable hue per group id, for the gradient icon. */
function groupHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

export function TeacherGroups() {
  const { t } = useI18n();
  const nav = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [name, setName] = useState("");

  const { data: groups, isLoading } = useQuery({
    queryKey: ["teacher-groups"],
    queryFn: async () => (await api.get<Group[]>("/groups")).data,
  });

  const create = useMutation({
    mutationFn: async () => (await api.post<Group>("/groups", { name })).data,
    onSuccess: (g) => {
      setName("");
      qc.invalidateQueries({ queryKey: ["teacher-groups"] });
      nav(`/teacher/groups/${g.id}`);
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/groups/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["teacher-groups"] }),
  });

  // Admin only: assign an admin-created group to a real teacher.
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { data: teachers } = useQuery({
    queryKey: ["admin-teachers"],
    enabled: isAdmin,
    queryFn: async () =>
      (await api.get<{ id: string; full_name: string }[]>("/admin/teachers")).data,
  });
  const assign = useMutation({
    mutationFn: async ({ groupId, teacherId }: { groupId: string; teacherId: string }) =>
      api.patch(`/groups/${groupId}/teacher`, { teacher_id: teacherId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["teacher-groups"] }),
  });

  async function onDelete(g: Group) {
    if (await confirm({ message: t("deleteGroupConfirm"), destructive: true }))
      remove.mutate(g.id);
  }

  return (
    <div className="focus-wrap">
      <PageHead
        title={t("navGroups")}
        sub={t("groupsHint")}
        action={
          <form
            className="row gap-2 wrap"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim() && !create.isPending) create.mutate();
            }}
          >
            <input
              placeholder={t("groupNamePh")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ ...inp, width: 220, minWidth: 0, maxWidth: "100%" }}
            />
            <Button
              type="submit"
              icon="plus"
              disabled={!name.trim() || create.isPending}
            >
              {create.isPending ? "…" : t("newGroup")}
            </Button>
          </form>
        }
      />

      {isLoading ? (
        <Loading />
      ) : !groups?.length ? (
        <EmptyState text={t("noGroups")} />
      ) : (
        <div className="g3">
          {groups.map((g) => {
            const hue = groupHue(g.id);
            return (
              <Card key={g.id} hover onClick={() => nav(`/teacher/groups/${g.id}`)}>
                <div className="row between" style={{ marginBottom: 14 }}>
                  <div
                    style={{
                      width: 50,
                      height: 50,
                      borderRadius: 15,
                      background: `linear-gradient(135deg, oklch(0.76 0.13 ${hue}), oklch(0.64 0.17 ${hue}))`,
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Icon name="users" size={24} />
                  </div>
                  <button
                    type="button"
                    aria-label="delete"
                    className="tap"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(g);
                    }}
                    style={{
                      border: "none",
                      background: "transparent",
                      color: "var(--danger)",
                      cursor: "pointer",
                      display: "flex",
                      padding: 4,
                    }}
                  >
                    <Icon name="trash" size={18} />
                  </button>
                </div>
                <h3 style={{ fontSize: 17 }}>{g.name}</h3>
                <div
                  className="row gap-4"
                  style={{ marginTop: 10, color: "var(--muted)", fontSize: 13 }}
                >
                  <span className="row gap-1">
                    <Icon name="user" size={15} />
                    {g.member_count} {t("members")}
                  </span>
                </div>

                {/* Admin: (re)assign this group to a real teacher */}
                {isAdmin && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line)" }}
                  >
                    <div className="row between" style={{ alignItems: "center", marginBottom: 8, gap: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: "var(--faint)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        {t("groupTeacher")}
                      </span>
                      {g.teacher_name ? (
                        <span className="row gap-2" style={{ minWidth: 0, alignItems: "center" }}>
                          <Avatar name={g.teacher_name} size={22} />
                          <span className="truncate" style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-soft)" }}>
                            {g.teacher_name}
                          </span>
                        </span>
                      ) : (
                        <Pill hue={28} size="sm">{t("noTeacher")}</Pill>
                      )}
                    </div>
                    <div style={{ position: "relative" }}>
                      <select
                        value={teachers?.some((tt) => tt.id === g.teacher_id) ? g.teacher_id ?? "" : ""}
                        disabled={assign.isPending}
                        onChange={(e) => {
                          if (e.target.value) assign.mutate({ groupId: g.id, teacherId: e.target.value });
                        }}
                        style={{
                          ...inp,
                          appearance: "none",
                          WebkitAppearance: "none",
                          MozAppearance: "none",
                          paddingRight: 38,
                          fontSize: 13.5,
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        <option value="">{t("assignTeacher")}</option>
                        {(teachers ?? []).map((tt) => (
                          <option key={tt.id} value={tt.id}>{tt.full_name}</option>
                        ))}
                      </select>
                      <Icon
                        name="chevD"
                        size={16}
                        style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "var(--muted)" }}
                      />
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
