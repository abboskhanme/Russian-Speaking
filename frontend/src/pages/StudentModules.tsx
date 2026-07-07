import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import type { StudentModule, StudentTask } from "../lib/types";
import { Card, EmptyState, Icon, Loading, PageHead, Pill, SectionTitle } from "../components/govori";

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

function TaskRow({
  task,
  onOpen,
  onPremium,
}: {
  task: StudentTask;
  onOpen: () => void;
  onPremium: () => void;
}) {
  const { t } = useI18n();
  // Sequential lock (must finish the previous task) beats the premium lock.
  const seqLocked = task.locked && !task.done;
  const premiumLocked = task.premium_locked && !task.done && !seqLocked;
  const state = task.done ? "done" : seqLocked ? "locked" : premiumLocked ? "premium" : "open";
  // A completed task stays reopenable so students can practise it again.
  const clickable = state === "open" || state === "premium" || state === "done";
  const bg =
    state === "open" ? "var(--primary-tint)" : state === "premium" ? "var(--amber-tint)" : "var(--surface)";
  const border =
    state === "open"
      ? "1px solid var(--primary)"
      : state === "premium"
      ? "1px solid oklch(0.8 0.12 70)"
      : "1px solid var(--line)";
  const iconName = state === "done" ? "check" : state === "locked" ? "lock" : state === "premium" ? "star" : "play";
  const iconBg =
    state === "done"
      ? "var(--primary)"
      : state === "locked"
      ? "var(--surface-2)"
      : state === "premium"
      ? "oklch(0.72 0.14 70)"
      : "var(--primary)";
  const iconColor = state === "locked" ? "var(--faint)" : "#fff";
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={state === "premium" ? onPremium : clickable ? onOpen : undefined}
      title={state === "locked" ? t("moduleLocked") : state === "premium" ? t("premiumTaskHint") : undefined}
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
      {state === "premium" && <Pill hue={70} size="sm">{t("premium")}</Pill>}
      {task.level && (
        <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700 }}>{task.level}</span>
      )}
      {clickable && <Icon name="chevR" size={16} style={{ color: "var(--muted)" }} />}
    </button>
  );
}

/** A module that expands to reveal its tasks on tap, and collapses on the next tap. */
function ModuleAccordion({
  m,
  open,
  onToggle,
}: {
  m: StudentModule;
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const nav = useNavigate();
  const pct = m.total ? Math.round((m.done_count / m.total) * 100) : 0;
  return (
    <Card>
      {/* Header — tap to expand / collapse */}
      <button
        type="button"
        onClick={onToggle}
        className="tap"
        style={{ width: "100%", textAlign: "left", border: "none", background: "transparent", padding: 0, cursor: "pointer" }}
      >
        <div className="row between gap-3">
          <div className="row gap-3" style={{ minWidth: 0, alignItems: "center" }}>
            <span
              style={{
                width: 46, height: 46, borderRadius: 13, flexShrink: 0, overflow: "hidden",
                background: "var(--primary-tint)", color: "var(--primary-press)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              {m.cover_url ? (
                <img src={m.cover_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <Icon name="layers" size={23} />
              )}
            </span>
            <div className="col" style={{ minWidth: 0 }}>
              <h3 style={{ fontSize: 17 }} className="truncate">{m.name}</h3>
              <div className="row gap-2 wrap" style={{ marginTop: 2 }}>
                {m.visibility === "public" && <Pill hue={152} size="sm">{t("visOfficial")}</Pill>}
                {m.level && <Pill hue={200} size="sm">{m.level}</Pill>}
                {m.ru_style && (
                  <Pill hue={m.ru_style === "live" ? 305 : 47} size="sm">
                    {m.ru_style === "live" ? t("ruLive") : t("ruRegular")}
                  </Pill>
                )}
              </div>
            </div>
          </div>
          <div className="row gap-2" style={{ alignItems: "center", flexShrink: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: "var(--ink-soft)", whiteSpace: "nowrap" }}>
              {m.done_count}/{m.total}
            </span>
            <Icon
              name="chevD"
              size={18}
              style={{ color: "var(--muted)", transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }}
            />
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <ProgressBar pct={pct} />
        </div>
      </button>

      {/* Tasks — only when expanded */}
      {open && (
        <div className="col gap-2" style={{ marginTop: 14 }}>
          {m.tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onOpen={() => nav(`/questions/${task.id}/answer`)}
              onPremium={() => nav("/premium")}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

export function StudentModules() {
  const { t } = useI18n();
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["student-modules"],
    queryFn: async () => (await api.get<StudentModule[]>("/blocks/student")).data,
  });

  const official = (data ?? []).filter((m) => m.visibility === "public");
  const teacher = (data ?? []).filter((m) => m.visibility === "group");

  return (
    <div className="focus-wrap">
      <PageHead title={t("modulesTitle")} sub={t("modulesHint")} />
      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <EmptyState text={t("noModules")} />
      ) : (
        <div className="col gap-7">
          {[
            { title: t("sectionOfficialModules"), items: official },
            { title: t("sectionTeacherModules"), items: teacher },
          ].map((section) =>
            section.items.length === 0 ? null : (
              <div key={section.title} className="col gap-4">
                <SectionTitle>{section.title}</SectionTitle>
                <div className="col gap-3">
                  {section.items.map((m) => (
                    <ModuleAccordion
                      key={m.id}
                      m={m}
                      open={openId === m.id}
                      onToggle={() => setOpenId((cur) => (cur === m.id ? null : m.id))}
                    />
                  ))}
                </div>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
