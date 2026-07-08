import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import type { AdminTeacher, Group, Question, StudentManage } from "../lib/types";
import {
  Avatar,
  Button,
  DataTable,
  Icon,
  Loading,
  PageHead,
  Pill,
  SectionTitle,
  type Column,
} from "../components/govori";

/** Admin drill-down into one teacher: their groups, students and tests —
 *  with the same management the teacher has (admin is a super-user). */
export function AdminTeacherDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const { t } = useI18n();
  const nav = useNavigate();
  const qc = useQueryClient();

  const { data: teachers } = useQuery({
    queryKey: ["admin-teachers"],
    queryFn: async () => (await api.get<AdminTeacher[]>("/admin/teachers")).data,
  });
  const teacher = teachers?.find((x) => x.id === id);

  const { data: groups, isLoading: gLoading } = useQuery({
    queryKey: ["admin-teacher-groups", id],
    queryFn: async () => (await api.get<Group[]>(`/groups?teacher_id=${id}`)).data,
  });
  const { data: students } = useQuery({
    queryKey: ["admin-teacher-students", id],
    queryFn: async () => (await api.get<StudentManage[]>(`/users/students?teacher_id=${id}`)).data,
  });
  const { data: tests } = useQuery({
    queryKey: ["admin-teacher-tests", id],
    queryFn: async () => (await api.get<Question[]>(`/questions?teacher_id=${id}`)).data,
  });

  const premium = useMutation({
    mutationFn: async (s: StudentManage) =>
      (await api.patch(`/users/students/${s.id}/premium`, { is_premium: !s.is_premium })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-teacher-students", id] }),
  });

  const groupCols: Column<Group>[] = [
    {
      key: "name",
      header: t("colName"),
      render: (g) => <span style={{ fontWeight: 800, fontSize: 15 }}>{g.name}</span>,
    },
    {
      key: "join",
      header: t("joinCode"),
      hideSm: true,
      render: (g) => <span className="mono" style={{ color: "var(--ink-soft)" }}>{g.join_code}</span>,
    },
    {
      key: "members",
      header: t("members"),
      align: "right",
      render: (g) => (
        <span className="row gap-2" style={{ justifyContent: "flex-end", color: "var(--muted)" }}>
          <span className="mono">{g.member_count}</span>
          <Icon name="chevR" size={16} style={{ color: "var(--muted)" }} />
        </span>
      ),
    },
  ];

  const studentCols: Column<StudentManage>[] = [
    {
      key: "name",
      header: t("colName"),
      render: (s) => (
        <div className="row gap-3" style={{ minWidth: 0 }}>
          <Avatar name={s.full_name} size={34} />
          <div className="col" style={{ minWidth: 0 }}>
            <span className="truncate" style={{ fontWeight: 700, fontSize: 14 }}>
              {s.full_name}
            </span>
            <span className="truncate" style={{ fontSize: 12, color: "var(--muted)" }}>
              {s.email}
            </span>
          </div>
        </div>
      ),
    },
    {
      key: "actions",
      header: t("colActions"),
      align: "right",
      render: (s) => (
        <div
          className="row gap-2 wrap"
          style={{ justifyContent: "flex-end", alignItems: "center" }}
          onClick={(e) => e.stopPropagation()}
        >
          {s.is_premium && (
            <Pill hue={70} size="sm" icon="sparkles">
              {t("premium")}
            </Pill>
          )}
          <Button size="sm" variant="ghost" icon="sparkles" onClick={() => premium.mutate(s)}>
            {s.is_premium ? t("revokePremium") : t("grantPremium")}
          </Button>
        </div>
      ),
    },
  ];

  const testCols: Column<Question>[] = [
    {
      key: "title",
      header: t("colName"),
      render: (q) => <span className="truncate" style={{ fontWeight: 700, fontSize: 14 }}>{q.title}</span>,
    },
    {
      key: "visibility",
      header: t("colStatus"),
      render: (q) => (
        <Pill hue={q.is_public ? 200 : 305} size="sm">
          {q.is_public ? t("taskOpenShort") : t("taskAssignedShort")}
        </Pill>
      ),
    },
    {
      key: "actions",
      header: t("colActions"),
      align: "right",
      render: (q) => (
        <div className="row" style={{ justifyContent: "flex-end" }} onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" icon="edit" onClick={() => nav(`/teacher/questions/${q.id}/edit`)}>
            {t("edit")}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="focus-wrap">
      <div className="row" style={{ marginBottom: 16 }}>
        <Button variant="ghost" size="sm" icon="chevL" onClick={() => nav("/admin/teachers")}>
          {t("tabTeachers")}
        </Button>
      </div>

      <PageHead
        title={teacher?.full_name ?? t("manage")}
        sub={teacher?.email}
        action={
          teacher ? (
            <Pill hue={teacher.is_active ? 152 : 28} solid={teacher.is_active}>
              {teacher.is_active ? t("active") : t("inactive")}
            </Pill>
          ) : undefined
        }
      />

      {gLoading ? (
        <Loading />
      ) : (
        <div className="col gap-5">
          <section className="col gap-3">
            <SectionTitle>{t("navGroups")}</SectionTitle>
            <DataTable
              columns={groupCols}
              rows={groups ?? []}
              rowKey={(g) => g.id}
              onRowClick={(g) => nav(`/teacher/groups/${g.id}`)}
              minWidth={480}
              empty={t("noGroups")}
            />
          </section>

          <section className="col gap-3">
            <SectionTitle>{t("tabStudents")}</SectionTitle>
            <DataTable
              columns={studentCols}
              rows={students ?? []}
              rowKey={(s) => s.id}
              onRowClick={(s) => nav(`/admin/students/${s.id}`)}
              minWidth={480}
              empty={t("noStudents")}
            />
          </section>

          <section className="col gap-3">
            <SectionTitle>{t("navTests")}</SectionTitle>
            <DataTable
              columns={testCols}
              rows={tests ?? []}
              rowKey={(q) => q.id}
              minWidth={480}
              empty={t("noTests")}
            />
          </section>
        </div>
      )}
    </div>
  );
}
