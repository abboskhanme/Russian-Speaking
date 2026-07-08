import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { answerScore } from "../lib/score";
import type { Submission } from "../lib/types";
import {
  Avatar,
  Button,
  DataTable,
  Icon,
  Loading,
  PageHead,
  Pill,
  SegTabs,
  Toolbar,
  bandColor,
  fmt,
  type Column,
} from "../components/govori";

/** Effective band for a submission: teacher override > AI evaluation. */
const subBand = answerScore;

/** A row showing a student's answer (used in teacher dashboard + list). */
export function AnswerRow({ s, onClick }: { s: Submission; onClick: () => void }) {
  const { t } = useI18n();
  const band = subBand(s);
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
      <Avatar name={s.student_name} size={42} />
      <div className="col grow" style={{ minWidth: 0 }}>
        <span className="truncate" style={{ fontWeight: 800, fontSize: 14.5 }}>
          {s.student_name ?? "—"}
        </span>
        <span className="truncate" style={{ fontSize: 12.5, color: "var(--muted)" }}>
          {s.question_title ?? "—"}
          {s.question_topic ? ` · ${s.question_topic}` : ""}
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
        <Pill hue={28} size="sm">
          {t("pendingReview")}
        </Pill>
      )}
      <Icon name="chevR" size={20} style={{ color: "var(--faint)" }} />
    </div>
  );
}

export function useTeacherSubmissions() {
  return useQuery({
    queryKey: ["teacher-submissions"],
    queryFn: async () => (await api.get<Submission[]>("/submissions")).data,
  });
}

type Filter = "pending" | "reviewed" | "all";

function isPending(s: Submission): boolean {
  return s.teacher_band == null && s.status !== "failed";
}
function isReviewed(s: Submission): boolean {
  return s.teacher_band != null || (s.status === "done" && !!s.evaluation);
}

export function TeacherSubmissions() {
  const { t } = useI18n();
  const nav = useNavigate();
  const { data, isLoading } = useTeacherSubmissions();
  const [filter, setFilter] = useState<Filter>("pending");

  const all = data ?? [];
  const pendingCount = all.filter(isPending).length;
  const reviewedCount = all.filter(isReviewed).length;
  const list = all.filter((s) =>
    filter === "all" ? true : filter === "pending" ? isPending(s) : isReviewed(s),
  );

  const columns: Column<Submission>[] = [
    {
      key: "student",
      header: t("colStudent"),
      render: (s) => (
        <div className="row gap-3" style={{ minWidth: 0 }}>
          <Avatar name={s.student_name} size={36} />
          <div className="col" style={{ minWidth: 0 }}>
            <span className="truncate" style={{ fontWeight: 700, fontSize: 14.5 }}>
              {s.student_name ?? "—"}
            </span>
            <span className="truncate" style={{ fontSize: 12.5, color: "var(--muted)" }}>
              {s.question_title ?? "—"}
              {s.question_topic ? ` · ${s.question_topic}` : ""}
            </span>
          </div>
        </div>
      ),
    },
    {
      key: "duration",
      header: t("duration"),
      align: "right",
      hideSm: true,
      render: (s) =>
        s.audio_duration_sec != null ? (
          <span className="mono" style={{ color: "var(--muted)" }}>
            {fmt(s.audio_duration_sec)}
          </span>
        ) : (
          <span style={{ color: "var(--faint)" }}>—</span>
        ),
    },
    {
      key: "status",
      header: t("colScore"),
      align: "right",
      render: (s) => {
        const band = subBand(s);
        const reviewed = isReviewed(s);
        return reviewed && band != null ? (
          <Pill hue={bandColor(band)} size="sm" icon="check">
            {Math.round(band)}
          </Pill>
        ) : s.status === "failed" ? (
          <Pill hue={28} size="sm">
            {t("failed")}
          </Pill>
        ) : (
          <Pill hue={28} size="sm">
            {t("pendingReview")}
          </Pill>
        );
      },
    },
    {
      key: "actions",
      header: t("colActions"),
      align: "right",
      render: (s) => {
        const reviewed = isReviewed(s);
        return (
          <div className="row" style={{ justifyContent: "flex-end" }} onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="ghost" icon={reviewed ? "eye" : "play"} onClick={() => nav(`/submissions/${s.id}`)}>
              {reviewed ? t("viewAnswer") : t("open")}
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="focus-wrap">
      <PageHead title={t("studentAnswers")} />

      <Toolbar
        left={
          <SegTabs
            value={filter}
            onChange={(id) => setFilter(id as Filter)}
            tabs={[
              { id: "pending", label: t("pendingReview"), badge: pendingCount },
              { id: "reviewed", label: t("colScore"), badge: reviewedCount },
              { id: "all", label: t("all") },
            ]}
          />
        }
      />

      {isLoading ? (
        <Loading />
      ) : (
        <DataTable
          columns={columns}
          rows={list}
          rowKey={(s) => s.id}
          onRowClick={(s) => nav(`/submissions/${s.id}`)}
          minWidth={640}
          empty={t("noAnswers")}
        />
      )}
    </div>
  );
}
