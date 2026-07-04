import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import type { StudentModule, StudentTask } from "../lib/types";
import { Card, EmptyState, Icon, Loading, PageHead, Pill } from "../components/govori";

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div style={{ height: 8, borderRadius: 999, background: "var(--surface-2)", overflow: "hidden" }}>
      <div
        style={{
          width: `${pct}%`,
          height: "100%",
          borderRadius: 999,
          background: "var(--primary)",
          transition: "width .3s",
        }}
      />
    </div>
  );
}

function TaskRow({ task, onOpen }: { task: StudentTask; onOpen: () => void }) {
  const { t } = useI18n();
  const clickable = !task.locked;
  const state = task.done ? "done" : task.locked ? "locked" : "open";
  const bg = state === "open" ? "var(--primary-tint)" : "var(--surface)";
  const border =
    state === "open" ? "1px solid var(--primary)" : "1px solid var(--line)";
  const iconName = state === "done" ? "check" : state === "locked" ? "lock" : "play";
  const iconBg =
    state === "done" ? "var(--primary)" : state === "locked" ? "var(--surface-2)" : "var(--primary)";
  const iconColor = state === "locked" ? "var(--faint)" : "#fff";
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={clickable ? onOpen : undefined}
      title={state === "locked" ? t("moduleLocked") : undefined}
      className={clickable ? "tap" : undefined}
      style={{
        width: "100%",
        textAlign: "left",
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        borderRadius: "var(--r-sm)",
        border,
        background: bg,
        cursor: clickable ? "pointer" : "default",
        opacity: state === "locked" ? 0.6 : 1,
      }}
    >
      <span
        style={{
          width: 30,
          height: 30,
          borderRadius: "50%",
          background: iconBg,
          color: iconColor,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Icon name={iconName} size={16} />
      </span>
      <span className="grow truncate" style={{ fontWeight: 700, fontSize: 14.5 }}>
        {task.title}
      </span>
      {task.level && (
        <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700 }}>{task.level}</span>
      )}
      {clickable && <Icon name="chevR" size={16} style={{ color: "var(--muted)" }} />}
    </button>
  );
}

export function StudentModules() {
  const { t } = useI18n();
  const nav = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ["student-modules"],
    queryFn: async () => (await api.get<StudentModule[]>("/blocks/student")).data,
  });

  return (
    <div className="focus-wrap">
      <PageHead title={t("modulesTitle")} sub={t("modulesHint")} />
      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <EmptyState text={t("noModules")} />
      ) : (
        <div className="col gap-5">
          {data.map((m) => {
            const pct = m.total ? Math.round((m.done_count / m.total) * 100) : 0;
            return (
              <Card key={m.id}>
                <div className="row between wrap gap-3" style={{ marginBottom: 12 }}>
                  <div className="row gap-3" style={{ minWidth: 0, alignItems: "center" }}>
                    <span
                      style={{
                        width: 42,
                        height: 42,
                        borderRadius: 12,
                        background: "var(--primary-tint)",
                        color: "var(--primary-press)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <Icon name="layers" size={22} />
                    </span>
                    <div className="col" style={{ minWidth: 0 }}>
                      <h3 style={{ fontSize: 17 }} className="truncate">
                        {m.name}
                      </h3>
                      <div className="row gap-2" style={{ marginTop: 2 }}>
                        {m.level && <Pill hue={200} size="sm">{m.level}</Pill>}
                        {m.ru_style && (
                          <Pill hue={m.ru_style === "live" ? 305 : 47} size="sm">
                            {m.ru_style === "live" ? t("ruLive") : t("ruRegular")}
                          </Pill>
                        )}
                      </div>
                    </div>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 800, color: "var(--ink-soft)", whiteSpace: "nowrap" }}>
                    {m.done_count}/{m.total}
                  </span>
                </div>

                <div style={{ marginBottom: 14 }}>
                  <ProgressBar pct={pct} />
                </div>

                <div className="col gap-2">
                  {m.tasks.map((task) => (
                    <TaskRow key={task.id} task={task} onOpen={() => nav(`/questions/${task.id}/answer`)} />
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
