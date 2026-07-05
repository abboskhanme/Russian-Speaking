import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
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
  SectionTitle,
  fmt,
  type IconName,
} from "../components/govori";
import { useTeacherSubmissions } from "./TeacherSubmissions";

const firstName = (full?: string | null) => (full ?? "").trim().split(/\s+/)[0] || "";

const autoBand = answerScore;

export function TeacherDashboard() {
  const { user } = useAuth();
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

  const stats: { val: number; label: string; icon: IconName; hue: number }[] = [
    { val: total, label: t("totalQuestions"), icon: "message", hue: 47 },
    { val: published, label: t("publishedShort"), icon: "check", hue: 152 },
    { val: answers, label: t("answersReceived"), icon: "headphones", hue: 248 },
    { val: pending, label: t("pendingReview"), icon: "clock", hue: 28 },
  ];

  const quickActions: { to: string; label: string; icon: IconName; hue: number }[] = [
    { to: "/teacher/students", label: t("tabStudents"), icon: "users", hue: 47 },
    { to: "/teacher/questions", label: t("questions"), icon: "message", hue: 152 },
    { to: "/teacher/topics", label: t("tabTopics"), icon: "layers", hue: 248 },
    { to: "/teacher/assignments", label: t("assignmentsTitle"), icon: "calendar", hue: 80 },
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
    <div className="col gap-5 focus-wrap">
      <div className="col gap-1">
        <h2 style={{ fontSize: 26 }}>
          {t("welcomeBack")}, {firstName(user?.full_name)} 👋
        </h2>
        <p style={{ color: "var(--muted)", fontSize: 15, margin: 0 }}>{t("overview")}</p>
      </div>

      <div className="g4">
        {stats.map((s, i) => (
          <Card key={i} pad={20}>
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: 12,
                background: `oklch(0.94 0.06 ${s.hue})`,
                color: `oklch(0.5 0.15 ${s.hue})`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name={s.icon} size={22} />
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
              {s.val}
            </div>
            <div style={{ fontSize: 13.5, color: "var(--muted)", fontWeight: 700, marginTop: 5 }}>
              {s.label}
            </div>
          </Card>
        ))}
      </div>

      <div className="g3">
        {quickActions.map((q) => (
          <Card key={q.to} hover onClick={() => nav(q.to)}>
            <div className="row gap-3">
              <div
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 13,
                  background: `oklch(0.94 0.06 ${q.hue})`,
                  color: `oklch(0.5 0.15 ${q.hue})`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Icon name={q.icon} size={22} />
              </div>
              <div className="col grow">
                <span style={{ fontWeight: 800, fontSize: 15.5, fontFamily: "var(--font-display)" }}>
                  {q.label}
                </span>
                <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{t("manage")}</span>
              </div>
              <Icon name="chevR" size={20} style={{ color: "var(--faint)" }} />
            </div>
          </Card>
        ))}
      </div>

      <div className="split">
        <Card>
          <SectionTitle
            action={
              <Button
                variant="soft"
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
                  <Avatar name={s.student_name} size={42} />
                  <div className="col grow" style={{ minWidth: 0 }}>
                    <span className="truncate" style={{ fontWeight: 800, fontSize: 14.5 }}>
                      {s.student_name ?? "—"}
                    </span>
                    <span className="truncate" style={{ fontSize: 12.5, color: "var(--muted)" }}>
                      {s.question_title ?? "—"}
                      {s.audio_duration_sec != null ? ` · ${fmt(s.audio_duration_sec)}` : ""}
                    </span>
                  </div>
                  <Button size="sm" icon="play">
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
            <LineChart data={chartData} hue={152} h={150} />
          ) : (
            <EmptyState text={t("noAnswers")} />
          )}
        </Card>
      </div>
    </div>
  );
}
