import { useMemo, useState } from "react";
import { useI18n } from "../lib/i18n";
import type { Question, QuestionType } from "../lib/types";
import {
  DataTable,
  Pill,
  Icon,
  SearchInput,
  Toolbar,
  iconBtn,
  type Column,
  type IconName,
} from "./govori";
import { stripHtml } from "./RichTextEditor";
import { Dropdown, type DropdownOption } from "./Dropdown";
import { useConfirm } from "./ConfirmDialog";

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

  const columns: Column<Question>[] = [
    {
      key: "name",
      header: t("colName"),
      width: "34%",
      render: (q) => (
        <div className="col" style={{ gap: 2, minWidth: 0 }}>
          <span style={{ fontWeight: 700, color: "var(--ink)" }}>{q.title}</span>
          <span className="truncate" style={{ fontSize: 13, color: "var(--muted)" }}>
            {stripHtml(q.prompt_text)}
          </span>
        </div>
      ),
    },
    {
      key: "type",
      header: t("colType"),
      hideSm: true,
      render: (q) => <span style={{ color: "var(--ink-soft)", whiteSpace: "nowrap" }}>{typeLabel[q.type]}</span>,
    },
    ...(showTeacher
      ? [
          {
            key: "teacher",
            header: t("colTeacher"),
            hideSm: true,
            render: (q: Question) => (
              <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{q.teacher_name ?? "—"}</span>
            ),
          } as Column<Question>,
        ]
      : []),
    {
      key: "topic",
      header: t("colTopic"),
      hideSm: true,
      render: (q) => <span style={{ color: "var(--ink-soft)", whiteSpace: "nowrap" }}>{q.topic || "—"}</span>,
    },
    {
      key: "level",
      header: t("colLevel"),
      hideSm: true,
      render: (q) => (q.level ? <Pill hue={47} size="sm">{q.level}</Pill> : <span>—</span>),
    },
    {
      key: "status",
      header: t("colStatus"),
      render: (q) =>
        q.is_published ? (
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
        ),
    },
    {
      key: "date",
      header: t("colDate"),
      hideSm: true,
      render: (q) => (
        <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>
          {new Date(q.created_at).toLocaleDateString()}
        </span>
      ),
    },
    ...(hasActions
      ? [
          {
            key: "actions",
            header: t("colActions"),
            align: "right",
            render: (q: Question) => (
              <div className="row" style={{ gap: 2, justifyContent: "flex-end" }}>
                {onEdit && <ActionBtn icon="edit" title={t("edit")} onClick={() => onEdit(q.id)} />}
                {onTogglePublish && (
                  <ActionBtn
                    icon="check"
                    title={q.is_published ? t("unpublish") : t("publish")}
                    onClick={() => onTogglePublish(q)}
                  />
                )}
                {onDuplicate && <ActionBtn icon="layers" title={t("duplicate")} onClick={() => onDuplicate(q.id)} />}
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
            ),
          } as Column<Question>,
        ]
      : []),
  ];

  return (
    <div>
      <Toolbar
        left={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder={t("searchPh")} width={280} />
            <Dropdown value={level} onChange={setLevel} options={opt(t("allLevels"), levels)} className="w-40" />
            <Dropdown value={topic} onChange={setTopic} options={opt(t("allTopics"), topics)} className="w-44" />
            {showTeacher && (
              <Dropdown value={teacher} onChange={setTeacher} options={opt(t("all"), teachers)} className="w-48" />
            )}
          </>
        }
        right={<span style={{ fontSize: 14, fontWeight: 800, color: "var(--muted)" }}>{rows.length}</span>}
      />

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(q) => q.id}
        onRowClick={onEdit ? (q) => onEdit(q.id) : undefined}
        minWidth={showTeacher ? 900 : 760}
        empty={t("noTests")}
      />
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
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="tap"
      style={{ ...iconBtn, width: 36, height: 36, color: danger ? "var(--danger)" : "var(--ink-soft)" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <Icon name={icon} size={18} />
    </button>
  );
}
