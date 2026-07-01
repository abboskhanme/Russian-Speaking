import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import type { Group, Question, StudentManage } from "../lib/types";
import {
  Avatar,
  Button,
  Card,
  Field,
  Icon,
  PageHead,
  inp,
} from "../components/govori";

export function TeacherReview() {
  const { t } = useI18n();
  const [groupId, setGroupId] = useState("");
  const [students, setStudents] = useState<Set<string>>(new Set());
  const [questions, setQuestions] = useState<Set<string>>(new Set());
  const [done, setDone] = useState(false);

  const { data: qList } = useQuery({
    queryKey: ["questions", "mine"],
    queryFn: async () => (await api.get<Question[]>("/questions")).data,
  });
  const { data: studentList } = useQuery({
    queryKey: ["manage-students"],
    queryFn: async () => (await api.get<StudentManage[]>("/users/students")).data,
  });
  const { data: groups } = useQuery({
    queryKey: ["teacher-groups"],
    queryFn: async () => (await api.get<Group[]>("/groups")).data,
  });

  const create = useMutation({
    mutationFn: async () =>
      api.post("/review", {
        question_ids: [...questions],
        student_ids: [...students],
        group_id: groupId || null,
      }),
    onSuccess: () => {
      setQuestions(new Set());
      setStudents(new Set());
      setGroupId("");
      setDone(true);
      setTimeout(() => setDone(false), 2500);
    },
  });

  const toggle = (set: (updater: (prev: Set<string>) => Set<string>) => void, id: string) =>
    set((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const canSubmit = questions.size > 0 && (students.size > 0 || groupId) && !create.isPending;

  return (
    <div className="focus-wrap">
      <PageHead title={t("navTeacherReview")} sub={t("addReviewHint")} />

      <Card>
        <div className="col gap-4">
          {/* Questions */}
          <Field label={t("selectQuestion")}>
            <div className="g2" style={{ maxHeight: 220, overflowY: "auto", gap: 6 }}>
              {qList?.map((q) => {
                const on = questions.has(q.id);
                return (
                  <label
                    key={q.id}
                    className="row gap-2 tap"
                    style={{
                      cursor: "pointer",
                      padding: "9px 12px",
                      borderRadius: "var(--r-sm)",
                      border: on ? "2px solid var(--primary)" : "2px solid var(--line)",
                      background: on ? "var(--primary-tint)" : "var(--surface)",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(setQuestions, q.id)}
                      style={{ width: 17, height: 17, accentColor: "var(--primary)" }}
                    />
                    <span className="truncate" style={{ fontSize: 13.5, fontWeight: 600 }}>{q.title}</span>
                  </label>
                );
              })}
            </div>
          </Field>

          {/* Group */}
          <Field label={t("wholeGroup")}>
            <select value={groupId} onChange={(e) => setGroupId(e.target.value)} style={inp}>
              <option value="">—</option>
              {groups?.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.member_count})
                </option>
              ))}
            </select>
          </Field>

          {/* Students */}
          <Field label={t("selectStudents")}>
            <div className="g2" style={{ maxHeight: 208, overflowY: "auto", gap: 6 }}>
              {studentList?.map((s) => {
                const on = students.has(s.id);
                return (
                  <label
                    key={s.id}
                    className="row gap-2 tap"
                    style={{
                      cursor: "pointer",
                      padding: "9px 12px",
                      borderRadius: "var(--r-sm)",
                      border: on ? "2px solid var(--primary)" : "2px solid var(--line)",
                      background: on ? "var(--primary-tint)" : "var(--surface)",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(setStudents, s.id)}
                      style={{ width: 18, height: 18, accentColor: "var(--primary)" }}
                    />
                    <Avatar name={s.full_name} size={28} />
                    <span className="truncate" style={{ fontSize: 14, fontWeight: 700 }}>{s.full_name}</span>
                  </label>
                );
              })}
            </div>
          </Field>

          <div className="row gap-3" style={{ alignItems: "center" }}>
            <Button full icon="check" disabled={!canSubmit} onClick={() => create.mutate()}>
              {create.isPending ? t("saving") : t("addToReview")}
            </Button>
            {done && (
              <span className="row gap-1" style={{ fontSize: 14, fontWeight: 800, color: "var(--success)", whiteSpace: "nowrap" }}>
                <Icon name="check" size={16} sw={3} />
                {t("reviewAdded")}
              </span>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
