import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import type { AdminStats } from "../lib/types";
import { Loading, PageHead, StatTile, type IconName } from "../components/govori";

export function AdminDashboard() {
  const { t } = useI18n();
  const nav = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: async () => (await api.get<AdminStats>("/admin/stats")).data,
  });

  const kpis: {
    key: keyof AdminStats;
    label: string;
    icon: IconName;
    to?: string;
  }[] = [
    { key: "teachers", label: t("statTeachers"), icon: "grad", to: "/admin/teachers" },
    { key: "students", label: t("statStudents"), icon: "users", to: "/admin/students" },
    { key: "questions", label: t("totalQuestions"), icon: "layers", to: "/teacher/questions" },
    { key: "published_questions", label: t("publishedShort"), icon: "check" },
    { key: "submissions", label: t("statSubmissions"), icon: "mic" },
    { key: "evaluated_submissions", label: t("statEvaluated"), icon: "star" },
  ];

  return (
    <div className="focus-wrap">
      <PageHead title={t("overview")} sub={t("appName")} />

      {isLoading || !data ? (
        <Loading />
      ) : (
        <div className="g4">
          {kpis.map((k) => (
            <StatTile
              key={k.key}
              value={data[k.key]}
              label={k.label}
              icon={k.icon}
              onClick={k.to ? () => nav(k.to!) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
