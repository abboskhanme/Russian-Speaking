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
  DataTable,
  Loading,
  PageHead,
  Pill,
  SectionTitle,
  StatTile,
  Toolbar,
  bandColor,
  type Column,
} from "../components/govori";
import { Dropdown, type DropdownOption } from "../components/Dropdown";

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

  const groupOptions: DropdownOption<string>[] = [
    { value: "", label: t("allGroups") },
    ...(groups ?? []).map((g) => ({ value: g.id, label: g.name })),
  ];

  const columns: Column<GradebookRow>[] = [
    {
      key: "student",
      header: t("colStudent"),
      render: (r) => (
        <div className="row gap-3" style={{ minWidth: 0 }}>
          <Avatar name={r.full_name} size={34} />
          <div className="col" style={{ minWidth: 0 }}>
            <span className="truncate" style={{ fontWeight: 700, fontSize: 14 }}>
              {r.full_name}
            </span>
            <span className="truncate" style={{ fontSize: 12, color: "var(--muted)" }}>
              {r.email}
            </span>
          </div>
        </div>
      ),
    },
    {
      key: "attempts",
      header: t("colAttempts"),
      align: "right",
      render: (r) => (
        <span className="mono" style={{ fontWeight: 700, color: "var(--ink)" }}>
          {r.attempts}
        </span>
      ),
    },
    {
      key: "avg",
      header: t("colAvg"),
      align: "right",
      render: (r) =>
        r.avg_band == null ? (
          <span className="mono" style={{ color: "var(--faint)" }}>—</span>
        ) : (
          <Pill hue={bandColor(r.avg_band)} size="sm">
            {fmtBand(r.avg_band)}
          </Pill>
        ),
    },
    {
      key: "best",
      header: t("colBest"),
      align: "right",
      render: (r) => (
        <span
          className="mono"
          style={{
            fontWeight: 800,
            color: r.best_band == null ? "var(--faint)" : `oklch(0.5 0.15 ${bandColor(r.best_band)})`,
          }}
        >
          {fmtBand(r.best_band)}
        </span>
      ),
    },
    {
      key: "last",
      header: t("colLast"),
      align: "right",
      hideSm: true,
      render: (r) => (
        <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>
          {fmtDate(r.last_activity)}
        </span>
      ),
    },
  ];

  return (
    <div className="focus-wrap">
      <PageHead
        title={t("navGradebook")}
        sub={t("gradebookHint")}
        action={
          <Button variant="ghost" icon="arrowDown" onClick={exportCsv} disabled={exporting}>
            {exporting ? "…" : t("exportCsv")}
          </Button>
        }
      />

      {groups && groups.length > 0 && (
        <Toolbar
          left={
            <Dropdown value={group} onChange={setGroup} options={groupOptions} className="w-48" />
          }
        />
      )}

      {/* Analytics summary — neutral monochrome KPIs */}
      {analytics && (
        <div className="g4" style={{ marginBottom: 20 }}>
          <StatTile value={analytics.total_submissions} label={t("totalAnswers")} icon="mic" />
          <StatTile value={analytics.evaluated} label={t("evaluatedAnswers")} icon="check" />
          <StatTile value={analytics.active_students_7d} label={t("activeStudents")} icon="users" />
          <StatTile value={weakestLabel} label={t("weakestCriterion")} icon="target" accent="warn" />
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
                    <span style={{ color: "var(--muted)", fontWeight: 700 }}>{e.label}</span>
                    <span className="mono" style={{ color: "var(--ink)", fontWeight: 800 }}>
                      {fmtBand(e.value)}
                    </span>
                  </div>
                  <Bar value={e.value ?? 0} hue={bandColor(e.value ?? 0)} height={8} />
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <SectionTitle>{t("bandDistribution")}</SectionTitle>
            {bandEntries.length === 0 ? (
              <p style={{ color: "var(--muted)", fontSize: 14 }}>{t("noData")}</p>
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
                      <Bar value={(count / bandMax) * 100} hue={bandColor(parseFloat(band))} height={9} />
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
      ) : (
        <DataTable
          columns={columns}
          rows={rows ?? []}
          rowKey={(r) => r.student_id}
          minWidth={560}
          empty={t("noData")}
        />
      )}
    </div>
  );
}
