import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import type { Assignment } from "../lib/types";
import {
  Card,
  Button,
  Pill,
  Icon,
  PageHead,
  Loading,
  EmptyState,
  bandColor,
  type IconName,
} from "../components/govori";

type DueState = "done" | "overdue" | "open";

function dueState(a: Assignment): DueState {
  if (a.completed) return "done";
  if (a.due_at && new Date(a.due_at).getTime() < Date.now()) return "overdue";
  return "open";
}

export function StudentAssignments() {
  const { t } = useI18n();
  const nav = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ["my-assignments"],
    queryFn: async () => (await api.get<Assignment[]>("/assignments/mine")).data,
  });

  const statusMeta: Record<DueState, { hue: number; icon: IconName; label: string }> = {
    open: { hue: 47, icon: "clock", label: t("notCompleted") },
    done: { hue: 152, icon: "check", label: t("completedLabel") },
    overdue: { hue: 28, icon: "flag", label: t("overdue") },
  };

  return (
    <div className="focus-wrap anim-fade-up">
      <PageHead title={t("myAssignments")} sub={t("assignmentsTitle")} />

      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <EmptyState text={t("noAssignments")} />
      ) : (
        <div className="g2">
          {data.map((a) => {
            const st = dueState(a);
            const sm = statusMeta[st];
            return (
              <Card key={a.id} style={{ opacity: st === "done" ? 0.9 : 1 }}>
                <div className="row between gap-2" style={{ marginBottom: 10 }}>
                  {a.question_topic ? (
                    <Pill hue={sm.hue} size="sm">
                      {a.question_topic}
                    </Pill>
                  ) : a.question_level ? (
                    <Pill hue={sm.hue} size="sm">
                      {a.question_level}
                    </Pill>
                  ) : (
                    <span />
                  )}
                  {a.due_at && (
                    <span
                      className="row gap-1"
                      style={{ fontSize: 12.5, fontWeight: 700, color: `oklch(0.5 0.15 ${sm.hue})` }}
                    >
                      <Icon name="calendar" size={14} />
                      {t("dueBy")}: {new Date(a.due_at).toLocaleDateString()}
                    </span>
                  )}
                </div>

                <h3 style={{ fontSize: 17, lineHeight: 1.35, minHeight: 46 }}>{a.question_title}</h3>

                <div
                  className="row between gap-2"
                  style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line)" }}
                >
                  {st === "done" && a.overall_band != null ? (
                    <Pill hue={bandColor(a.overall_band)} icon="check">
                      {Math.round(a.overall_band)}
                    </Pill>
                  ) : (
                    <span
                      className="row gap-2"
                      style={{ fontSize: 13, fontWeight: 700, color: `oklch(0.5 0.14 ${sm.hue})` }}
                    >
                      <Icon name={sm.icon} size={15} />
                      {sm.label}
                    </span>
                  )}

                  {a.completed && a.submission_id ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="eye"
                      onClick={() => nav(`/submissions/${a.submission_id}`)}
                    >
                      {t("result")}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      icon="mic"
                      onClick={() => nav(`/questions/${a.question_id}/answer`)}
                    >
                      {t("startSpeaking")}
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
