import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import type { Question, QuestionBlock, RuStyle } from "../lib/types";

function move<T>(arr: T[], from: number, to: number): T[] {
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
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
} from "../components/govori";

function styleLabel(t: (k: any) => string, s: RuStyle | null) {
  return s === "regular" ? t("ruRegular") : s === "live" ? t("ruLive") : null;
}

/** Expanded view of one block: its questions + a picker to add more. */
function BlockBody({ block }: { block: QuestionBlock }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [picking, setPicking] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());

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
    // `addable` is derived from this list's cached block_id — refetch it so a
    // just-removed question can be re-added and a just-added one disappears.
    qc.invalidateQueries({ queryKey: ["questions", "mine"] });
  };

  const add = useMutation({
    mutationFn: async () => api.post(`/blocks/${block.id}/questions`, { question_ids: [...sel] }),
    onSuccess: () => {
      setSel(new Set());
      setPicking(false);
      invalidate();
    },
  });
  const remove = useMutation({
    mutationFn: async (qid: string) => api.delete(`/blocks/${block.id}/questions/${qid}`),
    onSuccess: invalidate,
  });
  const reorder = useMutation({
    mutationFn: async (ids: string[]) => api.post(`/blocks/${block.id}/tasks/reorder`, { ids }),
  });

  // Local, drag-reorderable copy of the block's questions.
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
      {/* Current questions */}
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
                <span className="truncate" style={{ fontSize: 14, fontWeight: 600 }}>{q.title}</span>
              </div>
              <button
                type="button"
                aria-label="remove"
                onClick={() => remove.mutate(q.id)}
                className="tap"
                style={{ border: "none", background: "transparent", color: "var(--danger)", cursor: "pointer", display: "flex" }}
              >
                <Icon name="x" size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      {!picking ? (
        <Button variant="soft" size="sm" icon="plus" onClick={() => setPicking(true)}>
          {t("addQuestions")}
        </Button>
      ) : (
        <div className="col gap-2">
          <div className="g2" style={{ maxHeight: 220, overflowY: "auto", gap: 6 }}>
            {addable.map((q) => {
              const on = sel.has(q.id);
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
    </div>
  );
}

export function TeacherBlocks() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [ruStyle, setRuStyle] = useState<"" | RuStyle>("");
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: blocks, isLoading } = useQuery({
    queryKey: ["blocks"],
    queryFn: async () => (await api.get<QuestionBlock[]>("/blocks")).data,
  });

  const create = useMutation({
    mutationFn: async () =>
      api.post("/blocks", { name: name.trim(), ru_style: ruStyle || null }),
    onSuccess: () => {
      setName("");
      setRuStyle("");
      setCreating(false);
      qc.invalidateQueries({ queryKey: ["blocks"] });
    },
  });
  const del = useMutation({
    mutationFn: async (id: string) => api.delete(`/blocks/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["blocks"] }),
  });
  const reorderMods = useMutation({
    mutationFn: async (ids: string[]) => api.post("/blocks/reorder", { ids }),
  });

  // Local, drag-reorderable copy of the modules.
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
        sub={t("blocksHint")}
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
            <Field label={t("ruStyle")}>
              <select value={ruStyle} onChange={(e) => setRuStyle(e.target.value as "" | RuStyle)} style={inp}>
                <option value="">—</option>
                <option value="regular">{t("ruRegular")}</option>
                <option value="live">{t("ruLive")}</option>
              </select>
            </Field>
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
                      style={{ cursor: "grab", display: "flex", color: "var(--muted)", padding: "2px 2px 2px 0" }}
                      title={t("reorderHint")}
                    >
                      <Icon name="menu" size={18} />
                    </span>
                    <button
                      type="button"
                      onClick={() => setOpenId(open ? null : b.id)}
                      className="tap"
                      style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", flex: 1, textAlign: "left" }}
                    >
                      <div className="row gap-2 wrap" style={{ alignItems: "center" }}>
                        <Icon name="chevD" size={18} style={{ color: "var(--muted)", transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
                        <span style={{ fontSize: 16, fontWeight: 800 }}>{b.name}</span>
                        {sl && <Pill hue={305} size="sm">{sl}</Pill>}
                        <Pill hue={47} size="sm">{b.question_count} {t("blockQuestionsCount")}</Pill>
                      </div>
                    </button>
                    <button
                      type="button"
                      aria-label="delete"
                      onClick={() => del.mutate(b.id)}
                      className="tap"
                      style={{ border: "none", background: "transparent", color: "var(--danger)", cursor: "pointer", display: "flex", padding: 2 }}
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
