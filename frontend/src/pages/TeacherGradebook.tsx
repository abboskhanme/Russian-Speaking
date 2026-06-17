import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import type { Analytics, GradebookRow, Group } from "../lib/types";
import {
  Avatar,
  Bar,
  Button,
  Card,
  EmptyState,
  Loading,
  PageHead,
  Pill,
  SectionTitle,
  bandColor,
} from "../components/govori";

const CRITERION_KEY = {
  fluency: "fluency",
  lexical: "lexical",
  grammar: "grammar",
  relevance: "relevance",
  overall: "overallBand",
} as const;

type CriterionKey = keyof typeof CRITERION_KEY;

function fmtBand(v: number | null): string {
  return v != null ? Math.round(v).toString() : "—";
}

function fmtDate(s: string | null): string {
  return s ? new Date(s).toLocaleDateString() : "—";
}

const COLS = "2fr 0.8fr 0.8fr 0.8fr 1.1fr";

export function TeacherGradebook() {
  const { t } = useI18n();
  const [group, setGroup] = useState<string>("");

  const { data: groups } = useQuery({
    queryKey: ["groups"],
    queryFn: async () => (await api.get<Group[]>("/groups")).data,
  });

  const params = group ? { group_id: group } : {};

  const { data: rows, isLoading: rowsLoading } = useQuery({
    queryKey: ["gradebook", group],
    queryFn: async () =>
      (await api.get<GradebookRow[]>("/reports/gradebook", { params })).data,
  });

  const { data: analytics } = useQuery({
    queryKey: ["analytics", group],
    queryFn: async () =>
      (await api.get<Analytics>("/reports/analytics", { params })).data,
  });

  const [exporting, setExporting] = useState(false);
  async function exportCsv() {
    setExporting(true);
    try {
      const res = await api.get("/reports/gradebook.csv", {
        params,
        responseType: "blob",
      });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "gradebook.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  const avgEntries: { key: CriterionKey; label: string; value: number | null }[] =
    analytics
      ? (["fluency", "lexical", "grammar", "relevance", "overall"] as const).map(
          (k) => ({
            key: k,
            label: t(CRITERION_KEY[k]),
            value: analytics.averages[k],
          }),
        )
      : [];

  const bandEntries = analytics
    ? Object.entries(analytics.band_distribution).sort(
        (a, b) => parseFloat(a[0]) - parseFloat(b[0]),
      )
    : [];
  const bandMax = bandEntries.reduce((m, [, v]) => Math.max(m, v), 0) || 1;

  const weakestLabel =
    analytics?.weakest && analytics.weakest in CRITERION_KEY
      ? t(CRITERION_KEY[analytics.weakest as CriterionKey])
      : analytics?.weakest ?? "—";

  const summaryCards = analytics
    ? [
        { hue: 47, value: analytics.total_submissions, label: t("totalAnswers") },
        { hue: 152, value: analytics.evaluated, label: t("evaluatedAnswers") },
        {
          hue: 28,
          value: analytics.active_students_7d,
          label: t("activeStudents"),
        },
        { hue: 305, value: weakestLabel, label: t("weakestCriterion") },
      ]
    : [];

  return (
    <div className="focus-wrap">
      <PageHead
        title={t("navGradebook")}
        sub={t("gradebookHint")}
        action={
          <Button
            variant="ghost"
            icon="arrowDown"
            onClick={exportCsv}
            disabled={exporting}
          >
            {exporting ? "…" : t("exportCsv")}
          </Button>
        }
      />

      {/* Group filter */}
      {groups && groups.length > 0 && (
        <div className="col gap-2" style={{ maxWidth: 280, marginBottom: 20 }}>
          <span
            style={{ fontSize: 13, fontWeight: 800, color: "var(--ink-soft)" }}
          >
            {t("navGroups")}
          </span>
          <select
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            style={{
              width: "100%",
              border: "1px solid var(--line-2)",
              borderRadius: "var(--r-sm)",
              padding: "11px 13px",
              fontSize: 14.5,
              outline: "none",
              color: "var(--ink)",
              background: "var(--surface-2)",
              fontFamily: "inherit",
            }}
          >
            <option value="">—</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Analytics summary cards */}
      {analytics && (
        <div className="g4" style={{ marginBottom: 20 }}>
          {summaryCards.map((c, i) => (
            <Card key={i} pad={18} style={{ textAlign: "center" }}>
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 900,
                  fontSize: 26,
                  color: `oklch(0.5 0.15 ${c.hue})`,
                }}
              >
                {c.value}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: "var(--muted)",
                  fontWeight: 700,
                  marginTop: 4,
                }}
              >
                {c.label}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Class average + band distribution */}
      {analytics && (
        <div className="g2" style={{ marginBottom: 20 }}>
          <Card>
            <SectionTitle>{t("classAverage")}</SectionTitle>
            <div className="col gap-3">
              {avgEntries.map((e) => (
                <div key={e.key} className="col gap-2">
                  <div className="row between" style={{ fontSize: 14 }}>
                    <span style={{ color: "var(--muted)", fontWeight: 700 }}>
                      {e.label}
                    </span>
                    <span
                      className="mono"
                      style={{ color: "var(--ink)", fontWeight: 800 }}
                    >
                      {fmtBand(e.value)}
                    </span>
                  </div>
                  <Bar
                    value={e.value ?? 0}
                    hue={bandColor(e.value ?? 0)}
                    height={8}
                  />
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <SectionTitle>{t("bandDistribution")}</SectionTitle>
            {bandEntries.length === 0 ? (
              <p style={{ color: "var(--muted)", fontSize: 14 }}>
                {t("noData")}
              </p>
            ) : (
              <div className="col gap-3">
                {bandEntries.map(([band, count]) => (
                  <div key={band} className="row gap-3" style={{ alignItems: "center" }}>
                    <span
                      className="mono"
                      style={{
                        width: 32,
                        flexShrink: 0,
                        fontWeight: 800,
                        color: `oklch(0.5 0.15 ${bandColor(parseFloat(band))})`,
                      }}
                    >
                      {band}
                    </span>
                    <div className="grow">
                      <Bar
                        value={(count / bandMax) * 100}
                        hue={bandColor(parseFloat(band))}
                        height={9}
                      />
                    </div>
                    <span
                      className="mono"
                      style={{
                        width: 24,
                        flexShrink: 0,
                        textAlign: "right",
                        fontSize: 13,
                        fontWeight: 700,
                        color: "var(--muted)",
                      }}
                    >
                      {count}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Gradebook table */}
      {rowsLoading ? (
        <Loading />
      ) : !rows?.length ? (
        <EmptyState text={t("noData")} />
      ) : (
        <Card pad={0} style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 560 }}>
            <div
              className="t-head"
              style={{
                display: "grid",
                gridTemplateColumns: COLS,
                columnGap: 12,
                padding: "14px 20px",
                borderBottom: "1px solid var(--line)",
                fontSize: 12,
                fontWeight: 800,
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              <span>{t("colStudent")}</span>
              <span style={{ textAlign: "center" }}>{t("colAttempts")}</span>
              <span style={{ textAlign: "center" }}>{t("colAvg")}</span>
              <span style={{ textAlign: "center" }}>{t("colBest")}</span>
              <span style={{ textAlign: "right" }}>{t("colLast")}</span>
            </div>

            {rows.map((r, i) => (
              <div
                key={r.student_id}
                className="t-row"
                style={{
                  display: "grid",
                  gridTemplateColumns: COLS,
                  columnGap: 12,
                  padding: "12px 20px",
                  borderBottom:
                    i < rows.length - 1 ? "1px solid var(--line)" : "none",
                  alignItems: "center",
                }}
              >
                <div className="row gap-3" style={{ minWidth: 0 }}>
                  <Avatar name={r.full_name} size={34} />
                  <div className="col" style={{ minWidth: 0 }}>
                    <span
                      className="truncate"
                      style={{ fontWeight: 700, fontSize: 14 }}
                    >
                      {r.full_name}
                    </span>
                    <span
                      className="truncate"
                      style={{ fontSize: 12, color: "var(--muted)" }}
                    >
                      {r.email}
                    </span>
                  </div>
                </div>
                <span
                  className="mono"
                  style={{
                    textAlign: "center",
                    fontWeight: 700,
                    fontSize: 14,
                    color: "var(--ink)",
                  }}
                >
                  {r.attempts}
                </span>
                <span style={{ textAlign: "center" }}>
                  {r.avg_band == null ? (
                    <span className="mono" style={{ color: "var(--faint)" }}>
                      —
                    </span>
                  ) : (
                    <Pill hue={bandColor(r.avg_band)} size="sm">
                      {fmtBand(r.avg_band)}
                    </Pill>
                  )}
                </span>
                <span
                  className="mono"
                  style={{
                    textAlign: "center",
                    fontWeight: 800,
                    fontSize: 14,
                    color:
                      r.best_band == null
                        ? "var(--faint)"
                        : `oklch(0.5 0.15 ${bandColor(r.best_band)})`,
                  }}
                >
                  {fmtBand(r.best_band)}
                </span>
                <span
                  style={{
                    textAlign: "right",
                    fontSize: 13,
                    color: "var(--muted)",
                  }}
                >
                  {fmtDate(r.last_activity)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
