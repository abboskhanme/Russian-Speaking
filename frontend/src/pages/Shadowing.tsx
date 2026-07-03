import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, uploadToPresigned } from "../lib/api";
import { friendlyError } from "../lib/errors";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import type { Submission } from "../lib/types";
import { AudioRecorder } from "../components/AudioRecorder";
import {
  Card,
  Button,
  Pill,
  Icon,
  Waveform,
  SectionTitle,
  PageHead,
  Loading,
} from "../components/govori";

// Difficulty bands, in display order. Must match the backend SHADOW_LEVELS.
const LEVELS = ["A1–A2", "B1–B2", "C1"];

interface Phrase {
  id: string;
  text: string;
  level: string;
}

function speak(text: string): void {
  const synth = window.speechSynthesis;
  if (!synth) return;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ru-RU";
  u.rate = 0.92;
  const ruVoice = synth.getVoices().find((v) => v.lang?.toLowerCase().startsWith("ru"));
  if (ruVoice) u.voice = ruVoice;
  synth.speak(u);
}

export function Shadowing() {
  const { t } = useI18n();
  const { user } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const ttsAvailable = typeof window !== "undefined" && "speechSynthesis" in window;
  const canManage = user?.role === "teacher" || user?.role === "admin";

  const { data: phrases, isLoading } = useQuery({
    queryKey: ["shadow-phrases"],
    queryFn: async () => (await api.get<Phrase[]>("/shadowing/phrases")).data,
  });

  // Group the flat list by level band, known bands first.
  const groups = useMemo(() => {
    const map = new Map<string, Phrase[]>();
    for (const p of phrases ?? []) {
      (map.get(p.level) ?? map.set(p.level, []).get(p.level)!).push(p);
    }
    const levels = [
      ...LEVELS.filter((l) => map.has(l)),
      ...[...map.keys()].filter((l) => !LEVELS.includes(l)),
    ];
    return levels.map((level) => ({ level, items: map.get(level)! }));
  }, [phrases]);

  const [groupIdx, setGroupIdx] = useState(0);
  const [phrase, setPhrase] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Teacher/admin: add a new sentence (via modal).
  const [showAdd, setShowAdd] = useState(false);
  const [newText, setNewText] = useState("");
  const [newLevel, setNewLevel] = useState(LEVELS[0]);
  const addMut = useMutation({
    mutationFn: (body: { text: string; level: string }) => api.post("/shadowing/phrases", body),
    onSuccess: () => {
      setNewText("");
      setShowAdd(false);
      qc.invalidateQueries({ queryKey: ["shadow-phrases"] });
    },
  });
  const delMut = useMutation({
    mutationFn: (id: string) => api.delete(`/shadowing/phrases/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shadow-phrases"] }),
  });

  const group = groups.length ? groups[Math.min(groupIdx, groups.length - 1)] : undefined;
  // Keep the selection valid as data / tabs change; default to the first item.
  const activePhrase =
    phrase && group?.items.some((i) => i.text === phrase) ? phrase : group?.items[0]?.text ?? "";
  const recorderKey = useMemo(() => activePhrase, [activePhrase]); // remount per phrase

  async function handleComplete(blob: Blob, durationSec: number) {
    setUploading(true);
    setError(null);
    try {
      const { data: up } = await api.post("/submissions/shadow/upload-url", {
        content_type: "audio/webm",
      });
      await uploadToPresigned(up.upload_url, blob, "audio/webm");
      const { data: sub } = await api.post<Submission>("/submissions/shadow", {
        audio_key: up.audio_key,
        reference_text: activePhrase,
        audio_duration_sec: durationSec,
      });
      nav(`/submissions/${sub.id}`);
    } catch (e) {
      // 5xx / rate-limit → calm "server problem"; anything else → send error.
      setError(friendlyError(e, t, t("sendError")));
      setUploading(false);
    }
  }

  function handleListen() {
    speak(activePhrase);
    setSpeaking(true);
    window.setTimeout(() => setSpeaking(false), 1800);
  }

  if (uploading || isLoading) return <Loading full />;

  return (
    <div className="col gap-5 focus-wrap">
      <PageHead title={t("shadowTitle")} sub={t("shadowIntro")} />

      <div className="split">
        {/* Phrase list */}
        <Card>
          <SectionTitle
            action={
              groups.length > 1 ? (
                <div className="row gap-1" style={{ background: "var(--surface-2)", borderRadius: "var(--r-pill)", padding: 4 }}>
                  {groups.map((g, i) => {
                    const active = i === Math.min(groupIdx, groups.length - 1);
                    return (
                      <button
                        key={g.level}
                        onClick={() => {
                          setGroupIdx(i);
                          setPhrase(g.items[0]?.text ?? "");
                        }}
                        className="tap"
                        style={{
                          padding: "5px 11px",
                          borderRadius: "var(--r-pill)",
                          border: "none",
                          fontSize: 12.5,
                          fontWeight: 800,
                          fontFamily: "var(--font-display)",
                          cursor: "pointer",
                          background: active ? "var(--surface)" : "transparent",
                          color: active ? "var(--primary-press)" : "var(--muted)",
                          boxShadow: active ? "var(--sh-sm)" : "none",
                        }}
                      >
                        {g.level}
                      </button>
                    );
                  })}
                </div>
              ) : undefined
            }
          >
            {t("shadowTarget")}
          </SectionTitle>

          {/* Teacher/admin: open the add-sentence modal */}
          {canManage && (
            <Button
              full
              variant="soft"
              icon="plus"
              onClick={() => setShowAdd(true)}
              style={{ marginBottom: 14 }}
            >
              {t("shadowAddTitle")}
            </Button>
          )}

          {!group || group.items.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: 14, padding: "8px 2px" }}>
              {t("shadowNoPhrases")}
            </p>
          ) : (
            <div className="col gap-2">
              {group.items.map((p) => {
                const active = p.text === activePhrase;
                return (
                  <div
                    key={p.id}
                    onClick={() => setPhrase(p.text)}
                    className="tap"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: 13,
                      borderRadius: "var(--r-sm)",
                      textAlign: "left",
                      border: "1px solid",
                      borderColor: active ? "oklch(0.78 0.12 80)" : "var(--line)",
                      background: active ? "var(--amber-tint)" : "var(--surface)",
                      cursor: "pointer",
                    }}
                  >
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 10,
                        background: "var(--surface-2)",
                        color: "var(--ink-soft)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <Icon name="headphones" size={18} />
                    </div>
                    <span className="grow truncate" style={{ fontWeight: 700, fontSize: 14 }}>
                      {p.text}
                    </span>
                    {canManage && (
                      <button
                        type="button"
                        title={t("shadowDeleteConfirm")}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm(t("shadowDeleteConfirm"))) delMut.mutate(p.id);
                        }}
                        className="tap"
                        style={{
                          flexShrink: 0,
                          width: 28,
                          height: 28,
                          borderRadius: 8,
                          border: "none",
                          background: "transparent",
                          color: "var(--muted)",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Icon name="trash" size={16} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Practice */}
        {activePhrase ? (
          <Card style={{ textAlign: "center" }}>
            <Pill hue={80} icon="volume">
              {t("shadowResult")}
            </Pill>
            <h2 style={{ fontSize: "clamp(18px, 5vw, 24px)", marginTop: 16, lineHeight: 1.3 }}>{activePhrase}</h2>

            <div style={{ margin: "22px 0" }}>
              <Waveform active={speaking} />
            </div>

            {ttsAvailable && (
              <Button variant="soft" icon="play" onClick={handleListen} style={{ margin: "0 auto" }}>
                {t("shadowListen")}
              </Button>
            )}

            <div style={{ marginTop: 22, textAlign: "left" }}>
              <p
                className="row gap-2"
                style={{
                  justifyContent: "center",
                  marginBottom: 12,
                  fontSize: 14,
                  fontWeight: 700,
                  color: "var(--muted)",
                }}
              >
                <Icon name="mic" size={16} />
                {t("shadowRepeat")}
              </p>
              <AudioRecorder key={recorderKey} maxSeconds={30} onComplete={handleComplete} />
            </div>

            {error && (
              <p style={{ marginTop: 12, fontSize: 14, fontWeight: 700, color: "var(--danger)" }}>
                {error}
              </p>
            )}
          </Card>
        ) : (
          <Card style={{ textAlign: "center", color: "var(--muted)" }}>{t("shadowNoPhrases")}</Card>
        )}
      </div>

      {/* Add-sentence modal (teacher/admin) */}
      {canManage && showAdd && (
        <div
          onClick={addMut.isPending ? undefined : () => setShowAdd(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 200,
            background: "oklch(0.30 0.02 60 / 0.45)",
            backdropFilter: "blur(2px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              const text = newText.trim();
              if (text) addMut.mutate({ text, level: newLevel });
            }}
            className="anim-pop col gap-3"
            style={{
              background: "var(--surface)",
              borderRadius: "var(--r-lg)",
              boxShadow: "var(--sh-lg)",
              width: "100%",
              maxWidth: 460,
              padding: "22px 24px",
            }}
          >
            <div className="row between">
              <h2 className="row gap-2" style={{ fontSize: 20 }}>
                <Icon name="plus" size={20} style={{ color: "var(--primary)" }} />
                {t("shadowAddTitle")}
              </h2>
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="tap"
                style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)" }}
              >
                <Icon name="x" size={22} />
              </button>
            </div>

            <textarea
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              placeholder={t("shadowAddPlaceholder")}
              lang="ru"
              autoFocus
              rows={3}
              style={{
                width: "100%",
                padding: "12px 13px",
                borderRadius: "var(--r-sm)",
                border: "1px solid var(--line)",
                background: "var(--surface)",
                fontSize: 15,
                resize: "vertical",
                fontFamily: "inherit",
              }}
            />

            <div className="row between gap-2">
              <select
                value={newLevel}
                onChange={(e) => setNewLevel(e.target.value)}
                style={{
                  padding: "10px 12px",
                  borderRadius: "var(--r-sm)",
                  border: "1px solid var(--line)",
                  background: "var(--surface)",
                  fontSize: 14,
                  fontWeight: 700,
                }}
              >
                {LEVELS.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
              <Button type="submit" icon="plus" disabled={!newText.trim() || addMut.isPending}>
                {t("shadowAdd")}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
