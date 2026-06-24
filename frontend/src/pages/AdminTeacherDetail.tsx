import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import type { AdminTeacher, Group, Question, StudentManage } from "../lib/types";
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  Icon,
  Loading,
  PageHead,
  Pill,
  SectionTitle,
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
          {/* Groups */}
          <Card>
            <SectionTitle>{t("navGroups")}</SectionTitle>
            {!groups?.length ? (
              <EmptyState text={t("noGroups")} />
            ) : (
              <div className="col gap-2">
                {groups.map((g) => (
                  <button
                    key={g.id}
                    className="tap row between"
                    onClick={() => nav(`/teacher/groups/${g.id}`)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "12px 14px",
                      borderRadius: "var(--r-sm)",
                      border: "1px solid var(--line)",
                      background: "var(--surface)",
                      cursor: "pointer",
                    }}
                  >
                    <div className="col" style={{ minWidth: 0 }}>
                      <span style={{ fontWeight: 800, fontSize: 15 }}>{g.name}</span>
                      <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
                        {t("joinCode")}: {g.join_code} · {g.member_count} {t("members")}
                      </span>
                    </div>
                    <Icon name="chevR" size={18} style={{ color: "var(--muted)" }} />
                  </button>
                ))}
              </div>
            )}
          </Card>

          {/* Students (roster) */}
          <Card>
            <SectionTitle>{t("tabStudents")}</SectionTitle>
            {!students?.length ? (
              <EmptyState text={t("noStudents")} />
            ) : (
              <div className="col gap-2">
                {students.map((s) => (
                  <div
                    key={s.id}
                    className="row between gap-3"
                    style={{ padding: "8px 4px", borderBottom: "1px solid var(--line)" }}
                  >
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
                    <div className="row gap-2 wrap" style={{ justifyContent: "flex-end" }}>
                      {s.is_premium && (
                        <Pill hue={70} size="sm" icon="sparkles">
                          {t("premium")}
                        </Pill>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="sparkles"
                        onClick={() => premium.mutate(s)}
                      >
                        {s.is_premium ? t("revokePremium") : t("grantPremium")}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Tests */}
          <Card>
            <SectionTitle>{t("navTests")}</SectionTitle>
            {!tests?.length ? (
              <EmptyState text={t("noTests")} />
            ) : (
              <div className="col gap-2">
                {tests.map((q) => (
                  <div
                    key={q.id}
                    className="row between gap-3"
                    style={{ padding: "8px 4px", borderBottom: "1px solid var(--line)" }}
                  >
                    <span className="truncate" style={{ fontWeight: 700, fontSize: 14 }}>
                      {q.title}
                    </span>
                    <div className="row gap-2 wrap" style={{ justifyContent: "flex-end" }}>
                      <Pill hue={q.is_public ? 200 : 305} size="sm">
                        {q.is_public ? t("taskOpenShort") : t("taskAssignedShort")}
                      </Pill>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="edit"
                        onClick={() => nav(`/teacher/questions/${q.id}/edit`)}
                      >
                        {t("edit")}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
