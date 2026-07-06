import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, uploadToPresigned } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import type { ModuleStudentProgress, Question, QuestionBlock, RuStyle } from "../lib/types";
import {
  Button,
  Card,
  EmptyState,
  Field,
  Icon,
  Loading,
  PageHead,
  Pill,
  inp,
  type IconName,
} from "../components/govori";

function move<T>(arr: T[], from: number, to: number): T[] {
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

const TYPE_ICON: Record<string, IconName> = { text: "message", image: "eye", video: "play" };

function styleLabel(t: (k: any) => string, s: RuStyle | null) {
  return s === "regular" ? t("ruRegular") : s === "live" ? t("ruLive") : null;
}

/** The return path new/edit task screens send the teacher back to. */
const RETURN = encodeURIComponent("/teacher/blocks");

/** Expanded view of one module: its tasks (create/edit/publish/reorder inline) + progress. */
function BlockBody({ block }: { block: QuestionBlock }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [picking, setPicking] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [showProg, setShowProg] = useState(false);

  const { data: prog, isLoading: progLoading } = useQuery({
    queryKey: ["block-progress", block.id],
    enabled: showProg,
    queryFn: async () =>
      (await api.get<ModuleStudentProgress[]>(`/blocks/${block.id}/progress`)).data,
  });

  const { data: inBlock } = useQuery({
    queryKey: ["block-questions", block.id],
    queryFn: async () => (await api.get<Question[]>(`/blocks/${block.id}/questions`)).data,
  });
  const { data: mine } = useQuery({
    queryKey: ["questions", "mine"],
    queryFn: async () => (await api.get<Question[]>("/questions")).data,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["block-questions", block.id] });
    qc.invalidateQueries({ queryKey: ["blocks"] });
    qc.invalidateQueries({ queryKey: ["questions", "mine"] });
  };

  const add = useMutation({
    mutationFn: async () => api.post(`/blocks/${block.id}/questions`, { question_ids: [...sel] }),
    onSuccess: () => { setSel(new Set()); setPicking(false); invalidate(); },
  });
  const remove = useMutation({
    mutationFn: async (qid: string) => api.delete(`/blocks/${block.id}/questions/${qid}`),
    onSuccess: invalidate,
  });
  const togglePublish = useMutation({
    mutationFn: async (q: Question) =>
      api.patch(`/questions/${q.id}`, { is_published: !q.is_published }),
    onSuccess: invalidate,
  });
  const reorder = useMutation({
    mutationFn: async (ids: string[]) => api.post(`/blocks/${block.id}/tasks/reorder`, { ids }),
  });

  // Cover image upload (presigned PUT straight to storage).
  const coverInput = useRef<HTMLInputElement | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  async function uploadCover(f: File | null) {
    if (coverInput.current) coverInput.current.value = "";
    if (!f) return;
    setCoverBusy(true);
    try {
      const ct = f.type || "image/jpeg";
      const { data: up } = await api.post(`/blocks/${block.id}/cover-url`, { content_type: ct });
      await uploadToPresigned(up.upload_url, f, ct);
      qc.invalidateQueries({ queryKey: ["blocks"] });
    } finally {
      setCoverBusy(false);
    }
  }

  // Local, drag-reorderable copy of the module's tasks.
  const [tasks, setTasks] = useState<Question[]>([]);
  useEffect(() => { if (inBlock) setTasks(inBlock); }, [inBlock]);
  const [dragT, setDragT] = useState<number | null>(null);
  function dropT(to: number) {
    if (dragT === null || dragT === to) { setDragT(null); return; }
    const next = move(tasks, dragT, to);
    setTasks(next);
    setDragT(null);
    reorder.mutate(next.map((q) => q.id));
  }

  const addable = (mine ?? []).filter((q) => q.block_id !== block.id);

  return (
    <div className="col gap-3" style={{ marginTop: 12 }}>
      {tasks.length === 0 ? (
        <p style={{ fontSize: 13.5, color: "var(--muted)" }}>{t("blockNoQuestions")}</p>
      ) : (
        <div className="col gap-2">
          {tasks.map((q, ti) => (
            <div
              key={q.id}
              draggable
              onDragStart={() => setDragT(ti)}
              onDragEnd={() => setDragT(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => dropT(ti)}
              className="row between gap-2"
              style={{
                padding: "9px 12px", borderRadius: "var(--r-sm)", cursor: "grab",
                background: dragT === ti ? "var(--primary-tint)" : "var(--surface-2)",
              }}
            >
              <div className="row gap-2" style={{ alignItems: "center", minWidth: 0 }}>
                <Icon name="menu" size={15} style={{ color: "var(--faint)", flexShrink: 0 }} />
                <span style={{ color: "var(--muted)", display: "flex", flexShrink: 0 }}>
                  <Icon name={TYPE_ICON[q.type] ?? "message"} size={15} />
                </span>
                <span className="truncate" style={{ fontSize: 14, fontWeight: 600 }}>{q.title}</span>
                {!q.is_published && <Pill hue={40} size="sm">{t("moduleDraft")}</Pill>}
              </div>
              <div className="row gap-1" style={{ flexShrink: 0 }}>
                <button
                  type="button"
                  aria-label="publish"
                  title={q.is_published ? t("modulePublished") : t("moduleDraft")}
                  onClick={() => togglePublish.mutate(q)}
                  className="tap"
                  style={{ border: "none", background: "transparent", color: q.is_published ? "var(--success)" : "var(--faint)", cursor: "pointer", display: "flex", padding: 3 }}
                >
                  <Icon name={q.is_published ? "eye" : "eyeOff"} size={16} />
                </button>
                <button
                  type="button"
                  aria-label="edit"
                  onClick={() => nav(`/teacher/questions/${q.id}/edit?return=${RETURN}`)}
                  className="tap"
                  style={{ border: "none", background: "transparent", color: "var(--muted)", cursor: "pointer", display: "flex", padding: 3 }}
                >
                  <Icon name="edit" size={16} />
                </button>
                <button
                  type="button"
                  aria-label="remove"
                  onClick={() => remove.mutate(q.id)}
                  className="tap"
                  style={{ border: "none", background: "transparent", color: "var(--danger)", cursor: "pointer", display: "flex", padding: 3 }}
                >
                  <Icon name="x" size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create a task directly inside this module (Upcoder-style), or attach existing. */}
      <div className="row gap-2 wrap">
        <Button
          size="sm"
          icon="plus"
          onClick={() => nav(`/teacher/questions/new?block=${block.id}&return=${RETURN}`)}
        >
          {t("createTaskInline")}
        </Button>
        {!picking && (
          <Button variant="soft" size="sm" icon="link" onClick={() => setPicking(true)}>
            {t("addExisting")}
          </Button>
        )}
        <input
          ref={coverInput}
          type="file"
          accept="image/*"
          onChange={(e) => uploadCover(e.target.files?.[0] ?? null)}
          style={{ display: "none" }}
        />
        <Button variant="ghost" size="sm" icon="image" disabled={coverBusy} onClick={() => coverInput.current?.click()}>
          {coverBusy ? t("saving") : t("uploadCover")}
        </Button>
      </div>

      {picking && (
        <div className="col gap-2">
          {addable.length === 0 && (
            <p style={{ fontSize: 13, color: "var(--muted)" }}>{t("noAddableTasks")}</p>
          )}
          <div className="g2" style={{ maxHeight: 220, overflowY: "auto", gap: 6 }}>
            {addable.map((q) => {
              const on = sel.has(q.id);
              return (
                <label
                  key={q.id}
                  className="row gap-2 tap"
                  style={{
                    cursor: "pointer", padding: "9px 12px", borderRadius: "var(--r-sm)",
                    border: on ? "2px solid var(--primary)" : "2px solid var(--line)",
                    background: on ? "var(--primary-tint)" : "var(--surface)",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      setSel((p) => {
                        const n = new Set(p);
                        n.has(q.id) ? n.delete(q.id) : n.add(q.id);
                        return n;
                      })
                    }
                    style={{ width: 17, height: 17, accentColor: "var(--primary)" }}
                  />
                  <span className="truncate" style={{ fontSize: 13.5, fontWeight: 600 }}>{q.title}</span>
                </label>
              );
            })}
          </div>
          <div className="row gap-2">
            <Button size="sm" icon="check" disabled={!sel.size || add.isPending} onClick={() => add.mutate()}>
              {add.isPending ? t("saving") : t("addQuestions")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setPicking(false); setSel(new Set()); }}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      )}

      {/* Per-student progress through this module */}
      <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12, marginTop: 2 }}>
        <Button variant="ghost" size="sm" icon="chart" onClick={() => setShowProg((v) => !v)}>
          {t("studentProgress")}
        </Button>
        {showProg &&
          (progLoading ? (
            <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 8 }}>…</p>
          ) : !prog?.length ? (
            <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 8 }}>{t("noStudents")}</p>
          ) : (
            <div className="col gap-2" style={{ marginTop: 10 }}>
              {prog.map((p) => (
                <div
                  key={p.student_id}
                  className="row between gap-3"
                  style={{ padding: "9px 12px", borderRadius: "var(--r-sm)", background: "var(--surface-2)" }}
                >
                  <div className="col" style={{ minWidth: 0 }}>
                    <span className="truncate" style={{ fontSize: 14, fontWeight: 700 }}>{p.full_name}</span>
                    <span className="truncate" style={{ fontSize: 12, color: "var(--muted)" }}>
                      {p.current_task_title ? `${t("currentTask")}: ${p.current_task_title}` : t("moduleFinished")}
                    </span>
                  </div>
                  <div className="col" style={{ alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 800 }}>{p.done_count}/{p.total}</span>
                    <div style={{ width: 90, height: 6, borderRadius: 999, background: "var(--surface)", overflow: "hidden" }}>
                      <div style={{ width: `${p.percent}%`, height: "100%", background: "var(--primary)", borderRadius: 999 }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
      </div>
    </div>
  );
}

export function TeacherBlocks() {
  const { t } = useI18n();
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = user?.role === "admin";
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [ruStyle, setRuStyle] = useState<"" | RuStyle>("");
  // Admins can create official PUBLIC modules; teachers always create group ones.
  const [visibility, setVisibility] = useState<"group" | "public">("group");
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: blocks, isLoading } = useQuery({
    queryKey: ["blocks"],
    queryFn: async () => (await api.get<QuestionBlock[]>("/blocks")).data,
  });

  const create = useMutation({
    mutationFn: async () =>
      api.post("/blocks", {
        name: name.trim(),
        ru_style: ruStyle || null,
        visibility: isAdmin ? visibility : "group",
      }),
    onSuccess: () => {
      setName(""); setRuStyle(""); setVisibility("group"); setCreating(false);
      qc.invalidateQueries({ queryKey: ["blocks"] });
    },
  });
  const del = useMutation({
    mutationFn: async (id: string) => api.delete(`/blocks/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["blocks"] }),
  });
  const togglePublish = useMutation({
    mutationFn: async (b: QuestionBlock) =>
      api.patch(`/blocks/${b.id}`, { is_published: !b.is_published }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["blocks"] }),
  });
  const reorderMods = useMutation({
    mutationFn: async (ids: string[]) => api.post("/blocks/reorder", { ids }),
  });

  const [mods, setMods] = useState<QuestionBlock[]>([]);
  useEffect(() => { if (blocks) setMods(blocks); }, [blocks]);
  const [dragMod, setDragMod] = useState<number | null>(null);
  function dropMod(to: number) {
    if (dragMod === null || dragMod === to) { setDragMod(null); return; }
    const next = move(mods, dragMod, to);
    setMods(next);
    setDragMod(null);
    reorderMods.mutate(next.map((m) => m.id));
  }

  return (
    <div className="focus-wrap">
      <PageHead
        title={t("blocksTitle")}
        sub={t("moduleContentHint")}
        action={
          <Button
            icon={creating ? "x" : "plus"}
            variant={creating ? "ghost" : "primary"}
            onClick={() => setCreating((c) => !c)}
          >
            {creating ? t("cancel") : t("blockNew")}
          </Button>
        }
      />

      {creating && (
        <Card style={{ marginBottom: 20 }}>
          <div className="col gap-4">
            <Field label={t("blockName")}>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("blockNamePh")} style={inp} />
            </Field>
            <div className="g2">
              <Field label={t("ruStyle")}>
                <select value={ruStyle} onChange={(e) => setRuStyle(e.target.value as "" | RuStyle)} style={inp}>
                  <option value="">—</option>
                  <option value="regular">{t("ruRegular")}</option>
                  <option value="live">{t("ruLive")}</option>
                </select>
              </Field>
              {isAdmin && (
                <Field label={t("visibilityLabel")}>
                  <select value={visibility} onChange={(e) => setVisibility(e.target.value as "group" | "public")} style={inp}>
                    <option value="public">{t("visOfficial")}</option>
                    <option value="group">{t("visGroup")}</option>
                  </select>
                </Field>
              )}
            </div>
            <Button full icon="check" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? t("saving") : t("blockNew")}
            </Button>
          </div>
        </Card>
      )}

      {isLoading ? (
        <Loading />
      ) : !mods.length ? (
        <EmptyState text={t("blockEmpty")} />
      ) : (
        <div className="col gap-3">
          {mods.map((b, mi) => {
            const open = openId === b.id;
            const sl = styleLabel(t, b.ru_style);
            return (
              <div
                key={b.id}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => dropMod(mi)}
                style={{ opacity: dragMod === mi ? 0.5 : 1 }}
              >
                <Card>
                  <div className="row between gap-3">
                    <span
                      draggable
                      onDragStart={() => setDragMod(mi)}
                      onDragEnd={() => setDragMod(null)}
                      className="tap"
                      style={{ cursor: "grab", display: "flex", color: "var(--muted)", padding: "2px 2px 2px 0", alignSelf: "center" }}
                      title={t("reorderHint")}
                    >
                      <Icon name="menu" size={18} />
                    </span>
                    {/* Cover thumbnail (Upcoder-style) */}
                    <div
                      style={{
                        width: 46, height: 46, borderRadius: 10, flexShrink: 0, overflow: "hidden",
                        background: "var(--surface-3)", display: "flex", alignItems: "center", justifyContent: "center",
                        color: "var(--faint)", alignSelf: "center",
                      }}
                    >
                      {b.cover_url ? (
                        <img src={b.cover_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <Icon name="image" size={20} />
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setOpenId(open ? null : b.id)}
                      className="tap"
                      style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", flex: 1, textAlign: "left", minWidth: 0 }}
                    >
                      <div className="row gap-2 wrap" style={{ alignItems: "center" }}>
                        <Icon name="chevD" size={18} style={{ color: "var(--muted)", transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
                        <span style={{ fontSize: 16, fontWeight: 800 }}>{b.name}</span>
                        {b.visibility === "public" && <Pill hue={152} size="sm">{t("visOfficial")}</Pill>}
                        {sl && <Pill hue={305} size="sm">{sl}</Pill>}
                        <Pill hue={47} size="sm">{b.question_count} {t("blockQuestionsCount")}</Pill>
                        {!b.is_published && <Pill hue={40} size="sm">{t("moduleDraft")}</Pill>}
                      </div>
                    </button>
                    <button
                      type="button"
                      aria-label="publish"
                      title={b.is_published ? t("modulePublished") : t("moduleDraft")}
                      onClick={() => togglePublish.mutate(b)}
                      className="tap"
                      style={{ border: "none", background: "transparent", color: b.is_published ? "var(--success)" : "var(--faint)", cursor: "pointer", display: "flex", padding: 3, alignSelf: "center" }}
                    >
                      <Icon name={b.is_published ? "eye" : "eyeOff"} size={17} />
                    </button>
                    <button
                      type="button"
                      aria-label="delete"
                      onClick={() => del.mutate(b.id)}
                      className="tap"
                      style={{ border: "none", background: "transparent", color: "var(--danger)", cursor: "pointer", display: "flex", padding: 3, alignSelf: "center" }}
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                  {open && <BlockBody block={b} />}
                </Card>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
