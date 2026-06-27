import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, uploadToPresigned } from "../lib/api";
import { friendlyError } from "../lib/errors";
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

// Curated target sentences grouped by difficulty. Kept client-side for v1 —
// shadowing needs no teacher content model.
const PHRASES: { level: string; items: string[] }[] = [
  {
    level: "A1–A2",
    items: [
      "Привет! Меня зовут Анна.",
      "Сегодня хорошая погода.",
      "Я люблю читать книги.",
      "Где находится библиотека?",
      "Мне нравится русская музыка.",
    ],
  },
  {
    level: "B1–B2",
    items: [
      "Вчера я ходил в кино с друзьями.",
      "Мне кажется, что это очень интересный вопрос.",
      "Если будет время, я обязательно тебе позвоню.",
      "Этот город известен своей красивой архитектурой.",
    ],
  },
  {
    level: "C1",
    items: [
      "Несмотря на трудности, мы продолжали работать над проектом.",
      "Чем больше я узнаю, тем больше понимаю, как мало знаю.",
    ],
  },
];

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
  const nav = useNavigate();
  const ttsAvailable = typeof window !== "undefined" && "speechSynthesis" in window;

  const [groupIdx, setGroupIdx] = useState(0);
  const [phrase, setPhrase] = useState(PHRASES[0].items[0]);
  const [uploading, setUploading] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const group = PHRASES[groupIdx];
  const recorderKey = useMemo(() => phrase, [phrase]); // remount recorder per phrase

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
        reference_text: phrase,
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
    speak(phrase);
    setSpeaking(true);
    window.setTimeout(() => setSpeaking(false), 1800);
  }

  if (uploading) return <Loading full />;

  return (
    <div className="col gap-5 focus-wrap">
      <PageHead title={t("shadowTitle")} sub={t("shadowIntro")} />

      <div className="split">
        {/* Phrase list */}
        <Card>
          <SectionTitle
            action={
              <div className="row gap-1" style={{ background: "var(--surface-2)", borderRadius: "var(--r-pill)", padding: 4 }}>
                {PHRASES.map((g, i) => {
                  const active = i === groupIdx;
                  return (
                    <button
                      key={g.level}
                      onClick={() => {
                        setGroupIdx(i);
                        setPhrase(g.items[0]);
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
            }
          >
            {t("shadowTarget")}
          </SectionTitle>
          <div className="col gap-2">
            {group.items.map((p) => {
              const active = p === phrase;
              return (
                <button
                  key={p}
                  onClick={() => setPhrase(p)}
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
                    {p}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>

        {/* Practice */}
        <Card style={{ textAlign: "center" }}>
          <Pill hue={80} icon="volume">
            {t("shadowResult")}
          </Pill>
          <h2 style={{ fontSize: "clamp(18px, 5vw, 24px)", marginTop: 16, lineHeight: 1.3 }}>{phrase}</h2>

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
      </div>
    </div>
  );
}
