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
  DataTable,
  Icon,
  Loading,
  PageHead,
  Pill,
  Toolbar,
  inp,
  type Column,
} from "../components/govori";
import { Dropdown, type DropdownOption } from "../components/Dropdown";

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

  const teacherOptions: DropdownOption<string>[] = [
    { value: "", label: t("assignTeacher") },
    ...(teachers ?? []).map((tt) => ({ value: tt.id, label: tt.full_name })),
  ];

  const columns: Column<Group>[] = [
    {
      key: "name",
      header: t("colName"),
      render: (g) => (
        <div className="row gap-3" style={{ minWidth: 0 }}>
          <Icon name="users" size={18} style={{ color: "var(--faint)", flexShrink: 0 }} />
          <span className="truncate" style={{ fontWeight: 700, fontSize: 15 }}>{g.name}</span>
        </div>
      ),
    },
    {
      key: "join",
      header: t("joinCode"),
      hideSm: true,
      render: (g) => (
        <span className="mono" style={{ color: "var(--ink-soft)" }}>{g.join_code}</span>
      ),
    },
    {
      key: "members",
      header: t("members"),
      align: "right",
      render: (g) => (
        <span className="mono" style={{ color: "var(--muted)" }}>{g.member_count}</span>
      ),
    },
    // Admin-only: reassign the group to a real teacher.
    ...(isAdmin
      ? [
          {
            key: "teacher",
            header: t("colGroup"),
            width: 260,
            render: (g: Group) => (
              <div className="col gap-2" style={{ minWidth: 0 }} onClick={(e) => e.stopPropagation()}>
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
                <Dropdown
                  value={teachers?.some((tt) => tt.id === g.teacher_id) ? g.teacher_id ?? "" : ""}
                  onChange={(v) => v && assign.mutate({ groupId: g.id, teacherId: v })}
                  options={teacherOptions}
                  placeholder={t("assignTeacher")}
                />
              </div>
            ),
          } as Column<Group>,
        ]
      : []),
    {
      key: "actions",
      header: t("colActions"),
      align: "right",
      render: (g) => (
        <div className="row" style={{ justifyContent: "flex-end" }} onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" icon="trash" style={{ color: "var(--danger)" }} onClick={() => onDelete(g)}>
            {t("delete")}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="focus-wrap">
      <PageHead title={t("navGroups")} sub={t("groupsHint")} />

      <Toolbar
        right={
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
              style={{ ...inp, width: 220, minWidth: 0, maxWidth: "100%", height: 40 }}
            />
            <Button type="submit" icon="plus" disabled={!name.trim() || create.isPending}>
              {create.isPending ? "…" : t("newGroup")}
            </Button>
          </form>
        }
      />

      {isLoading ? (
        <Loading />
      ) : (
        <DataTable
          columns={columns}
          rows={groups ?? []}
          rowKey={(g) => g.id}
          onRowClick={(g) => nav(`/teacher/groups/${g.id}`)}
          minWidth={isAdmin ? 900 : 560}
          empty={t("noGroups")}
        />
      )}
    </div>
  );
}
