import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import type { AdminStudentDetail as Detail } from "../lib/types";
import {
  Button,
  Card,
  EmptyState,
  Icon,
  Loading,
  PageHead,
  Pill,
  SectionTitle,
  bandColor,
} from "../components/govori";

function Stat({ label, value, color = "var(--ink)" }: { label: string; value: string; color?: string }) {
  return (
    <Card style={{ textAlign: "center", padding: "14px 10px" }}>
      <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 24, color }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, marginTop: 2 }}>{label}</div>
    </Card>
  );
}

/** Admin drill-down into one student: groups + their teacher, tests solved with
 *  results, and progress stats. */
export function AdminStudentDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const { t } = useI18n();
  const nav = useNavigate();

  const { data: s, isLoading } = useQuery({
    queryKey: ["admin-student-detail", id],
    queryFn: async () => (await api.get<Detail>(`/admin/students/${id}/detail`)).data,
  });

  if (isLoading) return <Loading full />;
  if (!s) return <EmptyState text={t("noStudents")} />;

  return (
    <div className="focus-wrap">
      <div className="row" style={{ marginBottom: 16 }}>
        <Button variant="ghost" size="sm" icon="chevL" onClick={() => nav("/admin/students")}>
          {t("tabStudents")}
        </Button>
      </div>

      <PageHead
        title={s.full_name}
        sub={s.email}
        action={
          <div className="row gap-2">
            {s.is_premium && (
              <Pill hue={70} size="sm" icon="sparkles">
                {t("premium")}
              </Pill>
            )}
            <Pill hue={s.is_active ? 152 : 28} solid={s.is_active}>
              {s.is_active ? t("active") : t("inactive")}
            </Pill>
          </div>
        }
      />

      {/* Stats — neutral; only the score is tinted by performance */}
      <div className="g4" style={{ marginBottom: 20 }}>
        <Stat label={t("attempts")} value={String(s.attempts)} />
        <Stat
          label={t("avgScore")}
          value={s.avg_band != null ? String(Math.round(s.avg_band)) : "—"}
          color={s.avg_band != null ? `oklch(0.5 0.15 ${bandColor(s.avg_band)})` : "var(--ink)"}
        />
        <Stat
          label={t("bestScore")}
          value={s.best_band != null ? String(Math.round(s.best_band)) : "—"}
          color={s.best_band != null ? `oklch(0.5 0.15 ${bandColor(s.best_band)})` : "var(--ink)"}
        />
        <Stat label="XP" value={String(s.xp)} />
      </div>

      <div className="col gap-5">
        {/* Groups + their teacher */}
        <Card>
          <SectionTitle>{t("navGroups")}</SectionTitle>
          {!s.groups.length ? (
            <EmptyState text={t("noGroups")} />
          ) : (
            <div className="col gap-2">
              {s.groups.map((g) => (
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
                      {t("teacher")}: {g.teacher_name ?? "—"}
                    </span>
                  </div>
                  <Icon name="chevR" size={18} style={{ color: "var(--muted)" }} />
                </button>
              ))}
            </div>
          )}
        </Card>

        {/* Tests solved + results */}
        <Card>
          <SectionTitle>{t("navTests")}</SectionTitle>
          {!s.submissions.length ? (
            <EmptyState text={t("noSubmissions")} />
          ) : (
            <div className="col gap-2">
              {s.submissions.map((sub) => (
                <button
                  key={sub.id}
                  className="tap row between gap-3"
                  onClick={() => nav(`/submissions/${sub.id}`)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 12px",
                    borderRadius: "var(--r-sm)",
                    border: "1px solid var(--line)",
                    background: "var(--surface)",
                    cursor: "pointer",
                  }}
                >
                  <div className="col" style={{ minWidth: 0 }}>
                    <span className="truncate" style={{ fontWeight: 700, fontSize: 14 }}>
                      {sub.question_title ?? "—"}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>
                      {new Date(sub.created_at).toLocaleDateString()}
                      {sub.topic ? ` · ${sub.topic}` : ""}
                    </span>
                  </div>
                  {sub.band != null ? (
                    <Pill hue={bandColor(sub.band)} size="sm">
                      {Math.round(sub.band)}
                    </Pill>
                  ) : (
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>{sub.status}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
