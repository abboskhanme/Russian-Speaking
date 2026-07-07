import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import type { AdminStudentDetail as Detail } from "../lib/types";
import { EmptyState, Loading } from "../components/govori";
import { StudentDetailView } from "../components/StudentDetailView";

/** Teacher drill-down into one of their own students: contact info, groups +
 *  their teacher, tests solved with results, and progress stats. */
export function TeacherStudentDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const { t } = useI18n();

  const { data: s, isLoading } = useQuery({
    queryKey: ["teacher-student-detail", id],
    queryFn: async () => (await api.get<Detail>(`/users/students/${id}/detail`)).data,
  });

  if (isLoading) return <Loading full />;
  if (!s) return <EmptyState text={t("noStudents")} />;

  return <StudentDetailView s={s} backTo="/teacher/students" backLabel={t("tabStudents")} />;
}
