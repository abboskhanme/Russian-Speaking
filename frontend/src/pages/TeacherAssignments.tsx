import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import type { Assignment, Group, Question, StudentManage } from "../lib/types";
import {
  Avatar,
  Bar,
  Button,
  Card,
  EmptyState,
  Field,
  Icon,
  Loading,
  PageHead,
  Pill,
  bandColor,
  inp,
} from "../components/govori";

export function TeacherAssignments() {
  const { t } = useI18n();
  const nav = useNavigate();
  const qc = useQueryClient();

  const [creating, setCreating] = useState(false);
  const [questionId, setQuestionId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dueAt, setDueAt] = useState("");

  const { data: assignments, isLoading } = useQuery({
    queryKey: ["teacher-assignments"],
    queryFn: async () => (await api.get<Assignment[]>("/assignments")).data,
  });
  const { data: questions } = useQuery({
    queryKey: ["questions", "mine"],
    queryFn: async () => (await api.get<Question[]>("/questions")).data,
  });
  const { data: students } = useQuery({
    queryKey: ["manage-students"],
    queryFn: async () => (await api.get<StudentManage[]>("/users/students")).data,
  });
  const { data: groups } = useQuery({
    queryKey: ["teacher-groups"],
    queryFn: async () => (await api.get<Group[]>("/groups")).data,
  });

  const create = useMutation({
    mutationFn: async () =>
      api.post("/assignments", {
        question_id: questionId,
        student_ids: [...selected],
        group_id: groupId || null,
        due_at: dueAt ? new Date(dueAt).toISOString() : null,
      }),
    onSuccess: () => {
      setQuestionId("");
      setGroupId("");
      setSelected(new Set());
      setDueAt("");
      setCreating(false);
      qc.invalidateQueries({ queryKey: ["teacher-assignments"] });
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => api.delete(`/assignments/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["teacher-assignments"] }),
  });

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const canSubmit = questionId && (selected.size > 0 || groupId) && !create.isPending;

  return (
    <div className="focus-wrap">
      <PageHead
        title={t("assignmentsTitle")}
        sub={t("newAssignment")}
        action={
          <Button
            icon={creating ? "x" : "plus"}
            variant={creating ? "ghost" : "primary"}
            onClick={() => setCreating((c) => !c)}
          >
            {creating ? t("cancel") : t("newAssignment")}
          </Button>
        }
      />

      {/* New assignment */}
      {creating && (
        <Card style={{ marginBottom: 20 }}>
          <div className="col gap-4">
            <Field label={t("selectQuestion")}>
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

            <Field label={t("assignToGroup")}>
              <select
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
                style={inp}
              >
                <option value="">—</option>
                {groups?.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g.member_count})
                  </option>
                ))}
              </select>
            </Field>

            <Field label={t("selectStudents")}>
              <div
                className="g2"
                style={{ maxHeight: 208, overflowY: "auto", gap: 6 }}
              >
                {students?.map((s) => {
                  const on = selected.has(s.id);
                  return (
                    <label
                      key={s.id}
                      className="row gap-2 tap"
                      style={{
                        cursor: "pointer",
                        padding: "9px 12px",
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
                        style={{
                          width: 18,
                          height: 18,
                          accentColor: "var(--primary)",
                        }}
                      />
                      <Avatar name={s.full_name} size={28} />
                      <span
                        className="truncate"
                        style={{ fontSize: 14, fontWeight: 700 }}
                      >
                        {s.full_name}
                      </span>
                    </label>
                  );
                })}
              </div>
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
              disabled={!canSubmit}
              onClick={() => create.mutate()}
            >
              {create.isPending ? t("saving") : t("assign")}
            </Button>
          </div>
        </Card>
      )}

      {/* Existing assignments */}
      {isLoading ? (
        <Loading />
      ) : !assignments?.length ? (
        <EmptyState text={t("noAssignments")} />
      ) : (
        <div className="g3">
          {assignments.map((a) => (
            <Card key={a.id} hover>
              <div className="row between" style={{ marginBottom: 12 }}>
                {a.question_topic ? (
                  <Pill hue={47} size="sm">
                    {a.question_topic}
                  </Pill>
                ) : (
                  <span />
                )}
                {a.due_at && (
                  <span
                    className="row gap-1"
                    style={{ fontSize: 12, color: "var(--muted)" }}
                  >
                    <Icon name="calendar" size={14} />
                    {new Date(a.due_at).toLocaleDateString()}
                  </span>
                )}
              </div>

              <div className="row gap-3" style={{ marginBottom: 12 }}>
                <Avatar name={a.student_name ?? "?"} size={38} />
                <div className="col grow" style={{ minWidth: 0 }}>
                  <span
                    className="truncate"
                    style={{ fontWeight: 800, fontSize: 14.5 }}
                  >
                    {a.student_name}
                  </span>
                  <span
                    className="truncate"
                    style={{ fontSize: 12.5, color: "var(--muted)" }}
                  >
                    {a.question_title}
                  </span>
                </div>
              </div>

              <Bar value={a.completed ? 100 : 0} hue={a.completed ? 152 : 47} />

              <div className="row between" style={{ marginTop: 10 }}>
                {a.completed ? (
                  <button
                    type="button"
                    onClick={() =>
                      a.submission_id && nav(`/submissions/${a.submission_id}`)
                    }
                    className="tap"
                    style={{
                      border: "none",
                      background: "transparent",
                      padding: 0,
                      cursor: a.submission_id ? "pointer" : "default",
                    }}
                  >
                    <Pill
                      hue={bandColor(a.overall_band ?? 70)}
                      size="sm"
                      icon="check"
                    >
                      {a.overall_band != null ? Math.round(a.overall_band) : "✓"}
                    </Pill>
                  </button>
                ) : (
                  <Pill hue={28} size="sm">
                    {t("notCompleted")}
                  </Pill>
                )}
                <button
                  type="button"
                  aria-label="delete"
                  onClick={() => del.mutate(a.id)}
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
                  <Icon name="trash" size={16} />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
