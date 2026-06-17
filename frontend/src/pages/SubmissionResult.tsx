import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { useStudentStats } from "../lib/useStats";
import { freeAttemptsLeft } from "../lib/plan";
import type {
  ExplainResult,
  Question,
  Submission,
  Transcript,
  TranscriptWord,
} from "../lib/types";
import {
  Avatar,
  Bar,
  Button,
  Card,
  Confetti,
  Field,
  Icon,
  Loading,
  Mascot,
  Pill,
  Ring,
  WordTranscript,
  bandColor,
  fmt,
  inp,
  type WordSeg,
} from "../components/govori";

const BAND_OPTIONS = Array.from({ length: 21 }, (_, i) => i * 5); // 0, 5 … 100

// Hue per correction type so each tag reads at a glance.
function corrHue(type: string): number {
  switch (type) {
    case "grammar":
      return 28;
    case "pronunciation":
    case "pronun":
      return 305;
    case "lexis":
    case "lexical":
    case "vocabulary":
      return 248;
    case "word_order":
      return 47;
    default:
      return 47;
  }
}

/** Map a per-word accuracy (0–100) to the Govori transcript tone. Unscored words
 *  are "neutral" (plain), never green — so green always means good pronunciation. */
function pronTone(acc: number | null): WordSeg["pron"] {
  if (acc == null) return "neutral";
  if (acc >= 80) return "good";
  if (acc >= 60) return "mid";
  return "low";
}

/** Build WordTranscript segments from real per-word transcript data. */
function toWordSegs(words: TranscriptWord[]): WordSeg[] {
  return words
    .filter((w) => w && w.word)
    .map((w) => ({
      w: w.word,
      pron: pronTone(w.accuracy),
      note: w.accuracy != null ? `${Math.round(w.accuracy)}%` : undefined,
    }));
}

/* ── Custom audio player with a decorative waveform ── */
function AudioPlayer({ url, duration }: { url: string; duration: number | null }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const bars = Array.from({ length: 42 }, (_, i) => 0.3 + 0.7 * Math.abs(Math.sin(i * 1.7)));
  return (
    <div className="row gap-3" style={{ alignItems: "center" }}>
      <audio ref={ref} src={url} onEnded={() => setPlaying(false)} style={{ display: "none" }} />
      <button
        onClick={() => {
          const a = ref.current;
          if (!a) return;
          if (playing) {
            a.pause();
            setPlaying(false);
          } else {
            a.play();
            setPlaying(true);
          }
        }}
        className="tap"
        aria-label="play"
        style={{
          width: 44,
          height: 44,
          borderRadius: "50%",
          border: "none",
          cursor: "pointer",
          flexShrink: 0,
          background: "var(--primary)",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "var(--sh-primary)",
        }}
      >
        <Icon name={playing ? "pause" : "play"} size={18} fill />
      </button>
      <div className="row" style={{ flex: 1, height: 40, gap: 3, alignItems: "center", overflow: "hidden" }}>
        {bars.map((b, i) => (
          <span
            key={i}
            style={{
              flex: 1,
              maxWidth: 5,
              borderRadius: 999,
              background: "var(--primary)",
              opacity: 0.55,
              height: `${b * 100}%`,
            }}
          />
        ))}
      </div>
      <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)" }}>
        {fmt(duration ?? 0)}
      </span>
    </div>
  );
}

