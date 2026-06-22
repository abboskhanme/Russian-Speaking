import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useStudentStats } from "../lib/useStats";
import type { LeaderboardEntry } from "../lib/types";
import {
  Card,
  Pill,
  Icon,
  Avatar,
  Ring,
  Sparkline,
  RadarChart,
  SectionTitle,
  PageHead,
  bandColor,
  Loading,
  EmptyState,
} from "../components/govori";
import { Achievements, SubmissionRow } from "./StudentHome";

export function StudentProgress() {
  const { t } = useI18n();
  const nav = useNavigate();
  const { avgBand, bestBand, submissions, isLoading } = useStudentStats();

  // Chronological band history (oldest → newest) for the trend chart.
  const evaluated = submissions.filter((s) => s.status === "done" && s.evaluation);
  const trend = evaluated.map((s) => s.evaluation!.overall_band).reverse();

  // Skill criteria from the most recent evaluation.
  const latest = evaluated[0]?.evaluation ?? null;
  const radarData = latest
    ? [
        { short: t("fluency").split(/\s+/)[0], score: latest.fluency_score },
        { short: t("lexical").split(/\s+/)[0], score: latest.lexical_score },
        { short: t("grammar").split(/\s+/)[0], score: latest.grammar_score },
        ...(latest.relevance_score != null
          ? [{ short: t("relevance").split(/\s+/)[0], score: latest.relevance_score }]
          : []),
        ...(latest.pronunciation_score != null
          ? [{ short: t("pronunciation").split(/\s+/)[0], score: latest.pronunciation_score }]
          : []),
        ...(latest.naturalness_score != null
          ? [{ short: t("naturalness").split(/\s+/)[0], score: latest.naturalness_score }]
          : []),
        ...(latest.speech_rate_score != null
          ? [{ short: t("speech_rate").split(/\s+/)[0], score: latest.speech_rate_score }]
          : []),
        ...(latest.intonation_score != null
          ? [{ short: t("intonation").split(/\s+/)[0], score: latest.intonation_score }]
          : []),
      ]
    : [];
  const criteria = latest
    ? [
        { label: t("fluency"), score: latest.fluency_score },
        { label: t("lexical"), score: latest.lexical_score },
        { label: t("grammar"), score: latest.grammar_score },
        ...(latest.relevance_score != null
          ? [{ label: t("relevance"), score: latest.relevance_score }]
          : []),
        ...(latest.pronunciation_score != null
          ? [{ label: t("pronunciation"), score: latest.pronunciation_score }]
          : []),
        ...(latest.naturalness_score != null
          ? [{ label: t("naturalness"), score: latest.naturalness_score }]
          : []),
        ...(latest.speech_rate_score != null
          ? [{ label: t("speech_rate"), score: latest.speech_rate_score }]
          : []),
        ...(latest.intonation_score != null
          ? [{ label: t("intonation"), score: latest.intonation_score }]
          : []),
      ]
    : [];

  // Weekly soft leaderboard (neighbours).
  const { data: board } = useQuery({
    queryKey: ["leaderboard", "global"],
    queryFn: async () => (await api.get<LeaderboardEntry[]>("/leaderboard")).data,
  });

  const trendDelta =
    trend.length >= 2 ? trend[trend.length - 1] - trend[0] : 0;

  if (isLoading) return <Loading full />;

  return (
    <div className="col gap-5 focus-wrap">
      <PageHead title={t("myProgress")} sub={t("skillsRadar")} />

      {!submissions.length ? (
        <EmptyState text={t("noSubmissions")} />
      ) : (
        <>
          <div className="split">
            {/* Skills radar + criteria legend */}
            <Card>
              <SectionTitle>{t("skillsRadar")}</SectionTitle>
              {radarData.length >= 3 ? (
                <div
                  className="row wrap"
                  style={{ justifyContent: "center", alignItems: "center", gap: 24 }}
                >
                  <RadarChart data={radarData} size={250} />
                  <div className="col gap-3" style={{ minWidth: 160 }}>
                    {criteria.map((c) => {
                      const ch = bandColor(c.score);
                      return (
                        <div key={c.label} className="row gap-3" style={{ alignItems: "center" }}>
                          <span
                            style={{
                              width: 10,
                              height: 10,
                              borderRadius: 3,
                              background: `oklch(0.68 0.16 ${ch})`,
                              flexShrink: 0,
                            }}
                          />
                          <span className="grow" style={{ fontSize: 13.5, fontWeight: 600 }}>
                            {c.label}
                          </span>
                          <span
                            style={{
                              fontFamily: "var(--font-display)",
                              fontWeight: 900,
                              color: `oklch(0.5 0.15 ${ch})`,
                            }}
                          >
                            {Math.round(c.score)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <p style={{ color: "var(--muted)", fontSize: 14 }}>{t("noActivity")}</p>
              )}
            </Card>

            {/* Overall band + score trend */}
            <div className="col gap-5">
              <Card style={{ textAlign: "center" }}>
                <SectionTitle>{t("overallBand")}</SectionTitle>
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <Ring
                    value={avgBand != null ? avgBand : 0}
                    size={120}
                    sw={12}
                    hue={avgBand != null ? bandColor(avgBand) : 47}
                  >
                    <div className="col" style={{ alignItems: "center" }}>
                      <span
                        style={{
                          fontFamily: "var(--font-display)",
                          fontWeight: 900,
                          fontSize: 30,
                        }}
                      >
                        {avgBand != null ? Math.round(avgBand) : "—"}
                      </span>
                      <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 700 }}>
                        {t("avgScore")}
                      </span>
                    </div>
                  </Ring>
                </div>
              </Card>

              <Card>
                <div className="row between" style={{ marginBottom: 10 }}>
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 800,
                      fontFamily: "var(--font-display)",
                    }}
                  >
                    {t("scoreTrend")}
                  </span>
                  {trend.length >= 2 && (
                    <Pill
                      hue={trendDelta >= 0 ? 152 : 28}
                      size="sm"
                      icon={trendDelta >= 0 ? "arrowUp" : "arrowDown"}
                    >
                      {trendDelta >= 0 ? "+" : ""}
                      {Math.round(trendDelta)}
                    </Pill>
                  )}
                </div>
                {trend.length >= 2 ? (
                  <div className="row between" style={{ alignItems: "flex-end" }}>
                    <Sparkline data={trend} w={150} h={48} hue={bandColor(trend[trend.length - 1])} />
                    <div className="col" style={{ alignItems: "flex-end" }}>
                      <span
                        style={{
                          fontFamily: "var(--font-display)",
                          fontWeight: 900,
                          fontSize: 18,
                        }}
                      >
                        {Math.round(trend[0])} → {Math.round(trend[trend.length - 1])}
                      </span>
                      {bestBand != null && (
                        <span style={{ fontSize: 12, color: "var(--muted)" }}>
                          {t("bestScore")}: {Math.round(bestBand)}
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <p style={{ color: "var(--muted)", fontSize: 13.5 }}>{t("noActivity")}</p>
                )}
              </Card>
            </div>
          </div>

          {/* Achievements (already govori-styled) */}
          <Achievements />

          {/* History */}
          <Card>
            <SectionTitle>{t("history")}</SectionTitle>
            <div className="col gap-2">
              {submissions.map((s) => (
                <SubmissionRow key={s.id} s={s} onClick={() => nav(`/submissions/${s.id}`)} />
              ))}
            </div>
          </Card>

          {/* Soft weekly leaderboard */}
          {board && board.length > 0 && (
            <Card>
              <SectionTitle
                action={
                  <button
                    onClick={() => nav("/leaderboard")}
                    className="tap"
                    style={{
                      border: "none",
                      background: "transparent",
                      color: "var(--primary)",
                      fontWeight: 800,
                      fontFamily: "var(--font-display)",
                      fontSize: 13.5,
                      cursor: "pointer",
                      padding: 0,
                    }}
                  >
                    {t("leaderboardTitle")} →
                  </button>
                }
              >
                {t("weeklyXp")}
              </SectionTitle>
              <div className="col gap-1">
                {board.slice(0, 5).map((p) => (
                  <div
                    key={p.id}
                    className="row gap-3"
                    style={{
                      padding: "11px 12px",
                      borderRadius: "var(--r-sm)",
                      background: p.is_me ? "var(--primary-tint)" : "transparent",
                    }}
                  >
                    <span
                      style={{
                        width: 22,
                        textAlign: "center",
                        fontFamily: "var(--font-display)",
                        fontWeight: 900,
                        fontSize: 14,
                        color: "var(--muted)",
                      }}
                    >
                      {p.rank}
                    </span>
                    <Avatar name={p.full_name} size={36} />
                    <div className="col grow" style={{ minWidth: 0 }}>
                      <span className="truncate" style={{ fontSize: 14, fontWeight: 800 }}>
                        {p.full_name}
                        {p.is_me && <span style={{ color: "var(--primary)" }}> ({t("you")})</span>}
                      </span>
                      <span className="row gap-1" style={{ fontSize: 12, color: "var(--muted)" }}>
                        <Icon name="flame" size={12} style={{ color: "oklch(0.65 0.16 28)" }} />
                        {p.current_streak}
                      </span>
                    </div>
                    <span
                      style={{
                        fontFamily: "var(--font-display)",
                        fontWeight: 900,
                        fontSize: 15,
                      }}
                    >
                      {p.weekly_xp}
                      <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 700 }}>
                        {" "}
                        {t("xp")}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
