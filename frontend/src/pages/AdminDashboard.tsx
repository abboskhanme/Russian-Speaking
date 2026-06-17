import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import type { AdminStats } from "../lib/types";
import { Card, Icon, Loading, type IconName } from "../components/govori";

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
    <div className="col gap-5 focus-wrap">
      <div className="col gap-1">
        <h2 style={{ fontSize: 24, fontWeight: 800 }}>{t("overview")}</h2>
        <p style={{ color: "var(--muted)", fontSize: 14.5, margin: 0 }}>{t("appName")}</p>
      </div>

      {isLoading || !data ? (
        <Loading />
      ) : (
        <div className="g4">
          {kpis.map((k) => (
            <Card key={k.key} pad={20} hover={!!k.to} onClick={k.to ? () => nav(k.to!) : undefined}>
              {/* Neutral, monochrome KPI — professional, low visual noise. */}
              <div className="row between" style={{ alignItems: "flex-start" }}>
                <div
                  style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 800,
                    fontSize: 30,
                    lineHeight: 1,
                    color: "var(--ink)",
                  }}
                >
                  {data[k.key]}
                </div>
                <Icon name={k.icon} size={20} style={{ color: "var(--faint)" }} />
              </div>
              <div style={{ fontSize: 13, color: "var(--muted)", fontWeight: 600, marginTop: 10 }}>
                {k.label}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