/* ── Transcript card: per-word pronunciation when available, else plain text ── */
function TranscriptCard({ transcript }: { transcript: Transcript }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const words = (transcript.word_timestamps ?? []).filter((w) => w && w.word);
  const hasWordScores = words.some((w) => w.accuracy != null);

  return (
    <Card style={{ marginBottom: 16 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="tap"
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          border: "none",
          background: "transparent",
          padding: 0,
          cursor: "pointer",
        }}
      >
        <div className="row gap-2">
          <Icon name="message" size={20} style={{ color: "var(--ink-soft)" }} />
          <h3 style={{ fontSize: 18 }}>{t("transcript")}</h3>
        </div>
        <Icon
          name="chevD"
          size={20}
          style={{
            color: "var(--muted)",
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform .2s",
          }}
        />
      </button>

      {open && (
        <div className="anim-fade-in" style={{ marginTop: 16 }}>
          {hasWordScores ? (
            <>
              <div className="row gap-4 wrap" style={{ marginBottom: 14 }}>
                {[
                  ["var(--pron-good)", t("pronGood"), "80–100%"],
                  ["var(--pron-mid)", t("pronOk"), "60–79%"],
                  ["var(--pron-low)", t("pronWeak"), "0–59%"],
                  ["var(--muted)", t("pronNone"), ""],
                ].map((l, i) => (
                  <span key={i} className="row gap-2" style={{ fontSize: 12.5, color: "var(--muted)" }}>
                    <span style={{ width: 12, height: 12, borderRadius: 4, background: l[0] }} />
                    <span style={{ fontWeight: 700, color: "var(--ink-soft)" }}>{l[1]}</span>
                    {l[2] && <span style={{ opacity: 0.7 }}>{l[2]}</span>}
                  </span>
                ))}
              </div>
              <WordTranscript words={toWordSegs(words)} />
              <div
                className="row gap-2"
                style={{
                  marginTop: 14,
                  padding: 12,
                  background: "var(--surface-2)",
                  borderRadius: "var(--r-sm)",
                  fontSize: 13,
                  color: "var(--muted)",
                }}
              >
                <Icon name="bulb" size={16} style={{ color: "var(--amber)" }} />
                {t("pronHint")}
              </div>
            </>
          ) : (
            <p style={{ fontSize: 16, lineHeight: 1.7, color: "var(--ink)", whiteSpace: "pre-wrap" }}>
              «{transcript.text}»
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

export function SubmissionResult() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const { user } = useAuth();
  const { totalCount } = useStudentStats();
  const nav = useNavigate();
  const isStudent = user?.role === "student";
  const qc = useQueryClient();
  const [showModel, setShowModel] = useState(false);
  const [showAllErrors, setShowAllErrors] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const celebratedRef = useRef(false);
  const [explanation, setExplanation] = useState<ExplainResult | null>(null);

  // Teacher feedback local state
  const [comment, setComment] = useState("");
  const [bandStr, setBandStr] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);

  const { data: sub } = useQuery({
    queryKey: ["submission", id],
    queryFn: async () => (await api.get<Submission>(`/submissions/${id}`)).data,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "pending" || s === "processing" ? 2000 : false;
    },
  });

  const { data: question } = useQuery({
    queryKey: ["question", sub?.question_id],
    enabled: !!sub?.question_id,
    queryFn: async () => (await api.get<Question>(`/questions/${sub!.question_id}`)).data,
  });

  const explainMut = useMutation({
    mutationFn: async () =>
      (await api.post<ExplainResult>(`/submissions/${sub!.id}/explain`)).data,
    onSuccess: (data) => setExplanation(data),
  });

  // Initialize feedback fields once the submission loads.
  useEffect(() => {
    if (sub) {
      setComment(sub.teacher_comment ?? "");
      setBandStr(sub.teacher_band != null ? String(sub.teacher_band) : "");
    }
  }, [sub?.id]);

  // Celebrate once when a student's score is first revealed.
  useEffect(() => {
    if (isStudent && sub?.status === "done" && !celebratedRef.current) {
      celebratedRef.current = true;
      setCelebrate(true);
      const tmr = setTimeout(() => setCelebrate(false), 1600);
      return () => clearTimeout(tmr);
    }
  }, [isStudent, sub?.status]);

  const feedbackMut = useMutation({
    mutationFn: async () =>
      (
        await api.patch<Submission>(`/submissions/${sub!.id}/feedback`, {
          comment: comment.trim() ? comment.trim() : null,
          band: bandStr === "" ? null : Number(bandStr),
        })
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["submission", id] });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    },
  });

  if (!sub) return <Loading full />;

  const processing = sub.status === "pending" || sub.status === "processing";

  /* ── Analyzing (Mascot thinking) — only until the transcript (STT) is ready.
     Once STT is done we fall through and show the transcript immediately while
     the Gemini feedback keeps loading (progressive result). ── */
  if (processing && !sub.transcript) {
    return (
      <div
        className="focus-wrap anim-fade-in"
        style={{ maxWidth: 520, marginInline: "auto", paddingTop: 24 }}
      >
        <Card style={{ textAlign: "center", padding: 40 }}>
          <Mascot size={96} mood="thinking" />
          <h3 style={{ fontSize: 21, marginTop: 10 }}>{t("analyzing")}</h3>
          <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 6 }}>{t("analyzingHint")}</p>
          <div style={{ maxWidth: 280, margin: "22px auto 0" }}>
            <Bar value={66} hue={47} />
          </div>
        </Card>
      </div>
    );
  }

  /* ── Failed ── */
  if (sub.status === "failed") {
    return (
      <div
        className="focus-wrap anim-fade-in"
        style={{ maxWidth: 520, marginInline: "auto", paddingTop: 24 }}
      >
        <Card style={{ textAlign: "center", borderColor: "oklch(0.85 0.1 28)" }}>
          <Mascot size={84} mood="sleepy" float={false} />
          <p style={{ fontSize: 17, fontWeight: 800, color: "var(--danger)", marginTop: 8 }}>
            {t("failed")}
          </p>
          {sub.error_message && (
            <p style={{ fontSize: 14, color: "var(--muted)", marginTop: 4 }}>{sub.error_message}</p>
          )}
          <div style={{ marginTop: 18 }}>
            <Button variant="ghost" icon="chevL" onClick={() => nav(-1)}>
              {t("back")}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  /* ── Shadowing result: pronunciation-only ── */
  if (sub.reference_text) {
    return (
      <div className="focus-wrap anim-fade-in" style={{ maxWidth: 820, marginInline: "auto" }}>
        {celebrate && <Confetti />}
        <div className="row between" style={{ marginBottom: 18 }}>
          <Button variant="ghost" size="sm" icon="chevL" onClick={() => nav("/shadowing")}>
            {t("navShadow")}
          </Button>
        </div>
        <Card pad={0} style={{ overflow: "hidden", marginBottom: 16 }}>
          <div
            style={{
              padding: "24px 28px",
              background: "linear-gradient(135deg, oklch(0.96 0.045 305), var(--surface))",
            }}
          >
            <Pill hue={305}>{t("shadowResult")}</Pill>
            <p
              style={{
                fontSize: 11.5,
                fontWeight: 800,
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                margin: "14px 0 4px",
              }}
            >
              {t("shadowTarget")}
            </p>
            <p style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.3, color: "var(--ink)" }}>
              {sub.reference_text}
            </p>
          </div>
        </Card>
        {(() => {
          const m = sub.transcript?.pronunciation?.reference_match;
          if (!m) return null;
          const pct = Math.round(m.completeness);
          const ok = m.on_topic;
          const hue = ok ? bandColor(pct) : 18;
          return (
            <Card style={{ marginBottom: 16 }}>
              <div className="row between" style={{ marginBottom: 10 }}>
                <span style={{ fontWeight: 800, fontSize: 14, color: "var(--ink)" }}>
                  {t("shadowMatch")}
                </span>
                <span style={{ fontWeight: 900, fontSize: 18, color: `oklch(0.55 0.18 ${hue})` }}>
                  {pct}%
                </span>
              </div>
              <div style={{ height: 8, borderRadius: 99, background: "var(--surface-3)", overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: `oklch(0.6 0.18 ${hue})` }} />
              </div>
              {!ok && (
                <p style={{ marginTop: 10, fontSize: 14, color: "var(--danger)", fontWeight: 600 }}>
                  {t("shadowOffTopic")}
                </p>
              )}
            </Card>
          );
        })()}
        {sub.transcript && <TranscriptCard transcript={sub.transcript} />}
        <Button full icon="refresh" onClick={() => nav("/shadowing")}>
          {t("shadowTitle")}
        </Button>
      </div>
    );
  }

  const ev = sub.evaluation;
  const fb = ev?.feedback;
  const band = ev?.overall_band ?? 0; // absolute, vs C2
  const levelScore = ev?.level_score ?? null; // relative to the task's CEFR level
  const hue = bandColor(band);
  // Celebrate / reward by the level-relative score so beginners stay motivated.
  const moodScore = levelScore ?? band;
  const good = moodScore >= 60;
  const xp = 10 + Math.round((moodScore / 100) * 18); // mirrors backend xp_for_band
  const tips = (fb?.improvements?.length ? fb.improvements : [t("tip1"), t("tip2"), t("tip3")]).slice(0, 3);
  const corrections = ev?.corrections ?? [];
  const shownCorr = showAllErrors ? corrections : corrections.slice(0, 3);
  const noAttemptsLeft = isStudent && !user?.is_premium && freeAttemptsLeft(user ?? null, totalCount) <= 0;

  const criteria: { label: string; value: number | null }[] = [
    { label: t("fluency"), value: ev?.fluency_score ?? null },
    { label: t("lexical"), value: ev?.lexical_score ?? null },
    { label: t("grammar"), value: ev?.grammar_score ?? null },
    { label: t("relevance"), value: ev?.relevance_score ?? null },
    { label: t("pronunciation"), value: ev?.pronunciation_score ?? null },
  ].filter((c) => c.value != null);

  return (
    <div className="focus-wrap anim-fade-in" style={{ maxWidth: 880, marginInline: "auto" }}>
      {celebrate && <Confetti />}

      <div className="row between" style={{ marginBottom: 16 }}>
        <Button variant="ghost" size="sm" icon="chevL" onClick={() => nav(-1)}>
          {isStudent ? t("backToTopics") : t("back")}
        </Button>
      </div>

      {/* Student identity (teacher/admin view) */}
      {!isStudent && sub.student_name && (
        <Card style={{ marginBottom: 16 }}>
          <div className="row gap-3" style={{ alignItems: "center" }}>
            <Avatar name={sub.student_name} size={44} />
            <div className="col">
              <span style={{ fontSize: 16, fontWeight: 800 }}>{sub.student_name}</span>
              <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 600 }}>
                {t("colStudent")}
              </span>
            </div>
          </div>
        </Card>
      )}

      {/* Feedback still being generated by the LLM (transcript already shown below) */}
      {!ev && processing && (
        <Card style={{ marginBottom: 18 }}>
          <div className="row gap-4" style={{ alignItems: "center" }}>
            <Mascot size={56} mood="thinking" float={false} />
            <div className="col gap-1" style={{ flex: 1 }}>
              <h3 style={{ fontSize: 18 }}>{t("analyzing")}</h3>
              <p style={{ color: "var(--muted)", fontSize: 14, margin: 0 }}>{t("analyzingFeedback")}</p>
              <div style={{ maxWidth: 320, marginTop: 10 }}>
                <Bar value={66} hue={47} />
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Celebration header — Mascot + Ring band + XP, then criteria bar grid */}
      {ev && (
        <Card pad={0} style={{ overflow: "hidden", marginBottom: 18 }}>
          <div
            style={{
              padding: "28px 30px",
              background: `linear-gradient(135deg, oklch(0.96 0.045 ${hue}), var(--surface))`,
            }}
          >
            <div className="row between wrap gap-4">
              <div className="row gap-4" style={{ alignItems: "center" }}>
                <Mascot size={84} mood={good ? "celebrate" : "happy"} />
                <div className="col gap-1" style={{ alignItems: "flex-start" }}>
                  <Pill hue={hue} icon="check">
                    {t("result")}
                  </Pill>
                  <h2 style={{ fontSize: 25, marginTop: 4 }}>
                    {good ? t("greatJob") : t("hasErrors")}
                  </h2>
                  <p style={{ color: "var(--muted)", fontSize: 14 }}>
                    {good ? t("greatJobHint") : t("hasErrorsHint")}
                    {sub.audio_duration_sec != null && ` · ${fmt(sub.audio_duration_sec)}`}
                  </p>
                </div>
              </div>
              <div className="row gap-4 wrap" style={{ alignItems: "flex-start" }}>
                {/* Level-relative score (motivating) — shown first when available */}
                {levelScore != null && (
                  <div className="col" style={{ alignItems: "center", gap: 7 }}>
                    <Ring value={levelScore} size={104} sw={11} hue={bandColor(levelScore)}>
                      <span
                        style={{
                          fontFamily: "var(--font-display)",
                          fontWeight: 900,
                          fontSize: 36,
                          color: `oklch(0.5 0.15 ${bandColor(levelScore)})`,
                          lineHeight: 1,
                        }}
                      >
                        {Math.round(levelScore)}
                      </span>
                    </Ring>
                    <span
                      style={{
                        fontSize: 11,
                        color: "var(--muted)",
                        fontWeight: 800,
                        letterSpacing: "0.04em",
                        textAlign: "center",
                      }}
                    >
                      {(question?.level ? question.level + " · " : "") + t("scoreLevel").toUpperCase()}
                    </span>
                  </div>
                )}
                {/* Absolute score (vs C2) — the "true" CEFR position */}
                <div className="col" style={{ alignItems: "center", gap: 7 }}>
                  <Ring value={band} size={levelScore != null ? 90 : 104} sw={levelScore != null ? 10 : 11} hue={hue}>
                    <span
                      style={{
                        fontFamily: "var(--font-display)",
                        fontWeight: 900,
                        fontSize: levelScore != null ? 30 : 36,
                        color: `oklch(0.5 0.15 ${hue})`,
                        lineHeight: 1,
                      }}
                    >
                      {Math.round(band)}
                    </span>
                  </Ring>
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--muted)",
                      fontWeight: 800,
                      letterSpacing: "0.04em",
                      textAlign: "center",
                    }}
                  >
                    {t("scoreAbsolute").toUpperCase()}
                  </span>
                </div>
                {isStudent && (
                  <div
                    style={{
                      background: "var(--amber-tint)",
                      borderRadius: "var(--r-md)",
                      padding: "12px 16px",
                      textAlign: "center",
                    }}
                  >
                    <div
                      style={{
                        fontFamily: "var(--font-display)",
                        fontWeight: 900,
                        fontSize: 22,
                        color: "oklch(0.55 0.14 70)",
                      }}
                    >
                      +{xp}
                    </div>
                    <div style={{ fontSize: 10.5, color: "oklch(0.5 0.1 70)", fontWeight: 800 }}>XP</div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Criteria bar grid */}
          {criteria.length > 0 && (
            <div
              className="g4"
              style={{ padding: "18px 30px", borderTop: "1px solid var(--line)", gap: "18px 26px" }}
            >
              {criteria.map((c) => {
                const ch = bandColor(c.value!);
                return (
                  <div key={c.label} className="col gap-2">
                    <div className="row between">
                      <span
                        style={{
                          fontSize: 12.5,
                          fontWeight: 700,
                          color: "var(--ink-soft)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {c.label}
                      </span>
                      <span
                        style={{
                          fontSize: 14,
                          fontWeight: 900,
                          fontFamily: "var(--font-display)",
                          color: `oklch(0.5 0.15 ${ch})`,
                        }}
                      >
                        {Math.round(c.value!)}
                      </span>
                    </div>
                    <Bar value={c.value!} hue={ch} height={7} />
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* Task recap */}
      {question && (
        <Card style={{ marginBottom: 16 }}>
          <div className="row gap-2 wrap" style={{ marginBottom: 8 }}>
            {question.topic && <Pill hue={hue}>{question.topic}</Pill>}
            {question.level && <Pill hue={47}>{question.level}</Pill>}
          </div>
          <h3 style={{ fontSize: 18 }}>{question.title}</h3>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--muted)", marginTop: 6 }}>
            {question.prompt_text}
          </p>
        </Card>
      )}

      {/* Your answer audio */}
      {sub.audio_url && (
        <Card style={{ marginBottom: 16 }}>
          <div className="row between" style={{ marginBottom: 14 }}>
            <h3 style={{ fontSize: 18 }}>{t("yourAnswer")}</h3>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)" }}>
              {t("duration")}: {fmt(sub.audio_duration_sec ?? 0)}
            </span>
          </div>
          <AudioPlayer url={sub.audio_url} duration={sub.audio_duration_sec} />
        </Card>
      )}

      {/* Teacher's note (student view) */}
      {isStudent && sub.teacher_comment && (
        <Card
          style={{
            marginBottom: 16,
            background: "linear-gradient(135deg, var(--primary-tint), var(--surface))",
            borderColor: "var(--line-2)",
          }}
        >
          <div className="row gap-2" style={{ marginBottom: 10 }}>
            <Icon name="message" size={20} style={{ color: "var(--primary)" }} />
            <h3 style={{ fontSize: 18 }}>{t("teacherNote")}</h3>
          </div>
          <p style={{ fontSize: 15, lineHeight: 1.6, color: "var(--ink)", whiteSpace: "pre-wrap" }}>
            {sub.teacher_comment}
          </p>
          {sub.teacher_band != null && (
            <div
              className="row gap-2"
              style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line)", alignItems: "baseline" }}
            >
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--ink-soft)" }}>
                {t("finalBand")}:
              </span>
              <span
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 900,
                  fontSize: 26,
                  color: "var(--primary-press)",
                }}
              >
                {Math.round(sub.teacher_band)}
                <span style={{ fontSize: 15, color: "var(--muted)" }}> / 100</span>
              </span>
            </div>
          )}
        </Card>
      )}

      {/* Strengths FIRST (encouragement) */}
      {fb?.strengths && fb.strengths.length > 0 && (
        <Card style={{ marginBottom: 16, borderColor: "oklch(0.85 0.07 152)" }}>
          <div className="row gap-2" style={{ marginBottom: 14 }}>
            <Icon name="check" size={20} style={{ color: "var(--success)" }} sw={2.6} />
            <h3 style={{ fontSize: 18 }}>{t("strengths")}</h3>
          </div>
          <div className="col gap-3">
            {fb.strengths.map((s, i) => (
              <div key={i} className="row gap-3" style={{ alignItems: "flex-start" }}>
                <div
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 8,
                    background: "var(--success-tint)",
                    color: "var(--success)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Icon name="check" size={15} sw={3} />
                </div>
                <span style={{ fontSize: 15, lineHeight: 1.5 }}>{s}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Corrections — max 3, then show all */}
      {corrections.length > 0 && (
        <Card style={{ marginBottom: 16 }}>
          <div className="row between" style={{ marginBottom: 14 }}>
            <div className="row gap-2">
              <Icon name="target" size={20} style={{ color: "var(--primary)" }} />
              <h3 style={{ fontSize: 18 }}>{t("errorsInAnswer")}</h3>
            </div>
            <Pill hue={47} size="sm">
              {corrections.length}
            </Pill>
          </div>
          <div className="col gap-2">
            {shownCorr.map((c, i) => {
              const ch = corrHue(c.type);
              return (
                <div
                  key={i}
                  className="row gap-3"
                  style={{
                    alignItems: "flex-start",
                    padding: 13,
                    background: "var(--surface-2)",
                    borderRadius: "var(--r-sm)",
                  }}
                >
                  <div
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 8,
                      background: `oklch(0.94 0.05 ${ch})`,
                      color: `oklch(0.5 0.15 ${ch})`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      fontSize: 13,
                      fontWeight: 900,
                      fontFamily: "var(--font-display)",
                    }}
                  >
                    {i + 1}
                  </div>
                  <div className="col gap-1" style={{ minWidth: 0 }}>
                    <div className="row gap-2 wrap" style={{ alignItems: "baseline" }}>
                      <span
                        style={{
                          fontSize: 15,
                          fontWeight: 700,
                          color: "var(--muted)",
                          textDecoration: "line-through",
                        }}
                      >
                        {c.original}
                      </span>
                      <Icon name="chevR" size={14} style={{ color: "var(--faint)" }} />
                      <span style={{ fontSize: 15, fontWeight: 800, color: "var(--success)" }}>
                        {c.corrected}
                      </span>
                    </div>
                    {c.explanation && (
                      <span style={{ fontSize: 13.5, color: "var(--muted)" }}>{c.explanation}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {corrections.length > 3 && (
            <button
              onClick={() => setShowAllErrors((v) => !v)}
              className="tap"
              style={{
                marginTop: 12,
                width: "100%",
                padding: 11,
                borderRadius: "var(--r-sm)",
                border: "1px dashed var(--line-2)",
                background: "transparent",
                color: "var(--ink-soft)",
                fontFamily: "var(--font-display)",
                fontWeight: 800,
                fontSize: 14,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 7,
                cursor: "pointer",
              }}
            >
              <Icon name={showAllErrors ? "chevD" : "plus"} size={16} />
              {showAllErrors ? t("showLess") : `${t("showAllErrors")} (${corrections.length})`}
            </button>
          )}
        </Card>
      )}

      {/* Summary */}
      {fb?.summary && (
        <Card style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 18, marginBottom: 10 }}>{t("summary")}</h3>
          <p style={{ fontSize: 15, lineHeight: 1.6, color: "var(--ink)", whiteSpace: "pre-wrap" }}>
            {fb.summary}
          </p>
        </Card>
      )}

      {/* Transcript + per-word pronunciation */}
      {sub.transcript?.text && <TranscriptCard transcript={sub.transcript} />}

      {/* Model answer */}
      {sub.model_answer_text && (
        <Card style={{ marginBottom: 16 }}>
          <div className="row between gap-3" style={{ marginBottom: 10 }}>
            <div className="col" style={{ minWidth: 0 }}>
              <h3 style={{ fontSize: 18 }}>{t("modelAnswer")}</h3>
              <span style={{ fontSize: 13, color: "var(--muted)" }}>{t("modelAnswerHint")}</span>
            </div>
            {!showModel && (
              <Button variant="soft" size="sm" onClick={() => setShowModel(true)}>
                {t("showModelAnswer")}
              </Button>
            )}
          </div>
          {showModel && (
            <p
              style={{
                fontSize: 15,
                lineHeight: 1.6,
                color: "var(--ink)",
                whiteSpace: "pre-wrap",
                padding: 14,
                background: "var(--primary-tint)",
                borderRadius: "var(--r-md)",
              }}
            >
              {sub.model_answer_text}
            </p>
          )}
        </Card>
      )}

      {/* Tips with mascot */}
      <Card
        style={{
          marginBottom: 16,
          background: "linear-gradient(135deg, var(--primary-tint), var(--surface))",
        }}
      >
        <div className="row gap-4 between wrap">
          <div className="col" style={{ minWidth: 0, flex: 1 }}>
            <div className="row gap-2" style={{ marginBottom: 12 }}>
              <Icon name="sparkles" size={20} style={{ color: "var(--primary)" }} />
              <h3 style={{ fontSize: 18 }}>{t("tips")}</h3>
            </div>
            <div className="col gap-2">
              {tips.map((s, i) => (
                <div key={i} className="row gap-2" style={{ alignItems: "flex-start" }}>
                  <Icon name="check" size={16} sw={3} style={{ color: "var(--primary)", marginTop: 2, flexShrink: 0 }} />
                  <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>{s}</span>
                </div>
              ))}
            </div>
          </div>
          <Mascot size={84} mood="proud" />
        </div>
      </Card>

      {/* Explain my answer (students only) */}
      {isStudent &&
        (() => {
          const result = sub.evaluation?.explanation ?? explanation;
          return (
            <Card style={{ marginBottom: 16 }}>
              <div className="row gap-2">
                <Icon name="sparkles" size={20} style={{ color: "var(--primary)" }} />
                <h3 style={{ fontSize: 18 }}>{t("explainMyAnswer")}</h3>
              </div>
              <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>{t("explainHint")}</p>
              {result ? (
                <div className="col gap-3" style={{ marginTop: 14 }}>
                  <p style={{ fontSize: 15, lineHeight: 1.6, color: "var(--ink)", whiteSpace: "pre-wrap" }}>
                    {result.explanation}
                  </p>
                  <div
                    style={{
                      background: "var(--success-tint)",
                      borderRadius: "var(--r-md)",
                      padding: 14,
                    }}
                  >
                    <p
                      style={{
                        fontSize: 11.5,
                        fontWeight: 800,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        color: "var(--success)",
                        marginBottom: 6,
                      }}
                    >
                      {t("improvedSentence")}
                    </p>
                    <p style={{ fontSize: 15, lineHeight: 1.6, color: "var(--ink)", whiteSpace: "pre-wrap" }}>
                      {result.improved_sentence}
                    </p>
                  </div>
                </div>
              ) : explainMut.isPending ? (
                <div className="row gap-3" style={{ marginTop: 14, color: "var(--muted)" }}>
                  <Loading />
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{t("generating")}</span>
                </div>
              ) : (
                <div style={{ marginTop: 14 }}>
                  <Button variant="soft" icon="sparkles" onClick={() => explainMut.mutate()}>
                    {t("explainMyAnswer")}
                  </Button>
                </div>
              )}
            </Card>
          );
        })()}

      {/* Vocabulary */}
      {fb?.vocabulary_suggestions && fb.vocabulary_suggestions.length > 0 && (
        <Card style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 18, marginBottom: 12 }}>{t("vocabulary")}</h3>
          <div className="row gap-2 wrap">
            {fb.vocabulary_suggestions.map((v, i) => (
              <Pill key={i} hue={248}>
                {v}
              </Pill>
            ))}
          </div>
        </Card>
      )}

      {/* Teacher feedback (teacher/admin only) */}
      {!isStudent && (
        <Card style={{ marginBottom: 16 }}>
          <div className="row gap-2" style={{ marginBottom: 16 }}>
            <Icon name="edit" size={20} style={{ color: "var(--ink-soft)" }} />
            <h3 style={{ fontSize: 18 }}>{t("teacherFeedback")}</h3>
          </div>
          <div className="col gap-4">
            <Field label={t("leaveFeedback")}>
              <textarea
                rows={4}
                value={comment}
                placeholder={t("commentPh")}
                onChange={(e) => setComment(e.target.value)}
                style={inp}
              />
            </Field>
            <div style={{ maxWidth: 200 }}>
              <Field label={t("overrideBand")}>
                <select value={bandStr} onChange={(e) => setBandStr(e.target.value)} style={inp}>
                  <option value="">—</option>
                  {BAND_OPTIONS.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="row gap-3" style={{ alignItems: "center" }}>
              <Button onClick={() => feedbackMut.mutate()} disabled={feedbackMut.isPending}>
                {feedbackMut.isPending ? "…" : t("saveFeedback")}
              </Button>
              {savedFlash && (
                <span className="row gap-1" style={{ fontSize: 14, fontWeight: 800, color: "var(--success)" }}>
                  <Icon name="check" size={16} sw={3} />
                  {t("feedbackSaved")}
                </span>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Paywall nudge — only after value shown, when no free attempts left */}
      {noAttemptsLeft && (
        <Card
          style={{
            marginBottom: 18,
            background: "linear-gradient(135deg, oklch(0.96 0.05 80), var(--surface))",
            borderColor: "oklch(0.85 0.1 80)",
          }}
        >
          <div className="row gap-4 wrap between">
            <div className="row gap-3">
              <div
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 13,
                  background: "var(--amber-tint)",
                  color: "oklch(0.55 0.14 70)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Icon name="star" size={24} fill />
              </div>
              <div className="col">
                <span style={{ fontWeight: 800, fontFamily: "var(--font-display)", fontSize: 16 }}>
                  {t("limitReached")}
                </span>
                <span style={{ fontSize: 13.5, color: "var(--muted)" }}>{t("premiumCardText")}</span>
              </div>
            </div>
            <Button variant="dark" icon="sparkles" onClick={() => nav("/premium")}>
              {t("premium")}
            </Button>
          </div>
        </Card>
      )}

      {/* Actions */}
      {isStudent ? (
        <div className="row gap-3 between" style={{ position: "sticky", bottom: 16, paddingTop: 4 }}>
          {sub.question_id ? (
            <Button variant="ghost" icon="refresh" onClick={() => nav(`/questions/${sub.question_id}/answer`)}>
              {t("tryAgain")}
            </Button>
          ) : (
            <span />
          )}
          <Button iconR="chevR" onClick={() => nav("/questions")}>
            {t("continueBtn")}
          </Button>
        </div>
      ) : (
        <Button full variant="ghost" icon="chevL" onClick={() => nav(-1)}>
          {t("back")}
        </Button>
      )}
    </div>
  );
}
