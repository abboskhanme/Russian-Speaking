import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { AudioRecorder } from "../components/AudioRecorder";
import {
  Button,
  Card,
  Icon,
  Loading,
  Logo,
  Mascot,
  Ring,
  Bar,
  bandColor,
  type IconName,
} from "../components/govori";

interface Criteria {
  pronunciation: number | null;
  stress: number | null;
  intonation: number | null;
  fluency: number | null;
  grammar: number | null;
}
interface GuestResult {
  transcript: string;
  phrase: string;
  overall: number | null;
  criteria: Criteria;
  errors: { word: string; accuracy: number; error_type: string | null }[];
  level: string;
  on_topic: boolean;
  completeness: number | null;
  scored: boolean;
}

const DEFAULT_PHRASE = "Привет! Меня зовут Антон. Я хочу учить русский язык.";

/** Public "try before signup" funnel — value first, then the CTA. */
export function GuestDemo() {
  const { t } = useI18n();
  const nav = useNavigate();
  const [phrase, setPhrase] = useState(DEFAULT_PHRASE);
  const [step, setStep] = useState<"intro" | "record" | "loading" | "result">("intro");
  const [result, setResult] = useState<GuestResult | null>(null);
  const [prevOverall, setPrevOverall] = useState<number | null>(null);
  const [improved, setImproved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Preserve the recorded blob so a failed assess can be re-sent, not re-recorded.
  const [pending, setPending] = useState<Blob | null>(null);
  // Single shared audio element so rapid taps replace playback instead of stacking.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ phrase: string }>("/guest/demo").then((r) => setPhrase(r.data.phrase)).catch(() => {});
    return () => {
      if (audioRef.current) audioRef.current.pause();
    };
  }, []);

  function playTTS(text: string) {
    // Stop whatever is currently playing before starting the new clip.
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    const a = new Audio(`/api/v1/guest/tts?text=${encodeURIComponent(text)}`);
    audioRef.current = a;
    setPlaying(text);
    a.onended = () => setPlaying((p) => (p === text ? null : p));
    a.onerror = () => setPlaying((p) => (p === text ? null : p));
    a.play().catch(() => setPlaying(null));
  }

  function onComplete(blob: Blob) {
    setPending(blob);
    void doAssess(blob);
  }

  async function doAssess(blob: Blob) {
    setStep("loading");
    setError(null);
    try {
      const { data } = await api.post<GuestResult>(
        `/guest/assess?phrase=${encodeURIComponent(phrase)}`,
        blob,
        // Use the recorder's actual container (iOS Safari records mp4, not webm).
        { headers: { "Content-Type": blob.type || "audio/webm" } },
      );
      setImproved(prevOverall != null && data.overall != null && data.overall > prevOverall);
      setPending(null);
      setResult(data);
      setStep("result");
    } catch {
      // Keep the blob in `pending` so it can be re-sent without re-recording.
      setError(t("guestNoScore"));
      setStep("record");
    }
  }

  function retry() {
    if (result?.overall != null) setPrevOverall(result.overall);
    setResult(null);
    setPending(null);
    setError(null);
    setImproved(false);
    setStep("record");
  }

  const CRIT: { key: keyof Criteria; label: string; icon: IconName }[] = [
    { key: "pronunciation", label: t("crPron"), icon: "mic" },
    { key: "stress", label: t("crStress"), icon: "target" },
    { key: "intonation", label: t("crIntonation"), icon: "chart" },
    { key: "fluency", label: t("crFluency"), icon: "speak" },
    { key: "grammar", label: t("crGrammar"), icon: "book" },
  ];

  function scoreLabel(v: number): string {
    if (v >= 85) return t("guestScoreExcellent");
    if (v >= 70) return t("guestScoreGood");
    if (v >= 55) return t("guestScoreOk");
    return t("guestScoreStart");
  }

  return (
    // #root is a fixed 100vh with body overflow hidden, so this public page must
    // scroll inside itself — otherwise a tall result gets clipped with no scroll.
    <div style={{ height: "100dvh", overflowY: "auto", background: "var(--bg)", display: "flex", flexDirection: "column" }}>
      <header className="row between" style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)", background: "var(--surface)", flexShrink: 0 }}>
        <Logo />
        <Button variant="ghost" size="sm" onClick={() => nav("/login")}>{t("login")}</Button>
      </header>

      <main style={{ flex: 1, display: "flex", justifyContent: "center", padding: "clamp(20px, 5vw, 48px) 20px" }}>
        <div style={{ width: "100%", maxWidth: 560 }} className="anim-fade-up">

          {step === "intro" && (
            <div className="col center" style={{ textAlign: "center", gap: 18 }}>
              <Mascot size={110} mood="happy" />
              <h1 style={{ fontSize: "clamp(26px, 6vw, 34px)", lineHeight: 1.2 }}>{t("guestTitle")}</h1>
              <p style={{ color: "var(--muted)", fontSize: 16, maxWidth: 420 }}>{t("guestSubtitle")}</p>
              <Button size="lg" icon="mic" onClick={() => setStep("record")}>{t("guestStartBtn")}</Button>
              <span style={{ fontSize: 13.5, color: "var(--faint)", fontWeight: 700 }}>{t("guestFreeNote")}</span>
            </div>
          )}

          {step === "record" && (
            <Card style={{ textAlign: "center" }}>
              <p style={{ fontSize: 13, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {t("guestPhraseLabel")}
              </p>
              <p style={{ fontSize: "clamp(20px, 5vw, 26px)", fontWeight: 800, fontFamily: "var(--font-display)", margin: "10px 0 6px", lineHeight: 1.3 }}>
                {phrase}
              </p>
              <Button variant="ghost" size="sm" icon={playing === phrase ? "pause" : "volume"} onClick={() => playTTS(phrase)} style={{ marginBottom: 18 }}>
                {t("guestListenSample")}
              </Button>
              {pending ? (
                /* Assess failed — recording preserved; re-send the SAME blob. */
                <div className="col center gap-3">
                  {error && <p style={{ color: "var(--danger)", fontWeight: 700, fontSize: 14 }}>{error}</p>}
                  <p style={{ fontSize: 13.5, color: "var(--muted)" }}>{t("sendKeptHint")}</p>
                  <div className="row center gap-3 wrap">
                    <Button variant="ghost" icon="mic" onClick={() => { setPending(null); setError(null); }}>
                      {t("guestRetry")}
                    </Button>
                    <Button icon="refresh" onClick={() => doAssess(pending)}>
                      {t("retrySend")}
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <AudioRecorder maxSeconds={30} onComplete={onComplete} />
                  {error && <p style={{ marginTop: 14, color: "var(--danger)", fontWeight: 700, fontSize: 14 }}>{error}</p>}
                </>
              )}
            </Card>
          )}

          {step === "loading" && (
            <div className="col center gap-3" style={{ padding: "60px 0" }}>
              <Loading />
              <p style={{ fontSize: 15.5, fontWeight: 800, color: "var(--primary-press)" }}>{t("guestAnalyzing")}</p>
            </div>
          )}

          {step === "result" && result && !(result.scored && result.on_topic && result.overall != null) && (
            // Different phrase / meaningless / unscored → don't celebrate; ask to
            // say the shown phrase (with the correct audio to copy) and retry.
            <Card style={{ textAlign: "center" }}>
              <Mascot size={90} mood="thinking" float={false} />
              <p style={{ color: "var(--ink-soft)", fontSize: 15.5, fontWeight: 700, marginTop: 10 }}>
                {result.on_topic ? t("guestNoScore") : t("guestOffTopic")}
              </p>
              {result.transcript && (
                <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 6 }}>
                  {t("guestYouSaid")}: <span style={{ fontStyle: "italic" }}>«{result.transcript}»</span>
                </p>
              )}
              <div className="row center gap-3 wrap" style={{ marginTop: 18 }}>
                <Button variant="soft" icon={playing === result.phrase ? "pause" : "headphones"} onClick={() => playTTS(result.phrase)}>
                  {t("guestListenSample")}
                </Button>
                <Button icon="refresh" onClick={retry}>{t("guestRetry")}</Button>
              </div>
            </Card>
          )}

          {step === "result" && result && result.scored && result.on_topic && result.overall != null && (
            <div className="col gap-4">
              <>
                  {/* Hero score */}
                  {(() => {
                    const hue = bandColor(result.overall!);
                    return (
                      <Card pad={0} style={{ overflow: "hidden", textAlign: "center" }}>
                        <div style={{ padding: "28px 24px 24px", background: `linear-gradient(160deg, oklch(0.96 0.05 ${hue}), var(--surface))` }}>
                          {improved && (
                            <div className="row center" style={{ marginBottom: 14 }}>
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--success)", color: "#fff", fontWeight: 800, fontSize: 13, padding: "5px 12px", borderRadius: 999 }}>
                                <Icon name="flame" size={14} /> {t("guestImproved")}
                              </span>
                            </div>
                          )}
                          <Ring value={result.overall!} size={132} sw={13} hue={hue}>
                            <div className="col center" style={{ gap: 0 }}>
                              <span style={{ fontFamily: "var(--font-display)", fontWeight: 900, fontSize: 44, color: `oklch(0.48 0.16 ${hue})`, lineHeight: 1 }}>
                                {result.overall}
                              </span>
                              <span style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)" }}>/ 100</span>
                            </div>
                          </Ring>
                          <h2 style={{ fontSize: 22, marginTop: 14 }}>{scoreLabel(result.overall!)}</h2>
                          {result.transcript && (
                            <p style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 6 }}>
                              {t("guestYouSaid")}: <span style={{ fontStyle: "italic", color: "var(--ink-soft)" }}>«{result.transcript}»</span>
                            </p>
                          )}
                        </div>
                      </Card>
                    );
                  })()}

                  {/* Criteria */}
                  <Card>
                    <div className="col gap-3">
                      {CRIT.map((c) => {
                        const v = result.criteria[c.key];
                        const hue = v != null ? bandColor(v) : 47;
                        return (
                          <div key={c.key} className="row gap-3" style={{ alignItems: "center" }}>
                            <span style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: `oklch(0.95 0.05 ${hue})`, color: `oklch(0.5 0.15 ${hue})` }}>
                              <Icon name={c.icon} size={17} />
                            </span>
                            <div className="col grow" style={{ gap: 5, minWidth: 0 }}>
                              <div className="row between">
                                <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--ink-soft)" }}>{c.label}</span>
                                <span style={{ fontSize: 14, fontWeight: 900, fontFamily: "var(--font-display)", color: v != null ? `oklch(0.5 0.15 ${hue})` : "var(--faint)" }}>
                                  {v != null ? `${v}%` : "—"}
                                </span>
                              </div>
                              <Bar value={v ?? 0} hue={hue} height={7} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Card>
              </>

              {/* Weakest words */}
              {result.errors.length > 0 && (
                <Card>
                  <p style={{ fontSize: 12.5, fontWeight: 800, color: "var(--danger)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 12 }}>
                    {t("guestErrorsTitle")}
                  </p>
                  <div className="row gap-2 wrap">
                    {result.errors.map((e, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => playTTS(e.word)}
                        className="tap row gap-2"
                        style={{
                          alignItems: "center", padding: "9px 13px", cursor: "pointer",
                          borderRadius: 999, border: "1.5px solid var(--line-2)", background: "var(--surface-2)",
                        }}
                      >
                        <Icon name={playing === e.word ? "pause" : "volume"} size={15} style={{ color: "var(--primary-press)" }} />
                        <span style={{ fontSize: 15, fontWeight: 800 }}>{e.word}</span>
                        <span style={{ fontSize: 12, fontWeight: 800, color: `oklch(0.55 0.15 ${bandColor(e.accuracy)})` }}>{e.accuracy}%</span>
                      </button>
                    ))}
                  </div>
                </Card>
              )}

              {/* Actions */}
              <div className="row gap-3 wrap" style={{ justifyContent: "center" }}>
                <Button variant="soft" icon={playing === result.phrase ? "pause" : "headphones"} onClick={() => playTTS(result.phrase)}>
                  {t("guestHearCorrect")}
                </Button>
                <Button variant="ghost" icon="refresh" onClick={retry}>{t("guestRetry")}</Button>
              </div>

              {/* Level + course + soft CTA */}
              <Card style={{ background: "linear-gradient(135deg, oklch(0.96 0.04 285), var(--surface))" }}>
                <div className="col center" style={{ textAlign: "center", gap: 4 }}>
                  <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 700 }}>{t("guestLevelLabel")}</span>
                  <span style={{ fontSize: 34, fontWeight: 900, fontFamily: "var(--font-display)", color: "var(--grape)", lineHeight: 1.1 }}>{result.level}</span>
                  <span style={{ fontSize: 14, color: "var(--ink-soft)", fontWeight: 700, marginTop: 4 }}>{t("guestCourse")}</span>
                </div>
                <div className="col gap-2" style={{ marginTop: 18 }}>
                  <Button full size="lg" icon="star" onClick={() => nav("/register")}>{t("guestUnlockFull")}</Button>
                  <Button full variant="ghost" onClick={() => nav("/register")}>{t("guestContinueFree")}</Button>
                </div>
              </Card>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
