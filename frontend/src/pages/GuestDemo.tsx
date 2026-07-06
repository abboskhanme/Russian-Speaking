import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { AudioRecorder } from "../components/AudioRecorder";
import { Button, Card, Icon, Loading, Logo, Mascot, Ring, Bar, bandColor } from "../components/govori";

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

  useEffect(() => {
    api.get<{ phrase: string }>("/guest/demo").then((r) => setPhrase(r.data.phrase)).catch(() => {});
  }, []);

  function playTTS(text: string) {
    const a = new Audio(`/api/v1/guest/tts?text=${encodeURIComponent(text)}`);
    a.play().catch(() => {});
  }

  async function onComplete(blob: Blob) {
    setStep("loading");
    setError(null);
    try {
      const { data } = await api.post<GuestResult>("/guest/assess", blob, {
        headers: { "Content-Type": "audio/webm" },
      });
      setImproved(prevOverall != null && data.overall != null && data.overall > prevOverall);
      setResult(data);
      setStep("result");
    } catch {
      setError(t("guestNoScore"));
      setStep("record");
    }
  }

  function retry() {
    if (result?.overall != null) setPrevOverall(result.overall);
    setResult(null);
    setImproved(false);
    setStep("record");
  }

  const CRIT: { key: keyof Criteria; label: string }[] = [
    { key: "pronunciation", label: t("crPron") },
    { key: "stress", label: t("crStress") },
    { key: "intonation", label: t("crIntonation") },
    { key: "fluency", label: t("crFluency") },
    { key: "grammar", label: t("crGrammar") },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", flexDirection: "column" }}>
      {/* Top bar */}
      <header className="row between" style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)", background: "var(--surface)" }}>
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
              <Button variant="ghost" size="sm" icon="play" onClick={() => playTTS(phrase)} style={{ marginBottom: 18 }}>
                {t("guestListenSample")}
              </Button>
              <AudioRecorder maxSeconds={30} onComplete={onComplete} />
              {error && <p style={{ marginTop: 14, color: "var(--danger)", fontWeight: 700, fontSize: 14 }}>{error}</p>}
            </Card>
          )}

          {step === "loading" && (
            <div className="col center gap-3" style={{ padding: "60px 0" }}>
              <Loading />
              <p style={{ fontSize: 15.5, fontWeight: 800, color: "var(--primary-press)" }}>{t("guestAnalyzing")}</p>
            </div>
          )}

          {step === "result" && result && (
            <div className="col gap-4">
              {improved && (
                <Card style={{ background: "var(--success-tint)", borderColor: "var(--success)", textAlign: "center" }}>
                  <span style={{ fontWeight: 800, fontFamily: "var(--font-display)", fontSize: 17, color: "var(--success)" }}>
                    {t("guestImproved")}
                  </span>
                </Card>
              )}

              <Card style={{ textAlign: "center" }}>
                <p style={{ fontSize: 13, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 14 }}>
                  {t("guestYourResult")}
                </p>
                {result.scored && result.overall != null ? (
                  <>
                    <div className="row center" style={{ marginBottom: 8 }}>
                      <Ring value={result.overall} size={120} sw={12} hue={bandColor(result.overall)}>
                        <span style={{ fontFamily: "var(--font-display)", fontWeight: 900, fontSize: 40, color: `oklch(0.5 0.15 ${bandColor(result.overall)})`, lineHeight: 1 }}>
                          {result.overall}
                        </span>
                      </Ring>
                    </div>
                    <div className="col gap-3" style={{ marginTop: 18, textAlign: "left" }}>
                      {CRIT.map((c) => {
                        const v = result.criteria[c.key];
                        return (
                          <div key={c.key} className="col gap-1">
                            <div className="row between">
                              <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--ink-soft)" }}>{c.label}</span>
                              <span style={{ fontSize: 13.5, fontWeight: 900, fontFamily: "var(--font-display)", color: v != null ? `oklch(0.5 0.15 ${bandColor(v)})` : "var(--faint)" }}>
                                {v != null ? `${v}%` : "—"}
                              </span>
                            </div>
                            <Bar value={v ?? 0} hue={v != null ? bandColor(v) : 47} height={7} />
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <p style={{ color: "var(--muted)", fontSize: 15 }}>{result.on_topic ? t("guestNoScore") : t("guestOffTopic")}</p>
                )}

                <div className="row center gap-3 wrap" style={{ marginTop: 22 }}>
                  <Button variant="soft" icon="play" onClick={() => playTTS(result.phrase)}>{t("guestHearCorrect")}</Button>
                  <Button variant="ghost" icon="refresh" onClick={retry}>{t("guestRetry")}</Button>
                </div>
              </Card>

              {result.errors.length > 0 && (
                <Card>
                  <p style={{ fontSize: 12.5, fontWeight: 800, color: "var(--danger)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 10 }}>
                    {t("guestErrorsTitle")}
                  </p>
                  <div className="col gap-2">
                    {result.errors.map((e, i) => (
                      <div key={i} className="row between gap-2" style={{ padding: "10px 12px", background: "var(--surface-2)", borderRadius: "var(--r-sm)" }}>
                        <span style={{ fontSize: 15, fontWeight: 800 }}>{e.word}</span>
                        <button
                          type="button"
                          onClick={() => playTTS(e.word)}
                          className="tap row gap-1"
                          style={{ border: "none", background: "transparent", color: "var(--primary-press)", fontWeight: 800, fontSize: 13, cursor: "pointer" }}
                        >
                          <Icon name="play" size={14} /> {e.accuracy}%
                        </button>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* Level + course + soft CTA (value first, then sell) */}
              <Card style={{ background: "linear-gradient(135deg, oklch(0.97 0.03 250), var(--surface))" }}>
                <div className="col center" style={{ textAlign: "center", gap: 6 }}>
                  <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 700 }}>{t("guestLevelLabel")}</span>
                  <span style={{ fontSize: 30, fontWeight: 900, fontFamily: "var(--font-display)", color: "var(--grape)" }}>{result.level}</span>
                  <span style={{ fontSize: 14, color: "var(--ink-soft)", fontWeight: 700, marginTop: 2 }}>{t("guestCourse")}</span>
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
