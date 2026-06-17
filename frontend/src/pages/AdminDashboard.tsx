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
    hue: number;
    to?: string;
  }[] = [
    { key: "teachers", label: t("statTeachers"), icon: "grad", hue: 248, to: "/admin/teachers" },
    { key: "students", label: t("statStudents"), icon: "users", hue: 152, to: "/admin/students" },
    { key: "questions", label: t("totalQuestions"), icon: "layers", hue: 47, to: "/admin/tests" },
    { key: "published_questions", label: t("publishedShort"), icon: "check", hue: 152 },
    { key: "submissions", label: t("statSubmissions"), icon: "mic", hue: 80 },
    { key: "evaluated_submissions", label: t("statEvaluated"), icon: "star", hue: 305 },
  ];

  return (
    <div className="col gap-5 focus-wrap">
      <div className="col gap-1">
        <h2 style={{ fontSize: 26 }}>{t("overview")}</h2>
        <p style={{ color: "var(--muted)", fontSize: 15, margin: 0 }}>{t("appName")}</p>
      </div>

      {isLoading || !data ? (
        <Loading />
      ) : (
        <div className="g4">
          {kpis.map((k) => {
            const inner = (
              <>
                <div
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 12,
                    background: `oklch(0.94 0.06 ${k.hue})`,
                    color: `oklch(0.5 0.15 ${k.hue})`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon name={k.icon} size={22} />
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 900,
                    fontSize: 30,
                    marginTop: 14,
                    lineHeight: 1,
                  }}
                >
                  {data[k.key]}
                </div>
                <div style={{ fontSize: 13.5, color: "var(--muted)", fontWeight: 700, marginTop: 5 }}>
                  {k.label}
                </div>
              </>
            );
            return (
              <Card key={k.key} pad={20} hover={!!k.to} onClick={k.to ? () => nav(k.to!) : undefined}>
                {inner}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
