import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { stripHtml } from "../components/RichTextEditor";
import type { Block, BlockRegister, Question } from "../lib/types";
import { Card, Button, Pill, Icon, PageHead, Loading, EmptyState, Field, inp } from "../components/govori";

const LEVELS = ["", "A1", "A2", "B1", "B2", "C1", "C2"];
const REGISTERS: BlockRegister[] = ["obychnyy", "zhivoy"];

function move<T>(arr: T[], from: number, to: number): T[] {
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function TeacherBlocks() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const nav = useNavigate();

  const [register, setRegister] = useState<BlockRegister>("obychnyy");
  const [name, setName] = useState("");
  const [level, setLevel] = useState("");
  const [description, setDescription] = useState("");

  const regLabel: Record<BlockRegister, string> = {
    obychnyy: t("regObychnyy"),
    zhivoy: t("regZhivoy"),
  };

  const { data: blocks, isLoading } = useQuery({
    queryKey: ["blocks"],
    queryFn: async () => (await api.get<Block[]>("/blocks")).data,
  });
  const { data: questions } = useQuery({
    queryKey: ["questions", "teacher-all"],
    queryFn: async () => (await api.get<Question[]>("/questions")).data,
  });

  // Local, drag-reorderable copies synced from the server.
  const [mods, setMods] = useState<Block[]>([]);
  const [tasksBy, setTasksBy] = useState<Record<string, Question[]>>({});
  useEffect(() => {
    if (blocks) setMods(blocks);
  }, [blocks]);
  useEffect(() => {
    if (!questions) return;
    const by: Record<string, Question[]> = {};
    for (const q of questions) {
      if (!q.block_id) continue;
      (by[q.block_id] ??= []).push(q);
    }
    for (const k of Object.keys(by)) by[k].sort((a, b) => a.sort_order - b.sort_order);
    setTasksBy(by);
  }, [questions]);

  const create = useMutation({
    mutationFn: async () =>
      (await api.post<Block>("/blocks", {
        register,
        name: name.trim(),
        level: level || null,
        description: description.trim() || null,
      })).data,
    onSuccess: () => {
      setName("");
      setDescription("");
      qc.invalidateQueries({ queryKey: ["blocks"] });
    },
  });
  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/blocks/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["blocks"] });
      qc.invalidateQueries({ queryKey: ["questions", "teacher-all"] });
    },
  });
  const reorderMods = useMutation({
    mutationFn: async (ids: string[]) => api.post("/blocks/reorder", { ids }),
  });
  const reorderTasks = useMutation({
    mutationFn: async ({ block, ids }: { block: string; ids: string[] }) =>
      api.post(`/blocks/${block}/tasks/reorder`, { ids }),
  });
  const addExisting = useMutation({
    mutationFn: async ({ block, ids }: { block: string; ids: string[] }) =>
      api.post(`/blocks/${block}/questions`, { question_ids: ids }),
    onSuccess: () => {
      setPickerFor(null);
      setPicked(new Set());
      qc.invalidateQueries({ queryKey: ["blocks"] });
      qc.invalidateQueries({ queryKey: ["questions", "teacher-all"] });
    },
  });

  // "Add existing task" picker
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const candidates = (questions ?? []).filter((q) => q.block_id !== pickerFor);
  const modName = (id: string | null) => mods.find((m) => m.id === id)?.name;

  // Drag state
  const [dragMod, setDragMod] = useState<number | null>(null);
  const [dragTask, setDragTask] = useState<{ block: string; idx: number } | null>(null);

  function dropMod(to: number) {
    if (dragMod === null || dragMod === to) return;
    const next = move(mods, dragMod, to);
    setMods(next);
    setDragMod(null);
    reorderMods.mutate(next.map((m) => m.id));
  }
  function dropTask(block: string, to: number) {
    if (!dragTask || dragTask.block !== block || dragTask.idx === to) {
      setDragTask(null);
      return;
    }
    const next = move(tasksBy[block] ?? [], dragTask.idx, to);
    setTasksBy((prev) => ({ ...prev, [block]: next }));
    setDragTask(null);
    reorderTasks.mutate({ block, ids: next.map((q) => q.id) });
  }

  return (
    <div className="focus-wrap anim-fade-up">
      <PageHead title={t("blocks")} sub={t("reorderHint")} />

      {/* Create a module */}
      <Card style={{ marginBottom: 20 }}>
        <form
          className="col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <div className="row gap-3 wrap">
            <Field label={t("blockField")}>
              <select value={register} onChange={(e) => setRegister(e.target.value as BlockRegister)} style={inp}>
                {REGISTERS.map((r) => (
                  <option key={r} value={r}>{regLabel[r]}</option>
                ))}
              </select>
            </Field>
            <Field label={t("levelCefr")}>
              <select value={level} onChange={(e) => setLevel(e.target.value)} style={inp}>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>{l || "—"}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label={t("blockName")}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("blockNamePh")} style={inp} />
          </Field>
          <Field label={t("blockDesc")}>
            <input value={description} onChange={(e) => setDescription(e.target.value)} style={inp} />
          </Field>
          <Button type="submit" icon="plus" disabled={!name.trim() || create.isPending}>
            {t("createBlock")}
          </Button>
        </form>
      </Card>

      {isLoading ? (
        <Loading />
      ) : !mods.length ? (
        <EmptyState text={t("noBlocks")} />
      ) : (
        <div className="col gap-3">
          {mods.map((b, mi) => {
            const hue = b.register === "zhivoy" ? 305 : 152;
            const tasks = tasksBy[b.id] ?? [];
            return (
              <div
                key={b.id}
                style={{
                  overflow: "hidden",
                  opacity: dragMod === mi ? 0.5 : 1,
                  background: "var(--surface)",
                  border: "1px solid var(--line)",
                  borderRadius: "var(--r-md)",
                  boxShadow: "var(--sh-sm)",
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => dropMod(mi)}
              >
                {/* Module header (drag source for module reordering) */}
                <div
                  draggable
                  onDragStart={() => setDragMod(mi)}
                  onDragEnd={() => setDragMod(null)}
                  className="row between"
                  style={{ padding: "14px 16px", background: `oklch(0.97 0.03 ${hue})`, gap: 12, cursor: "grab" }}
                >
                  <div className="row gap-3" style={{ alignItems: "center", minWidth: 0 }}>
                    <Icon name="menu" size={18} style={{ color: "var(--muted)", flexShrink: 0 }} />
                    <div
                      style={{
                        width: 40, height: 40, borderRadius: 11, flexShrink: 0,
                        background: `oklch(0.9 0.07 ${hue})`, color: `oklch(0.45 0.15 ${hue})`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}
                    >
                      <Icon name="layers" size={20} />
                    </div>
                    <div className="col" style={{ minWidth: 0 }}>
                      <span style={{ fontWeight: 800, fontSize: 16 }}>{b.name}</span>
                      <span style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 700 }}>
                        {regLabel[b.register]} · {tasks.length} {t("tasksInBlock")}
                      </span>
                    </div>
                  </div>
                  <div className="row gap-2" style={{ alignItems: "center" }}>
                    {b.level && <Pill hue={hue} size="sm">{b.level}</Pill>}
                    <button
                      type="button"
                      onClick={() => remove.mutate(b.id)}
                      className="tap"
                      style={{ border: "none", background: "transparent", color: "var(--muted)", cursor: "pointer", padding: 6 }}
                    >
                      <Icon name="trash" size={17} />
                    </button>
                  </div>
                </div>

                {/* Tasks in this module (each is a drag source for task reordering) */}
                <div className="col" style={{ padding: 8 }}>
                  {tasks.map((q, ti) => (
                    <div
                      key={q.id}
                      draggable
                      onDragStart={(e) => { e.stopPropagation(); setDragTask({ block: b.id, idx: ti }); }}
                      onDragEnd={() => setDragTask(null)}
                      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      onDrop={(e) => { e.stopPropagation(); dropTask(b.id, ti); }}
                      className="row between"
                      style={{
                        padding: "10px 10px", gap: 10, borderRadius: "var(--r-sm)", cursor: "grab",
                        background: dragTask?.block === b.id && dragTask.idx === ti ? "var(--surface-2)" : "transparent",
                      }}
                    >
                      <div className="row gap-2" style={{ alignItems: "center", minWidth: 0 }}>
                        <Icon name="menu" size={16} style={{ color: "var(--faint)", flexShrink: 0 }} />
                        <span style={{ fontWeight: 700, fontSize: 14.5 }} className="truncate">{q.title}</span>
                        {!q.is_published && <Pill hue={47} size="sm">{t("draft")}</Pill>}
                      </div>
                      <button
                        type="button"
                        onClick={() => nav(`/teacher/questions/${q.id}/edit`)}
                        className="tap"
                        style={{ border: "none", background: "transparent", color: "var(--muted)", cursor: "pointer", padding: 6, flexShrink: 0 }}
                        title={stripHtml(q.prompt_text).slice(0, 80)}
                      >
                        <Icon name="edit" size={16} />
                      </button>
                    </div>
                  ))}
                  <div className="row gap-2 wrap" style={{ marginTop: 4 }}>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="plus"
                      onClick={() => nav(`/teacher/questions/new?block=${b.id}`)}
                    >
                      {t("addTaskToModule")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="layers"
                      onClick={() => { setPickerFor(b.id); setPicked(new Set()); }}
                    >
                      {t("addExistingTask")}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add-existing-task picker modal */}
      {pickerFor && (
        <div
          onClick={() => setPickerFor(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 200,
            background: "oklch(0.30 0.02 60 / 0.45)", backdropFilter: "blur(2px)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="anim-pop col gap-3"
            style={{
              background: "var(--surface)", borderRadius: "var(--r-lg)", boxShadow: "var(--sh-lg)",
              width: "100%", maxWidth: 560, maxHeight: "82vh", padding: "22px 24px", overflow: "hidden",
            }}
          >
            <div className="row between">
              <h2 className="row gap-2" style={{ fontSize: 19 }}>
                <Icon name="layers" size={20} style={{ color: "var(--primary)" }} />
                {t("addExistingTask")}
              </h2>
              <button
                type="button"
                onClick={() => setPickerFor(null)}
                className="tap"
                style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)" }}
              >
                <Icon name="x" size={22} />
              </button>
            </div>

            {candidates.length === 0 ? (
              <p style={{ fontSize: 14, color: "var(--muted)", padding: "8px 2px" }}>{t("noTasksToAdd")}</p>
            ) : (
              <div className="col gap-1" style={{ overflowY: "auto", flex: 1 }}>
                {candidates.map((q) => {
                  const on = picked.has(q.id);
                  return (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() =>
                        setPicked((prev) => {
                          const n = new Set(prev);
                          n.has(q.id) ? n.delete(q.id) : n.add(q.id);
                          return n;
                        })
                      }
                      className="tap row between"
                      style={{
                        gap: 10, padding: "11px 12px", borderRadius: "var(--r-sm)", textAlign: "left",
                        border: "1px solid", borderColor: on ? "var(--primary)" : "var(--line)",
                        background: on ? "var(--primary-tint)" : "var(--surface)", cursor: "pointer",
                      }}
                    >
                      <div className="col" style={{ minWidth: 0 }}>
                        <span className="truncate" style={{ fontWeight: 700, fontSize: 14.5 }}>{q.title}</span>
                        {q.block_id && (
                          <span style={{ fontSize: 12, color: "var(--muted)" }}>
                            {t("blockField")}: {modName(q.block_id) ?? "—"}
                          </span>
                        )}
                      </div>
                      <Icon
                        name={on ? "check" : "plus"}
                        size={18}
                        style={{ color: on ? "var(--primary-press)" : "var(--faint)", flexShrink: 0 }}
                      />
                    </button>
                  );
                })}
              </div>
            )}

            <Button
              icon="plus"
              disabled={picked.size === 0 || addExisting.isPending}
              onClick={() => addExisting.mutate({ block: pickerFor, ids: [...picked] })}
            >
              {t("addSelected")} {picked.size ? `(${picked.size})` : ""}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
