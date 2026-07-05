import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { useStudentStats } from "../lib/useStats";
import { answerScore } from "../lib/score";
import type { Assignment, ReviewItem, Submission } from "../lib/types";
import {
  Card,
  Button,
  Pill,
  Icon,
  Mascot,
  Ring,
  SectionTitle,
  bandColor,
  Loading,
} from "../components/govori";

const firstName = (full?: string | null) => (full ?? "").trim().split(/\s+/)[0] || "";
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** A compact row for a recent answer. */
export function SubmissionRow({ s, onClick }: { s: Submission; onClick: () => void }) {
  const { t } = useI18n();
  const band = answerScore(s);
  return (
    <div
      onClick={onClick}
      className="row gap-3 tap"
      style={{
        padding: 12,
        borderRadius: "var(--r-sm)",
        background: "var(--surface-2)",
        cursor: "pointer",
      }}
    >
      <div
        style={{
          width: 42,
          height: 42,
          borderRadius: 12,
          background: `oklch(0.94 0.06 ${band != null ? bandColor(band) : 47})`,
          color: `oklch(0.5 0.15 ${band != null ? bandColor(band) : 47})`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Icon name="mic" size={19} />
      </div>
      <div className="col grow" style={{ minWidth: 0 }}>
        <span className="truncate" style={{ fontWeight: 800, fontSize: 14.5 }}>
          {s.question_title ?? t("taskLabel")}
        </span>
        <span className="truncate" style={{ fontSize: 12.5, color: "var(--muted)" }}>
          {(s.question_topic ?? "—")} · {new Date(s.created_at).toLocaleDateString()}
        </span>
      </div>
      {band != null ? (
        <Pill hue={bandColor(band)} size="sm">
          {Math.round(band)}
        </Pill>
      ) : s.status === "failed" ? (
        <Pill hue={28} size="sm">
          {t("failed")}
        </Pill>
      ) : (
        <Pill hue={47} size="sm">
          {t("inProgress")}
        </Pill>
      )}
    </div>
  );
}

export function Achievements() {
  const { t } = useI18n();
  const { streak, doneCount, bestBand } = useStudentStats();
  const list = [
    { on: doneCount >= 1, icon: "target", hue: 47, title: t("achFirst"), desc: t("achFirstD") },
    { on: streak >= 3, icon: "flame", hue: 28, title: t("achStreak3"), desc: t("achStreak3D") },
    { on: streak >= 7, icon: "calendar", hue: 248, title: t("achStreak7"), desc: t("achStreak7D") },
    { on: doneCount >= 10, icon: "trophy", hue: 80, title: t("achTen"), desc: t("achTenD") },
    {
      on: bestBand != null && bestBand >= 78,
      icon: "sparkles",
      hue: 152,
      title: t("achHigh"),
      desc: t("achHighD"),
    },
  ];
  return (
    <Card>
      <SectionTitle>{t("achievements")}</SectionTitle>
      <div className="g3" style={{ gap: 14 }}>
        {list.map((a) => (
          <div
            key={a.title}
            className="col"
            style={{
              alignItems: "center",
              textAlign: "center",
              gap: 8,
              padding: 16,
              borderRadius: "var(--r-md)",
              background: a.on ? `oklch(0.97 0.03 ${a.hue})` : "var(--surface-2)",
            }}
          >
            <div
              style={{
                width: 54,
                height: 54,
                borderRadius: "50%",
                background: a.on ? `oklch(0.93 0.08 ${a.hue})` : "var(--surface-3)",
                color: a.on ? `oklch(0.55 0.16 ${a.hue})` : "var(--faint)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: a.on ? `2px solid oklch(0.7 0.14 ${a.hue})` : "2px dashed var(--line-2)",
              }}
            >
              <Icon name={a.on ? a.icon : "lock"} size={23} />
            </div>
            <span style={{ fontSize: 13, fontWeight: 800, color: "var(--ink-soft)", lineHeight: 1.3 }}>
              {a.title}
            </span>
            <span style={{ fontSize: 11.5, color: "var(--muted)", lineHeight: 1.3 }}>
              {a.on ? a.desc : t("locked")}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function StudentHome() {
  const { user } = useAuth();
  const { t } = useI18n();
  const nav = useNavigate();
  const { streak, xp, avgBand, bestBand, submissions, isLoading } = useStudentStats();

  const { data: reviews } = useQuery({
    queryKey: ["review"],
    queryFn: async () => (await api.get<ReviewItem[]>("/review")).data,
  });
  const { data: assignments } = useQuery({
    queryKey: ["my-assignments"],
    queryFn: async () => (await api.get<Assignment[]>("/assignments/mine")).data,
  });

  const recent = submissions.slice(0, 3);
  const reviewCount = reviews?.length ?? 0;
  const pendingAssignment = assignments?.find((a) => !a.completed) ?? null;
  const pendingCount = assignments?.filter((a) => !a.completed).length ?? 0;
  const goal = user?.daily_goal ?? 1;
  const todayCount = submissions.filter((s) => sameDay(new Date(s.created_at), new Date())).length;
  const goalPct = Math.min(todayCount / goal, 1) * 100;
  const remaining = Math.max(goal - todayCount, 0);

  if (isLoading) return <Loading full />;

  return (
    <div className="col gap-5 focus-wrap">
      {/* Focus card — hero + daily-goal panel */}
      <Card pad={0} style={{ overflow: "hidden" }}>
        <div style={{ display: "flex", flexWrap: "wrap" }}>
          <div
            style={{
              flex: "1 1 300px",
              padding: "clamp(22px, 4vw, 30px) clamp(18px, 4vw, 32px)",
              background: "linear-gradient(135deg, oklch(0.75 0.15 56), oklch(0.64 0.19 38))",
              color: "#fff",
              position: "relative",
              overflow: "hidden",
              display: "flex",
              alignItems: "center",
              gap: 22,
            }}
          >
            <div
              style={{
                position: "absolute",
                right: -50,
                bottom: -60,
                width: 220,
                height: 220,
                borderRadius: "50%",
                background: "oklch(1 0 0 / 0.1)",
              }}
            />
            <div className="hide-sm" style={{ flexShrink: 0 }}>
              <Mascot size={108} mood="happy" />
            </div>
            <div className="col">
              <span style={{ fontSize: 14, opacity: 0.92 }}>
                {t("greeting")}, {firstName(user?.full_name)}! 👋
              </span>
              <h2 style={{ color: "#fff", fontSize: "clamp(20px, 5.5vw, 26px)", marginTop: 6, lineHeight: 1.2 }}>
                {t("greetingSub")}
              </h2>
              <div className="row gap-3" style={{ marginTop: 16 }}>
                <div
                  className="row gap-2"
                  style={{ background: "oklch(1 0 0 / 0.18)", borderRadius: 999, padding: "7px 13px" }}
                >
                  <Icon name="flame" size={17} />
                  <span style={{ fontWeight: 800, fontSize: 14 }}>
                    {streak} {t("streakUnit")}
                  </span>
                </div>
                <div
                  className="row gap-2"
                  style={{ background: "oklch(1 0 0 / 0.18)", borderRadius: 999, padding: "7px 13px" }}
                >
                  <Icon name="sparkles" size={17} />
                  <span style={{ fontWeight: 800, fontSize: 14 }}>
                    {xp.toLocaleString()} {t("xp")}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div
            style={{
              flex: "1 1 320px",
              padding: "24px 28px",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
            }}
          >
            <div className="row between" style={{ marginBottom: 4 }}>
              <span
                style={{
                  fontSize: 12.5,
                  fontWeight: 800,
                  color: "var(--muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                {t("goalToday")}
              </span>
              <Pill hue={47} size="sm" icon="sparkles">
                {Math.min(todayCount, goal)} / {goal}
              </Pill>
            </div>
            <h3 style={{ fontSize: 19, marginTop: 8 }}>{t("dailyGoal")}</h3>
            <div
              style={{
                marginTop: 10,
                height: 9,
                borderRadius: 999,
                background: "var(--surface-3)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${goalPct}%`,
                  height: "100%",
                  borderRadius: 999,
                  background: "linear-gradient(90deg, oklch(0.74 0.15 56), oklch(0.66 0.19 40))",
                  transition: "width .6s cubic-bezier(.2,.7,.3,1)",
                }}
              />
            </div>
            <Button style={{ marginTop: 18 }} icon="mic" onClick={() => nav("/questions")}>
              {t("startPracticing")}
            </Button>
          </div>
        </div>
      </Card>

      {/* Stats */}
      <div className="g3">
        {[
          {
            label: t("avgScore"),
            val: avgBand != null ? Math.round(avgBand) : "—",
            icon: "target",
            hue: 47,
          },
          {
            label: t("streakTitle"),
            val: streak,
            icon: "flame",
            hue: 28,
          },
          {
            label: t("bestScore"),
            val: bestBand != null ? Math.round(bestBand) : "—",
            icon: "trophy",
            hue: 80,
          },
        ].map((s) => (
          <Card key={s.label} pad={18}>
            <div className="row between">
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  background: `oklch(0.94 0.06 ${s.hue})`,
                  color: `oklch(0.5 0.15 ${s.hue})`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon name={s.icon} size={21} />
              </div>
            </div>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 900,
                fontSize: 28,
                lineHeight: 1,
                marginTop: 12,
              }}
            >
              {s.val}
            </div>
            <div style={{ fontSize: 13, color: "var(--ink-soft)", fontWeight: 700, marginTop: 5 }}>
              {s.label}
            </div>
          </Card>
        ))}
      </div>

      {/* Recent + side column */}
      <div className="split">
        <Card>
          <SectionTitle
            action={
              <Button variant="soft" size="sm" iconR="chevR" onClick={() => nav("/progress")}>
                {t("viewAll")}
              </Button>
            }
          >
            {t("recentResults")}
          </SectionTitle>
          {!recent.length ? (
            <div className="col center" style={{ gap: 12, padding: "28px 0", textAlign: "center" }}>
              <Mascot size={84} mood="sleepy" float={false} />
              <p style={{ color: "var(--muted)", fontSize: 14.5 }}>{t("noActivity")}</p>
              <Button icon="mic" onClick={() => nav("/questions")}>
                {t("startPracticing")}
              </Button>
            </div>
          ) : (
            <div className="col gap-2">
              {recent.map((s) => (
                <SubmissionRow key={s.id} s={s} onClick={() => nav(`/submissions/${s.id}`)} />
              ))}
            </div>
          )}
        </Card>

        <div className="col gap-5">
          {/* Daily goal ring */}
          <Card>
            <SectionTitle>{t("dailyGoal")}</SectionTitle>
            <div className="row gap-4">
              <Ring value={goalPct} size={86} sw={10} hue={152}>
                <div className="col" style={{ alignItems: "center" }}>
                  <span style={{ fontWeight: 900, fontFamily: "var(--font-display)", fontSize: 18 }}>
                    {Math.min(todayCount, goal)}/{goal}
                  </span>
                </div>
              </Ring>
              <div className="col" style={{ justifyContent: "center", gap: 4 }}>
                <span style={{ fontSize: 14.5, fontWeight: 800 }}>{t("goalToday")}</span>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>
                  {remaining > 0 ? t("noStreak") : t("completedLabel")}
                </span>
              </div>
            </div>
          </Card>

          {/* Review reminder */}
          {reviewCount > 0 && (
            <Card
              style={{ background: "oklch(0.97 0.03 305)", borderColor: "oklch(0.86 0.07 305)" }}
              onClick={() => nav("/review")}
              hover
            >
              <div className="row gap-3" style={{ alignItems: "flex-start" }}>
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 11,
                    background: "var(--surface)",
                    color: "oklch(0.5 0.15 305)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Icon name="refresh" size={19} />
                </div>
                <div className="col">
                  <span style={{ fontWeight: 800, fontSize: 14.5 }}>{t("reviewTitle")}</span>
                  <span style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 2 }}>
                    {reviewCount} · {t("weakSpot")}
                  </span>
                </div>
              </div>
            </Card>
          )}

          {/* Teacher assignment */}
          {pendingAssignment && (
            <Card
              style={{ background: "var(--info-tint)", borderColor: "oklch(0.85 0.06 248)" }}
              onClick={() => nav("/assignments")}
              hover
            >
              <div className="row gap-3" style={{ alignItems: "flex-start" }}>
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 11,
                    background: "var(--surface)",
                    color: "var(--info)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Icon name="calendar" size={19} />
                </div>
                <div className="col">
                  <span style={{ fontWeight: 800, fontSize: 14.5 }}>{t("myAssignments")}</span>
                  <span className="truncate" style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 2 }}>
                    {pendingAssignment.question_title ?? t("taskLabel")}
                    {pendingCount > 1 ? ` · +${pendingCount - 1}` : ""}
                  </span>
                  <span
                    style={{
                      marginTop: 8,
                      color: "var(--info)",
                      fontWeight: 800,
                      fontFamily: "var(--font-display)",
                      fontSize: 13.5,
                    }}
                  >
                    {t("open")} →
                  </span>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Achievements */}
      <Achievements />
    </div>
  );
}
