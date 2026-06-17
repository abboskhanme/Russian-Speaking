import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import type { Submission } from "../lib/types";
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  Icon,
  Loading,
  PageHead,
  Pill,
  SegTabs,
  bandColor,
  fmt,
} from "../components/govori";

/** Effective band for a submission: teacher override > AI evaluation. */
function subBand(s: Submission): number | null {
  if (s.teacher_band != null) return s.teacher_band;
  if (s.status === "done" && s.evaluation) return s.evaluation.overall_band;
  return null;
}

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

  return (
    <div className="focus-wrap">
      <PageHead title={t("studentAnswers")} />

      <div style={{ marginBottom: 18 }}>
        <SegTabs
          value={filter}
          onChange={(id) => setFilter(id as Filter)}
          tabs={[
            { id: "pending", label: t("pendingReview"), badge: pendingCount },
            { id: "reviewed", label: t("colScore"), badge: reviewedCount },
            { id: "all", label: t("all") },
          ]}
        />
      </div>

      {isLoading ? (
        <Loading />
      ) : !list.length ? (
        <EmptyState text={t("noAnswers")} />
      ) : (
        <div className="col gap-3">
          {list.map((s) => {
            const reviewed = isReviewed(s);
            const band = subBand(s);
            return (
              <Card key={s.id} hover pad={16} onClick={() => nav(`/submissions/${s.id}`)}>
                <div className="row gap-4 wrap">
                  <Avatar name={s.student_name} size={48} />
                  <div className="col grow" style={{ minWidth: 150, gap: 3 }}>
                    <span style={{ fontWeight: 800, fontSize: 15.5 }}>
                      {s.student_name ?? "—"}
                    </span>
                    <span style={{ fontSize: 13, color: "var(--muted)" }}>
                      {s.question_title ?? "—"}
                      {s.question_topic ? ` · ${s.question_topic}` : ""}
                    </span>
                  </div>
                  {s.audio_duration_sec != null && (
                    <span className="row gap-1 hide-sm" style={{ fontSize: 13, color: "var(--muted)" }}>
                      <Icon name="clock" size={14} />
                      {fmt(s.audio_duration_sec)}
                    </span>
                  )}
                  {reviewed && band != null ? (
                    <Pill hue={bandColor(band)} icon="check">
                      {Math.round(band)}
                    </Pill>
                  ) : s.status === "failed" ? (
                    <Pill hue={28}>{t("failed")}</Pill>
                  ) : (
                    <Pill hue={28}>{t("pendingReview")}</Pill>
                  )}
                  <Button size="sm" icon={reviewed ? "eye" : "play"}>
                    {reviewed ? t("viewAnswer") : t("open")}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
