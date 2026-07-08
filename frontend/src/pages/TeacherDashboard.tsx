import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { answerScore } from "../lib/score";
import type { Question, Submission } from "../lib/types";
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  Icon,
  LineChart,
  Loading,
  PageHead,
  SectionTitle,
  StatTile,
  fmt,
  type IconName,
} from "../components/govori";
import { useTeacherSubmissions } from "./TeacherSubmissions";

const autoBand = answerScore;

export function TeacherDashboard() {
  const { t } = useI18n();
  const nav = useNavigate();

  const { data: questions } = useQuery({
    queryKey: ["questions", "mine"],
    queryFn: async () => (await api.get<Question[]>("/questions")).data,
  });
  const { data: subs, isLoading } = useTeacherSubmissions();

  const total = questions?.length ?? 0;
  const published = questions?.filter((q) => q.is_published).length ?? 0;
  const answers = subs?.length ?? 0;
  const pendingList =
    subs?.filter((s) => s.status === "pending" || s.status === "processing") ?? [];
  const pending = pendingList.length;

  const stats: {
    val: number;
    label: string;
    icon: IconName;
    to?: string;
    accent?: "neutral" | "warn";
  }[] = [
    { val: total, label: t("totalQuestions"), icon: "layers", to: "/teacher/questions" },
    { val: published, label: t("publishedShort"), icon: "check", to: "/teacher/questions" },
    { val: answers, label: t("answersReceived"), icon: "mic", to: "/teacher/submissions" },
    {
      val: pending,
      label: t("pendingReview"),
      icon: "clock",
      to: "/teacher/submissions",
      accent: pending > 0 ? "warn" : "neutral",
    },
  ];

  const quickActions: { to: string; label: string; icon: IconName }[] = [
    { to: "/teacher/students", label: t("tabStudents"), icon: "users" },
    { to: "/teacher/questions", label: t("questions"), icon: "message" },
    { to: "/teacher/topics", label: t("tabTopics"), icon: "layers" },
    { to: "/teacher/assignments", label: t("assignmentsTitle"), icon: "calendar" },
  ];

  // Group dynamics: average effective band per recent submission (chronological).
  const graded = (subs ?? [])
    .map((s) => ({ s, b: autoBand(s) }))
    .filter((x): x is { s: Submission; b: number } => x.b != null)
    .slice()
    .reverse()
    .slice(-8);
  const chartData = graded.map((x, i) => ({ w: `${i + 1}`, band: x.b }));

  return (
    <div className="focus-wrap">
      <PageHead title={t("overview")} sub={t("appName")} />

      <div className="g4">
        {stats.map((s, i) => (
          <StatTile
            key={i}
            value={s.val}
            label={s.label}
            icon={s.icon}
            accent={s.accent}
            onClick={s.to ? () => nav(s.to!) : undefined}
          />
        ))}
      </div>

      <div className="g4" style={{ marginTop: 18 }}>
        {quickActions.map((q) => (
          <Card key={q.to} hover pad={18} onClick={() => nav(q.to)}>
            <div className="row gap-3" style={{ alignItems: "center" }}>
              <Icon name={q.icon} size={20} style={{ color: "var(--faint)" }} />
              <span
                className="grow truncate"
                style={{ fontWeight: 700, fontSize: 14.5, fontFamily: "var(--font-display)" }}
              >
                {q.label}
              </span>
              <Icon name="chevR" size={18} style={{ color: "var(--faint)" }} />
            </div>
          </Card>
        ))}
      </div>

      <div className="split" style={{ marginTop: 18 }}>
        <Card>
          <SectionTitle
            action={
              <Button
                variant="ghost"
                size="sm"
                iconR="chevR"
                onClick={() => nav("/teacher/submissions")}
              >
                {t("viewAll")}
              </Button>
            }
          >
            {t("recentAnswers")}
          </SectionTitle>
          {isLoading ? (
            <Loading />
          ) : !pendingList.length ? (
            <EmptyState text={t("noAnswers")} />
          ) : (
            <div className="col gap-2">
              {pendingList.slice(0, 6).map((s) => (
                <div
                  key={s.id}
                  className="row gap-3 tap"
                  style={{
                    padding: 12,
                    borderRadius: "var(--r-sm)",
                    background: "var(--surface-2)",
                    cursor: "pointer",
                  }}
                  onClick={() => nav(`/submissions/${s.id}`)}
                >
                  <Avatar name={s.student_name} size={40} />
                  <div className="col grow" style={{ minWidth: 0 }}>
                    <span className="truncate" style={{ fontWeight: 700, fontSize: 14.5 }}>
                      {s.student_name ?? "—"}
                    </span>
                    <span className="truncate" style={{ fontSize: 12.5, color: "var(--muted)" }}>
                      {s.question_title ?? "—"}
                      {s.audio_duration_sec != null ? ` · ${fmt(s.audio_duration_sec)}` : ""}
                    </span>
                  </div>
                  <Button size="sm" variant="ghost" iconR="chevR">
                    {t("viewAnswer")}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <SectionTitle>{t("scoreTrend")}</SectionTitle>
          {chartData.length >= 2 ? (
            <LineChart data={chartData} hue={47} h={150} />
          ) : (
            <EmptyState text={t("noAnswers")} />
          )}
        </Card>
      </div>
    </div>
  );
}
