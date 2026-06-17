import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import type { GroupOverview, GroupTask, Question, StudentManage } from "../lib/types";
import { useConfirm } from "../components/ConfirmDialog";
import {
  Avatar,
  Bar,
  Button,
  Card,
  Field,
  Icon,
  Loading,
  Pill,
  SegTabs,
  bandColor,
  inp,
} from "../components/govori";

/** Stable hue per group id, for the gradient icon. */
function groupHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

export function TeacherGroupDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const { t } = useI18n();
  const nav = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [tab, setTab] = useState<"students" | "tasks">("students");

  const { data: ov, isLoading } = useQuery({
    queryKey: ["group-overview", id],
    queryFn: async () => (await api.get<GroupOverview>(`/groups/${id}/overview`)).data,
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ["group-overview", id] });
    qc.invalidateQueries({ queryKey: ["teacher-groups"] });
  }

  const removeGroup = useMutation({
    mutationFn: async () => api.delete(`/groups/${id}`),
    onSuccess: () => nav("/teacher/groups"),
  });

  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState("");
  const rename = useMutation({
    mutationFn: async () => api.patch(`/groups/${id}`, { name: nameVal }),
    onSuccess: () => {
      setEditingName(false);
      refresh();
    },
  });

  if (isLoading || !ov) return <Loading full />;

  const hue = groupHue(ov.id);

  return (
    <div className="focus-wrap">
      <Button
        variant="ghost"
        size="sm"
        icon="chevL"
        onClick={() => nav("/teacher/groups")}
        style={{ marginBottom: 16 }}
      >
        {t("backToGroups")}
      </Button>

      {/* Header */}
      <Card style={{ marginBottom: 18 }}>
        <div className="row between wrap gap-4">
          <div className="row gap-3" style={{ minWidth: 0 }}>
            <div
              style={{
                width: 54,
                height: 54,
                borderRadius: 16,
                background: `linear-gradient(135deg, oklch(0.76 0.13 ${hue}), oklch(0.64 0.17 ${hue}))`,
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Icon name="users" size={26} />
            </div>

            {editingName ? (
              <div className="row gap-2 wrap">
                <input
                  value={nameVal}
                  onChange={(e) => setNameVal(e.target.value)}
                  autoFocus
                  style={{ ...inp, width: 220 }}
                />
                <Button
                  size="sm"
                  disabled={!nameVal.trim() || rename.isPending}
                  onClick={() => rename.mutate()}
                >
                  {rename.isPending ? "…" : t("saveName")}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setEditingName(false)}>
                  {t("cancel")}
                </Button>
              </div>
            ) : (
              <div className="col" style={{ minWidth: 0 }}>
                <div className="row gap-2" style={{ alignItems: "center" }}>
                  <h2 style={{ fontSize: 23 }} className="truncate">
                    {ov.name}
                  </h2>
                  <button
                    type="button"
                    aria-label="rename"
                    className="tap"
                    onClick={() => {
                      setNameVal(ov.name);
                      setEditingName(true);
                    }}
                    style={{
                      border: "none",
                      background: "transparent",
                      color: "var(--faint)",
                      cursor: "pointer",
                      display: "flex",
                      padding: 2,
                    }}
                  >
                    <Icon name="edit" size={17} />
                  </button>
                </div>
                <span style={{ fontSize: 13.5, color: "var(--muted)" }}>
                  {ov.member_count} {t("members")} · {t("avgShort")}:{" "}
                  {ov.avg_band != null ? Math.round(ov.avg_band) : "—"}
                </span>
              </div>
            )}
          </div>

          <div className="row gap-3" style={{ alignItems: "center" }}>
            <Pill hue={80} icon="lock">
              {t("joinCode")}: {ov.join_code}
            </Pill>
            {!editingName && (
              <Button
                variant="ghost"
                size="sm"
                icon="trash"
                onClick={async () => {
                  if (
                    await confirm({
                      message: t("deleteGroupConfirm"),
                      destructive: true,
                    })
                  )
                    removeGroup.mutate();
                }}
                style={{ color: "var(--danger)", borderColor: "var(--line-2)" }}
              >
                {t("delete")}
              </Button>
            )}
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <SegTabs
            value={tab}
            onChange={(v) => setTab(v as "students" | "tasks")}
            tabs={[
              { id: "students", label: t("studentsTab"), icon: "users" },
              { id: "tasks", label: t("tasksTab"), icon: "book" },
            ]}
          />
        </div>
      </Card>

      {tab === "students" ? (
        <StudentsSection ov={ov} groupId={id} onChange={refresh} />
      ) : (
        <TasksSection ov={ov} groupId={id} onChange={refresh} />
      )}
    </div>
  );
}

