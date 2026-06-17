import { useMemo, useState, type CSSProperties } from "react";
import { useI18n } from "../lib/i18n";
import type { Question, QuestionType } from "../lib/types";
import { Card, Pill, Icon, iconBtn, inp, type IconName } from "./govori";
import { Dropdown, type DropdownOption } from "./Dropdown";
import { useConfirm } from "./ConfirmDialog";

const TYPE_EMOJI: Record<QuestionType, string> = { text: "📝", image: "🖼️", video: "🎬" };

interface Props {
  questions: Question[];
  showTeacher?: boolean;
  onEdit?: (id: string) => void;
  onTogglePublish?: (q: Question) => void;
  onDuplicate?: (id: string) => void;
  onDelete?: (id: string) => void;
}

export function TestsTable({ questions, showTeacher, onEdit, onTogglePublish, onDuplicate, onDelete }: Props) {
  const { t } = useI18n();
  const ask = useConfirm();
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState("");
  const [topic, setTopic] = useState("");
  const [teacher, setTeacher] = useState("");

  // Distinct filter options derived from the data.
  const levels = useMemo(
    () => [...new Set(questions.map((q) => q.level).filter(Boolean))].sort() as string[],
    [questions],
  );
  const topics = useMemo(
    () => [...new Set(questions.map((q) => q.topic).filter(Boolean))].sort() as string[],
    [questions],
  );
  const teachers = useMemo(
    () => [...new Set(questions.map((q) => q.teacher_name).filter(Boolean))].sort() as string[],
    [questions],
  );

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return questions.filter((q) => {
      if (level && q.level !== level) return false;
      if (topic && q.topic !== topic) return false;
      if (teacher && q.teacher_name !== teacher) return false;
      if (
        s &&
        !q.title.toLowerCase().includes(s) &&
        !(q.topic ?? "").toLowerCase().includes(s) &&
        !(q.teacher_name ?? "").toLowerCase().includes(s)
      )
        return false;
      return true;
    });
  }, [questions, search, level, topic, teacher]);

  const typeLabel: Record<QuestionType, string> = {
    text: t("typeText"),
    image: t("typeImage"),
    video: t("typeVideo"),
  };
  const hasActions = !!(onEdit || onTogglePublish || onDuplicate || onDelete);

  const opt = (all: string, list: string[]): DropdownOption<string>[] => [
    { value: "", label: all },
    ...list.map((v) => ({ value: v, label: v })),
  ];

  // Grid columns: name first (flexes), actions last (auto) — to match the
  // mobile `.t-row { 1fr auto }` override; middle cells carry `t-hide-sm`.
  const cols = [
    "minmax(180px, 2fr)", // name
    "minmax(120px, 1fr)", // type
    ...(showTeacher ? ["minmax(120px, 1fr)"] : []), // teacher
    "minmax(110px, 1fr)", // topic
    "minmax(90px, auto)", // level
    "minmax(110px, auto)", // status
    "minmax(110px, auto)", // date
    ...(hasActions ? ["auto"] : []), // actions
  ].join(" ");

  const gridStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: cols,
    alignItems: "center",
    gap: 12,
    padding: "12px 18px",
  };

  const cellMuted: CSSProperties = { color: "var(--muted)", fontSize: 14, whiteSpace: "nowrap" };

  return (
    <div>
      {/* Toolbar */}
      <div className="row wrap" style={{ gap: 10, marginBottom: 16 }}>
        <div
          className="row"
          style={{
            gap: 8,
            flex: "1 1 240px",
            maxWidth: 320,
            background: "var(--surface-2)",
            border: "1px solid var(--line-2)",
            borderRadius: "var(--r-sm)",
            padding: "0 12px",
          }}
        >
          <Icon name="search" size={18} style={{ color: "var(--muted)", flexShrink: 0 }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("searchPh")}
            style={{ ...inp, border: "none", background: "transparent", padding: "11px 0" }}
          />
        </div>
        <Dropdown value={level} onChange={setLevel} options={opt(t("allLevels"), levels)} className="w-40" />
        <Dropdown value={topic} onChange={setTopic} options={opt(t("allTopics"), topics)} className="w-44" />
        {showTeacher && (
          <Dropdown value={teacher} onChange={setTeacher} options={opt(t("all"), teachers)} className="w-48" />
        )}
        <span style={{ marginLeft: "auto", fontSize: 14, fontWeight: 800, color: "var(--muted)" }}>{rows.length}</span>
      </div>

      {/* Table */}
      <Card pad={0} style={{ overflow: "hidden" }}>
        {/* Header */}
        <div
          className="t-head"
          style={{
            ...gridStyle,
            background: "var(--surface-2)",
            borderBottom: "1px solid var(--line)",
            fontSize: 12,
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            color: "var(--muted)",
          }}
        >
          <span>{t("colName")}</span>
          <span>{t("colType")}</span>
          {showTeacher && <span>{t("colTeacher")}</span>}
          <span>{t("colTopic")}</span>
          <span>{t("colLevel")}</span>
          <span>{t("colStatus")}</span>
          <span>{t("colDate")}</span>
          {hasActions && <span style={{ textAlign: "right" }}>{t("colActions")}</span>}
        </div>

        {/* Body */}
        {rows.map((q) => (
          <div
            key={q.id}
            className="t-row"
            style={{ ...gridStyle, borderBottom: "1px solid var(--line)" }}
          >
            <div className="col" style={{ gap: 2, minWidth: 0 }}>
              <span style={{ fontWeight: 700, color: "var(--ink)" }}>{q.title}</span>
              <span
                style={{
                  fontSize: 13,
                  color: "var(--muted)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {q.prompt_text}
              </span>
            </div>

            <span className="t-hide-sm" style={{ whiteSpace: "nowrap", color: "var(--ink-soft)" }}>
              {TYPE_EMOJI[q.type]} {typeLabel[q.type]}
            </span>

            {showTeacher && (
              <span className="t-hide-sm" style={cellMuted}>
                {q.teacher_name ?? "—"}
              </span>
            )}

            <span className="t-hide-sm" style={{ whiteSpace: "nowrap", color: "var(--ink-soft)" }}>
              {q.topic || "—"}
            </span>

            <span className="t-hide-sm" style={{ whiteSpace: "nowrap" }}>
              {q.level ? (
                <Pill hue={47} size="sm">
                  {q.level}
                </Pill>
              ) : (
                "—"
              )}
            </span>

            <span className="t-hide-sm" style={{ whiteSpace: "nowrap" }}>
              {q.is_published ? (
                <Pill hue={152} size="sm">
                  {t("published")}
                </Pill>
              ) : (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    background: "var(--surface-3)",
                    color: "var(--muted)",
                    borderRadius: "var(--r-pill)",
                    fontWeight: 700,
                    fontFamily: "var(--font-display)",
                    fontSize: 11.5,
                    padding: "3px 9px",
                  }}
                >
                  {t("draft")}
                </span>
              )}
            </span>

            <span className="t-hide-sm" style={cellMuted}>
              {new Date(q.created_at).toLocaleDateString()}
            </span>

            {hasActions && (
              <div className="row" style={{ gap: 2, justifyContent: "flex-end" }}>
                {onEdit && (
                  <ActionBtn icon="edit" title={t("edit")} onClick={() => onEdit(q.id)} />
                )}
                {onTogglePublish && (
                  <ActionBtn
                    icon="check"
                    title={q.is_published ? t("unpublish") : t("publish")}
                    onClick={() => onTogglePublish(q)}
                  />
                )}
                {onDuplicate && (
                  <ActionBtn icon="layers" title={t("duplicate")} onClick={() => onDuplicate(q.id)} />
                )}
                {onDelete && (
                  <ActionBtn
                    icon="trash"
                    title={t("delete")}
                    danger
                    onClick={async () => {
                      if (await ask({ message: t("deleteConfirm"), confirmText: t("delete"), destructive: true }))
                        onDelete(q.id);
                    }}
                  />
                )}
              </div>
            )}
          </div>
        ))}
      </Card>
    </div>
  );
}

/** A small round icon button used for row actions. */
function ActionBtn({
  icon,
  title,
  onClick,
  danger,
}: {
  icon: IconName;
  title: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="tap"
      style={{ ...iconBtn, width: 36, height: 36, color: danger ? "var(--danger)" : "var(--ink-soft)" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <Icon name={icon} size={18} />
    </button>
  );
}
