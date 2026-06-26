import { useState } from "react";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { Button, Icon } from "./govori";

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
const TYPES: { id: string; key: "typeText" | "typeImage" | "typeVideo" }[] = [
  { id: "text", key: "typeText" },
  { id: "image", key: "typeImage" },
  { id: "video", key: "typeVideo" },
];
const MAX_CELLS = 10;
const MAX_TOTAL = 150;

export interface GenerateResult {
  created: number;
  skipped_no_media: number;
}

/** Chip toggle used for levels / types / topic suggestions. */
function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="tap"
      style={{
        padding: "7px 13px",
        borderRadius: "var(--r-pill)",
        border: `1.5px solid ${on ? "var(--primary)" : "var(--line-2)"}`,
        background: on ? "var(--primary-tint)" : "var(--surface)",
        color: on ? "var(--primary-press)" : "var(--ink-soft)",
        fontFamily: "var(--font-display)",
        fontWeight: 800,
        fontSize: 13.5,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

export function GenerateQuestionsModal({
  open,
  onClose,
  existingTopics,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  existingTopics: string[];
  onDone: (r: GenerateResult) => void;
}) {
  const { t } = useI18n();
  const [levels, setLevels] = useState<string[]>(["B1"]);
  const [types, setTypes] = useState<string[]>(["text"]);
  const [topicsText, setTopicsText] = useState("");
  const [count, setCount] = useState(5);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const topics = [...new Set(topicsText.split(",").map((s) => s.trim()).filter(Boolean))];
  const cells = levels.length * topics.length * types.length;
  const total = cells * count;
  const mediaSelected = types.includes("image") || types.includes("video");

  const toggle = (arr: string[], set: (v: string[]) => void, v: string) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  // Clicking a suggestion chip toggles it: add if missing, remove if already
  // chosen — so deselecting doesn't mean hand-editing the text field.
  const toggleTopic = (tp: string) => {
    const next = topics.includes(tp) ? topics.filter((x) => x !== tp) : [...topics, tp];
    setTopicsText(next.join(", "));
  };

  async function run() {
    if (!levels.length) return setError(t("genNeedLevel"));
    if (!topics.length) return setError(t("genNeedTopic"));
    if (!types.length) return setError(t("genNeedType"));
    if (cells > MAX_CELLS) return setError(t("genTooManyCells").replace("{n}", String(MAX_CELLS)));
    if (total > MAX_TOTAL) return setError(t("genTooMany").replace("{n}", String(MAX_TOTAL)));
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post<GenerateResult>("/questions/generate", {
        levels,
        topics,
        types,
        count_per_cell: count,
        custom_instructions: custom.trim() || undefined,
      });
      onDone(data);
      onClose();
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      // AI quota exhausted / upstream unavailable → tell them it's a server-side
      // problem, not their input.
      setError(status === 429 || status === 503 || (status ?? 0) >= 500 ? t("serverError") : t("genError"));
    } finally {
      setBusy(false);
    }
  }

  const sectionLabel = (s: string) => (
    <span style={{ fontSize: 13, fontWeight: 800, color: "var(--ink-soft)" }}>{s}</span>
  );

  return (
    <div
      onClick={busy ? undefined : onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "oklch(0.30 0.02 60 / 0.45)", backdropFilter: "blur(2px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="anim-pop"
        style={{
          background: "var(--surface)", borderRadius: "var(--r-lg)", boxShadow: "var(--sh-lg)",
          width: "100%", maxWidth: 560, maxHeight: "90vh", overflowY: "auto", padding: "24px 26px",
        }}
      >
        <div className="row between" style={{ marginBottom: 4 }}>
          <h2 className="row gap-2" style={{ fontSize: 21 }}>
            <Icon name="sparkles" size={22} style={{ color: "var(--primary)" }} />
            {t("genTitle")}
          </h2>
          <button onClick={onClose} className="tap" style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)" }}>
            <Icon name="x" size={22} />
          </button>
        </div>
        <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 18 }}>{t("genSubtitle")}</p>

        {/* Levels */}
        <div className="col gap-2" style={{ marginBottom: 16 }}>
          {sectionLabel(t("genLevels"))}
          <div className="row gap-2 wrap">
            {LEVELS.map((l) => (
              <Chip key={l} on={levels.includes(l)} onClick={() => toggle(levels, setLevels, l)}>{l}</Chip>
            ))}
          </div>
        </div>

        {/* Types */}
        <div className="col gap-2" style={{ marginBottom: 16 }}>
          {sectionLabel(t("genTypes"))}
          <div className="row gap-2 wrap">
            {TYPES.map((ty) => (
              <Chip key={ty.id} on={types.includes(ty.id)} onClick={() => toggle(types, setTypes, ty.id)}>
                {t(ty.key)}
              </Chip>
            ))}
          </div>
          {mediaSelected && (
            <span style={{ fontSize: 12, color: "var(--warn)" }}>{t("genMediaNote")}</span>
          )}
        </div>

        {/* Topics */}
        <div className="col gap-2" style={{ marginBottom: 16 }}>
          {sectionLabel(t("genTopics"))}
          <input
            value={topicsText}
            onChange={(e) => setTopicsText(e.target.value)}
            placeholder={t("genTopicsPh")}
            style={{
              border: "1.5px solid var(--line-2)", borderRadius: "var(--r-sm)",
              padding: "11px 13px", fontSize: 14.5, fontFamily: "inherit", outline: "none", width: "100%",
            }}
          />
          {existingTopics.length > 0 && (
            <div className="row gap-2 wrap" style={{ marginTop: 2 }}>
              {existingTopics.slice(0, 12).map((tp) => (
                <Chip key={tp} on={topics.includes(tp)} onClick={() => toggleTopic(tp)}>{tp}</Chip>
              ))}
            </div>
          )}
        </div>

        {/* Count per cell */}
        <div className="col gap-2" style={{ marginBottom: 16 }}>
          {sectionLabel(t("genCount"))}
          <input
            type="number" min={1} max={50} value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
            style={{
              border: "1.5px solid var(--line-2)", borderRadius: "var(--r-sm)",
              padding: "11px 13px", fontSize: 14.5, fontFamily: "inherit", outline: "none", width: 120,
            }}
          />
        </div>

        {/* Custom instructions — free-text guidance for the AI */}
        <div className="col gap-2" style={{ marginBottom: 16 }}>
          {sectionLabel(t("genCustom"))}
          <textarea
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder={t("genCustomPh")}
            rows={3}
            maxLength={2000}
            style={{
              border: "1.5px solid var(--line-2)", borderRadius: "var(--r-sm)",
              padding: "11px 13px", fontSize: 14.5, fontFamily: "inherit", outline: "none",
              width: "100%", resize: "vertical", lineHeight: 1.5,
            }}
          />
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("genCustomHint")}</span>
        </div>

        {/* Total summary */}
        <div
          className="row between"
          style={{ background: "var(--surface-2)", borderRadius: "var(--r-sm)", padding: "11px 14px", marginBottom: 16 }}
        >
          <span style={{ fontSize: 13.5, color: "var(--ink-soft)", fontWeight: 700 }}>{t("genTotalLabel")}</span>
          <span style={{ fontSize: 15, fontWeight: 800, color: total > MAX_TOTAL || cells > MAX_CELLS ? "var(--danger)" : "var(--primary-press)", fontFamily: "var(--font-display)" }}>
            {total} {t("genTotalUnit")}
          </span>
        </div>

        {error && (
          <p style={{ color: "var(--danger)", fontSize: 13.5, fontWeight: 700, marginBottom: 12 }}>{error}</p>
        )}

        <div className="row gap-3 between">
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t("cancel")}</Button>
          <Button icon="sparkles" onClick={run} disabled={busy}>
            {busy ? t("genRunning") : t("genRun")}
          </Button>
        </div>
        {busy && (
          <p style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 10, textAlign: "center" }}>{t("genWait")}</p>
        )}
      </div>
    </div>
  );
}