/* ─── Students ───────────────────────────────────────────── */
function StudentsSection({
  ov,
  groupId,
  onChange,
}: {
  ov: GroupOverview;
  groupId: string;
  onChange: () => void;
}) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const { data: allStudents } = useQuery({
    queryKey: ["manage-students"],
    queryFn: async () => (await api.get<StudentManage[]>("/users/students")).data,
    enabled: picking,
  });

  const add = useMutation({
    mutationFn: async (ids: string[]) =>
      api.post(`/groups/${groupId}/members`, { student_ids: ids }),
    onSuccess: () => {
      setPicked(new Set());
      setPicking(false);
      onChange();
    },
  });
  const remove = useMutation({
    mutationFn: async (sid: string) =>
      api.delete(`/groups/${groupId}/members/${sid}`),
    onSuccess: onChange,
  });

  const memberIds = new Set(ov.members.map((m) => m.id));
  const candidates = (allStudents ?? []).filter((s) => !memberIds.has(s.id));

  function toggle(sid: string) {
    setPicked((p) => {
      const n = new Set(p);
      n.has(sid) ? n.delete(sid) : n.add(sid);
      return n;
    });
  }

  return (
    <div className="col gap-4">
      <div>
        <Button
          variant={picking ? "ghost" : "primary"}
          icon={picking ? "x" : "plus"}
          onClick={() => {
            setPicking((p) => !p);
            setPicked(new Set());
          }}
        >
          {picking ? t("cancel") : t("addMembers")}
        </Button>
      </div>

      {picking && (
        <Card>
          {!candidates.length ? (
            <p
              style={{
                textAlign: "center",
                color: "var(--muted)",
                fontSize: 14,
                padding: "8px 0",
              }}
            >
              {t("noStudents")}
            </p>
          ) : (
            <div
              className="g2"
              style={{ maxHeight: 288, overflowY: "auto", gap: 6 }}
            >
              {candidates.map((s) => {
                const on = picked.has(s.id);
                return (
                  <label
                    key={s.id}
                    className="row gap-2 tap"
                    style={{
                      cursor: "pointer",
                      padding: "10px 12px",
                      borderRadius: "var(--r-sm)",
                      border: on
                        ? "2px solid var(--primary)"
                        : "2px solid var(--line)",
                      background: on ? "var(--primary-tint)" : "var(--surface)",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(s.id)}
                      style={{ width: 18, height: 18, accentColor: "var(--primary)" }}
                    />
                    <Avatar name={s.full_name} size={30} />
                    <span
                      className="truncate"
                      style={{ fontSize: 14.5, fontWeight: 700 }}
                    >
                      {s.full_name}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          <Button
            full
            icon="check"
            style={{ marginTop: 12 }}
            disabled={picked.size === 0 || add.isPending}
            onClick={() => add.mutate([...picked])}
          >
            {add.isPending ? t("saving") : `${t("addMembers")} (${picked.size})`}
          </Button>
        </Card>
      )}

      {!ov.members.length ? (
        <Card style={{ textAlign: "center" }}>
          <span style={{ color: "var(--muted)", fontSize: 15 }}>
            {t("noStudents")}
          </span>
        </Card>
      ) : (
        <Card pad={0}>
          {ov.members.map((m, i) => (
            <div
              key={m.id}
              className="row gap-3"
              style={{
                padding: "13px 20px",
                borderBottom:
                  i < ov.members.length - 1 ? "1px solid var(--line)" : "none",
              }}
            >
              <Avatar name={m.full_name} size={40} />
              <div className="col grow" style={{ minWidth: 0 }}>
                <span
                  className="truncate"
                  style={{ fontWeight: 800, fontSize: 14.5 }}
                >
                  {m.full_name}
                </span>
                <span
                  className="truncate"
                  style={{ fontSize: 12.5, color: "var(--muted)" }}
                >
                  {t("tasksShort")}: {m.tasks_done}/{m.tasks_total}
                </span>
              </div>
              <Pill hue={bandColor(m.avg_band ?? 0)} size="sm">
                {m.avg_band != null ? Math.round(m.avg_band) : "—"}
              </Pill>
              <button
                type="button"
                onClick={async () => {
                  if (
                    await confirm({
                      message: t("removeStudentConfirm"),
                      destructive: true,
                    })
                  )
                    remove.mutate(m.id);
                }}
                className="tap"
                style={{
                  border: "none",
                  background: "transparent",
                  color: "var(--danger)",
                  cursor: "pointer",
                  fontSize: 12.5,
                  fontWeight: 800,
                  fontFamily: "var(--font-display)",
                }}
              >
                {t("removeMember")}
              </button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

/* ─── Tasks ──────────────────────────────────────────────── */
function TasksSection({
  ov,
  groupId,
  onChange,
}: {
  ov: GroupOverview;
  groupId: string;
  onChange: () => void;
}) {
  const { t } = useI18n();
  const [giving, setGiving] = useState(false);
  const [questionId, setQuestionId] = useState("");
  const [dueAt, setDueAt] = useState("");

  const { data: questions } = useQuery({
    queryKey: ["questions", "mine"],
    queryFn: async () => (await api.get<Question[]>("/questions")).data,
    enabled: giving,
  });

  const give = useMutation({
    mutationFn: async () =>
      api.post("/assignments", {
        question_id: questionId,
        group_id: groupId,
        due_at: dueAt ? new Date(dueAt).toISOString() : null,
      }),
    onSuccess: () => {
      setQuestionId("");
      setDueAt("");
      setGiving(false);
      onChange();
    },
  });

  return (
    <div className="col gap-4">
      <div>
        <Button
          variant={giving ? "ghost" : "primary"}
          icon={giving ? "x" : "plus"}
          onClick={() => setGiving((g) => !g)}
        >
          {giving ? t("cancel") : t("giveTask")}
        </Button>
      </div>

      {giving && (
        <Card>
          <div className="col gap-4">
            <Field label={t("pickTask")}>
              <select
                value={questionId}
                onChange={(e) => setQuestionId(e.target.value)}
                style={inp}
              >
                <option value="">—</option>
                {/* Only ASSIGNED-type, published tasks can be assigned to a group. */}
                {questions
                  ?.filter((q) => !q.is_public && q.is_published)
                  .map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.title}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label={t("dueDate")}>
              <input
                type="date"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                style={inp}
              />
            </Field>
            <Button
              full
              icon="check"
              disabled={!questionId || give.isPending}
              onClick={() => give.mutate()}
            >
              {give.isPending ? t("saving") : t("giveTask")}
            </Button>
          </div>
        </Card>
      )}

      {!ov.tasks.length ? (
        <Card style={{ textAlign: "center" }}>
          <span style={{ color: "var(--muted)", fontSize: 15 }}>
            {t("noTasksGroup")}
          </span>
        </Card>
      ) : (
        <div className="g2">
          {ov.tasks.map((tk) => (
            <TaskCard
              key={tk.question_id}
              tk={tk}
              groupId={groupId}
              onChange={onChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TaskCard({
  tk,
  groupId,
  onChange,
}: {
  tk: GroupTask;
  groupId: string;
  onChange: () => void;
}) {
  const { t } = useI18n();
  const nav = useNavigate();
  const confirm = useConfirm();
  const pct = tk.total ? (tk.done / tk.total) * 100 : 0;
  const done = tk.students.filter((s) => s.completed);
  const notYet = tk.students.filter((s) => !s.completed);

  const setDue = useMutation({
    mutationFn: async (iso: string | null) =>
      api.patch(`/groups/${groupId}/tasks/${tk.question_id}`, { due_at: iso }),
    onSuccess: onChange,
  });
  const removeTask = useMutation({
    mutationFn: async () => api.delete(`/groups/${groupId}/tasks/${tk.question_id}`),
    onSuccess: onChange,
  });

  return (
    <Card>
      <div className="row between" style={{ marginBottom: 10 }}>
        {tk.question_topic ? (
          <Pill hue={47} size="sm">
            {tk.question_topic}
          </Pill>
        ) : (
          <span />
        )}
        <button
          type="button"
          aria-label="delete-task"
          onClick={async () => {
            if (
              await confirm({
                message: t("deleteGroupTaskConfirm"),
                destructive: true,
              })
            )
              removeTask.mutate();
          }}
          className="tap"
          style={{
            border: "none",
            background: "transparent",
            color: "var(--danger)",
            cursor: "pointer",
            display: "flex",
            padding: 2,
          }}
        >
          <Icon name="trash" size={17} />
        </button>
      </div>

      <h3 style={{ fontSize: 15.5, lineHeight: 1.35, minHeight: 42 }}>
        {tk.question_title}
      </h3>

      {/* Due date — editable */}
      <div className="row gap-2" style={{ marginTop: 8, alignItems: "center" }}>
        <Icon name="calendar" size={15} style={{ color: "var(--muted)" }} />
        <span style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 700 }}>
          {t("changeDue")}:
        </span>
        <input
          type="date"
          value={tk.due_at ? new Date(tk.due_at).toISOString().slice(0, 10) : ""}
          onChange={(e) =>
            setDue.mutate(
              e.target.value ? new Date(e.target.value).toISOString() : null
            )
          }
          style={{ ...inp, width: "auto", padding: "6px 10px", fontSize: 13 }}
        />
      </div>

      {/* Progress */}
      <div className="row gap-3" style={{ marginTop: 12, alignItems: "center" }}>
        <div className="grow">
          <Bar value={pct} hue={152} />
        </div>
        <span
          style={{ fontSize: 12.5, fontWeight: 800, color: "var(--success)" }}
        >
          {tk.done}/{tk.total} {t("doneWord")}
        </span>
      </div>

      {/* Who did / didn't */}
      <div className="g2" style={{ marginTop: 14, gap: 12 }}>
        {notYet.length > 0 && (
          <div className="col gap-1">
            <span
              style={{
                fontSize: 11.5,
                fontWeight: 800,
                color: "var(--danger)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              {t("notYetWord")} ({notYet.length})
            </span>
            {notYet.map((s) => (
              <div
                key={s.student_id}
                className="row gap-2"
                style={{
                  padding: "6px 10px",
                  borderRadius: "var(--r-xs)",
                  background: "var(--surface-2)",
                }}
              >
                <Avatar name={s.full_name} size={24} />
                <span
                  className="truncate"
                  style={{ fontSize: 13.5, fontWeight: 700 }}
                >
                  {s.full_name}
                </span>
              </div>
            ))}
          </div>
        )}
        {done.length > 0 && (
          <div className="col gap-1">
            <span
              style={{
                fontSize: 11.5,
                fontWeight: 800,
                color: "var(--success)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              {t("doneWord")} ({done.length})
            </span>
            {done.map((s) => (
              <button
                key={s.student_id}
                type="button"
                onClick={() =>
                  s.submission_id && nav(`/submissions/${s.submission_id}`)
                }
                className="row gap-2 tap"
                style={{
                  padding: "6px 10px",
                  borderRadius: "var(--r-xs)",
                  background: "var(--success-tint)",
                  border: "none",
                  cursor: s.submission_id ? "pointer" : "default",
                  textAlign: "left",
                  width: "100%",
                }}
              >
                <Avatar name={s.full_name} size={24} />
                <span
                  className="truncate grow"
                  style={{ fontSize: 13.5, fontWeight: 700 }}
                >
                  {s.full_name}
                </span>
                {s.band != null && (
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 800,
                      color: "var(--success)",
                    }}
                  >
                    {Math.round(s.band)}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
