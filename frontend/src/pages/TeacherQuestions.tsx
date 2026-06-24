import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { stripHtml } from "../components/RichTextEditor";
import type { Question, QuestionType } from "../lib/types";
import {
  Card,
  Button,
  Pill,
  Icon,
  PageHead,
  Loading,
  EmptyState,
  iconBtn,
  type IconName,
} from "../components/govori";
import { Dropdown, type DropdownOption } from "../components/Dropdown";
import { useConfirm } from "../components/ConfirmDialog";

/** Hue + icon per question type, matching the Govori practice grid. */
const TYPE_META: Record<QuestionType, { hue: number; icon: IconName }> = {
  text: { hue: 47, icon: "message" },
  image: { hue: 152, icon: "eye" },
  video: { hue: 248, icon: "play" },
};

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

export function TeacherQuestions() {
  const { t } = useI18n();
  const nav = useNavigate();
  const qc = useQueryClient();
  const ask = useConfirm();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "open" | "assigned">("all");
  const [level, setLevel] = useState("");
  const [topic, setTopic] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["questions", "mine"],
    queryFn: async () => (await api.get<Question[]>("/questions")).data,
  });

  const togglePublish = useMutation({
    mutationFn: async (q: Question) =>
      (await api.patch(`/questions/${q.id}`, { is_published: !q.is_published })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["questions"] }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/questions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["questions"] }),
  });

  const duplicate = useMutation({
    mutationFn: async (id: string) => api.post(`/questions/${id}/duplicate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["questions"] }),
  });

  // Topics actually present across the teacher's tests — the filter only offers
  // what exists, so it never shows empty results for a missing topic.
  const topicsAvailable = useMemo(() => {
    const set = new Set<string>();
    for (const q of data ?? []) if (q.topic) set.add(q.topic);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [data]);

  const rows = useMemo(() => {
    let arr = data ?? [];
    if (typeFilter !== "all") {
      arr = arr.filter((q) => (typeFilter === "open" ? q.is_public : !q.is_public));
    }
    if (level) arr = arr.filter((q) => q.level === level);
    if (topic) arr = arr.filter((q) => q.topic === topic);
    const s = search.trim().toLowerCase();
    if (s) {
      arr = arr.filter(
        (q) =>
          q.title.toLowerCase().includes(s) ||
          stripHtml(q.prompt_text).toLowerCase().includes(s) ||
          (q.topic ?? "").toLowerCase().includes(s),
      );
    }
    return arr;
  }, [data, search, typeFilter, level, topic]);

  const levelOptions: DropdownOption<string>[] = [
    { value: "", label: t("allLevels") },
    ...LEVELS.map((l) => ({ value: l, label: l })),
  ];
  const topicOptions: DropdownOption<string>[] = [
    { value: "", label: t("allTopics") },
    ...topicsAvailable.map((tp) => ({ value: tp, label: tp })),
  ];

  const hasFilters =
    !!search || typeFilter !== "all" || !!level || !!topic;
  const clearFilters = () => {
    setSearch("");
    setTypeFilter("all");
    setLevel("");
    setTopic("");
  };

  const typeLabel: Record<QuestionType, string> = {
    text: t("typeText"),
    image: t("typeImage"),
    video: t("typeVideo"),
  };

  return (
    <div className="focus-wrap anim-fade-up">
      <PageHead
        title={t("myTests")}
        action={
          <Button icon="plus" onClick={() => nav("/teacher/questions/new")}>
            {t("newTest")}
          </Button>
        }
      />

      {/* Filter toolbar: search · level · topic · task-type segmented control */}
      <Card pad={14} style={{ marginBottom: 18 }}>
        <div className="row gap-3 wrap" style={{ alignItems: "center" }}>
          <div
            className="row gap-2 grow"
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--line-2)",
              borderRadius: "var(--r-pill)",
              padding: "9px 16px",
              minWidth: 220,
            }}
          >
            <Icon name="search" size={18} style={{ color: "var(--muted)" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("searchPh")}
              style={{
                border: "none",
                background: "transparent",
                outline: "none",
                flex: 1,
                fontSize: 14,
                color: "var(--ink)",
                fontFamily: "inherit",
              }}
            />
          </div>

          <Dropdown value={level} onChange={setLevel} options={levelOptions} className="w-40" />
          <Dropdown
            value={topic}
            onChange={setTopic}
            options={topicOptions}
            placeholder={t("allTopics")}
            className="w-48"
          />

          {/* Task-type segmented control */}
          <div
            className="row"
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--line-2)",
              borderRadius: "var(--r-pill)",
              padding: 3,
              gap: 2,
            }}
          >
            {([
              ["all", t("allFilter")],
              ["open", t("taskOpenShort")],
              ["assigned", t("taskAssignedShort")],
            ] as const).map(([val, label]) => {
              const active = typeFilter === val;
              return (
                <button
                  key={val}
                  type="button"
                  onClick={() => setTypeFilter(val)}
                  className="tap"
                  style={{
                    padding: "7px 14px",
                    borderRadius: "var(--r-pill)",
                    border: "none",
                    background: active ? "var(--surface)" : "transparent",
                    color: active ? "var(--primary-press)" : "var(--muted)",
                    boxShadow: active ? "var(--sh-sm)" : "none",
                    fontFamily: "var(--font-display)",
                    fontWeight: 800,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Result count + clear, only once a filter narrows the list */}
        {hasFilters && (
          <div
            className="row between"
            style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line)" }}
          >
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)" }}>
              {t("resultsCount").replace("{n}", String(rows.length))}
            </span>
            <button
              type="button"
              onClick={clearFilters}
              className="row gap-1 tap"
              style={{
                border: "none",
                background: "transparent",
                color: "var(--primary-press)",
                fontWeight: 800,
                fontFamily: "var(--font-display)",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              <Icon name="x" size={14} />
              {t("clearFilters")}
            </button>
          </div>
        )}
      </Card>

      {isLoading ? (
        <Loading />
      ) : !rows.length ? (
        <EmptyState text={t("noTests")} />
      ) : (
        <div className="col gap-3">
          {rows.map((q) => {
            const meta = TYPE_META[q.type];
            return (
              <Card key={q.id} hover pad={16}>
                <div className="row gap-4 wrap">
                  <div
                    style={{
                      width: 46,
                      height: 46,
                      borderRadius: 13,
                      background: `oklch(0.94 0.06 ${meta.hue})`,
                      color: `oklch(0.5 0.15 ${meta.hue})`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <Icon name={meta.icon} size={21} />
                  </div>
                  <div className="col grow" style={{ minWidth: 180, gap: 5 }}>
                    <span style={{ fontWeight: 700, fontSize: 15.5, lineHeight: 1.3 }}>{q.title}</span>
                    {q.prompt_text && (
                      <span
                        className="truncate"
                        style={{ fontSize: 13, color: "var(--muted)", maxWidth: 460 }}
                      >
                        {stripHtml(q.prompt_text)}
                      </span>
                    )}
                    <div className="row gap-2 wrap">
                      <Pill hue={meta.hue} size="sm">
                        {typeLabel[q.type]}
                      </Pill>
                      <Pill hue={q.is_public ? 200 : 305} size="sm" icon={q.is_public ? "globe" : "lock"}>
                        {q.is_public ? t("taskOpenShort") : t("taskAssignedShort")}
                      </Pill>
                      {q.level && (
                        <Pill hue={47} size="sm">
                          {q.level}
                        </Pill>
                      )}
                      {q.topic && (
                        <span
                          className="row gap-1"
                          style={{ fontSize: 12, color: "var(--muted)" }}
                        >
                          <Icon name="flag" size={13} />
                          {q.topic}
                        </span>
                      )}
                      <Pill hue={q.is_published ? 152 : 47} size="sm" solid={q.is_published}>
                        {q.is_published ? t("published") : t("draft")}
                      </Pill>
                    </div>
                  </div>
                  <div className="row gap-2">
                    <button
                      style={iconBtn}
                      className="tap"
                      title={t("edit")}
                      onClick={() => nav(`/teacher/questions/${q.id}/edit`)}
                    >
                      <Icon name="edit" size={18} />
                    </button>
                    <button
                      style={iconBtn}
                      className="tap"
                      title={q.is_published ? t("unpublish") : t("publish")}
                      onClick={() => togglePublish.mutate(q)}
                    >
                      <Icon name="eye" size={18} />
                    </button>
                    <button
                      style={iconBtn}
                      className="tap"
                      title={t("duplicate")}
                      onClick={() => duplicate.mutate(q.id)}
                    >
                      <Icon name="layers" size={18} />
                    </button>
                    <button
                      style={iconBtn}
                      className="tap"
                      title={t("delete")}
                      onClick={async () => {
                        if (
                          await ask({
                            message: t("deleteConfirm"),
                            confirmText: t("delete"),
                            destructive: true,
                          })
                        )
                          remove.mutate(q.id);
                      }}
                    >
                      <Icon name="trash" size={18} />
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
