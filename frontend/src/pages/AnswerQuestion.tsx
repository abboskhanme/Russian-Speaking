import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { api, uploadToPresigned } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { useStudentStats } from "../lib/useStats";
import { isLocked, FREE_ATTEMPT_LIMIT } from "../lib/plan";
import { friendlyError } from "../lib/errors";
import type { Question, Submission } from "../lib/types";
import { AudioRecorder } from "../components/AudioRecorder";
import { Paywall } from "../components/Paywall";
import { RichText } from "../components/RichTextEditor";
import {
  Button,
  Card,
  Pill,
  Icon,
  Loading,
  AttemptDots,
  bandColor,
} from "../components/govori";

const FREE_ATTEMPTS = FREE_ATTEMPT_LIMIT;

export function AnswerQuestion() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const { user } = useAuth();
  const { totalCount } = useStudentStats();
  const nav = useNavigate();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverLocked, setServerLocked] = useState(false);

  const isPremium = !!user?.is_premium;
  const locked = serverLocked || isLocked(user ?? null, totalCount);

  const { data: q, isLoading } = useQuery({
    queryKey: ["question", id],
    queryFn: async () => (await api.get<Question>(`/questions/${id}`)).data,
  });

  if (isLoading || !q) return <Loading full />;

  async function handleComplete(blob: Blob, durationSec: number) {
    setUploading(true);
    setError(null);
    try {
      const { data: up } = await api.post("/submissions/upload-url", {
        question_id: q!.id,
        content_type: "audio/webm",
      });
      await uploadToPresigned(up.upload_url, blob, "audio/webm");
      const { data: sub } = await api.post<Submission>("/submissions", {
        question_id: q!.id,
        audio_key: up.audio_key,
        audio_duration_sec: durationSec,
      });
      nav(`/submissions/${sub.id}`);
    } catch (e) {
      const status = (e as { response?: { status?: number } }).response?.status;
      // 402 = free-trial exhausted → show the paywall, not an error message.
      // 5xx / rate-limit → friendly "server problem"; anything else → send error.
      if (status === 402) setServerLocked(true);
      else setError(friendlyError(e, t, t("sendError")));
      setUploading(false);
    }
  }

  // Topic gives the card its accent hue; falls back to the Govori orange.
  const hue = q.topic ? (bandColor(q.topic.length % 9) + q.topic.charCodeAt(0)) % 360 : 47;

  return (
    <div className="focus-wrap anim-fade-in" style={{ maxWidth: 820, marginInline: "auto" }}>
      {/* Back + task pill header */}
      <div className="row between" style={{ marginBottom: 18 }}>
        <Button variant="ghost" size="sm" icon="chevL" onClick={() => nav(-1)}>
          {t("backToTopics")}
        </Button>
        {q.topic && <Pill hue={hue}>{q.topic}</Pill>}
      </div>

      {/* Gradient question / cue card */}
      <Card pad={0} style={{ overflow: "hidden", marginBottom: 20 }}>
        <div
          style={{
            padding: "26px 28px",
            background: `linear-gradient(135deg, oklch(0.97 0.03 ${hue}), var(--surface))`,
          }}
        >
          <div className="row gap-2" style={{ marginBottom: 12 }}>
            <Icon name="message" size={18} style={{ color: `oklch(0.6 0.15 ${hue})` }} />
            <span
              style={{
                fontSize: 12.5,
                fontWeight: 800,
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              {q.level ? `${t("speakInRussian")} · ${q.level}` : t("speakInRussian")}
            </span>
          </div>
          <h2 style={{ fontSize: 24, lineHeight: 1.25 }}>{q.title}</h2>

          <RichText
            html={q.prompt_text}
            style={{ fontSize: 16, lineHeight: 1.6, color: "var(--ink-soft)", marginTop: 12 }}
          />

          {q.type === "image" && q.media_url && (
            <img
              src={q.media_url}
              alt=""
              style={{
                marginTop: 18,
                width: "100%",
                maxHeight: 320,
                objectFit: "contain",
                borderRadius: "var(--r-md)",
              }}
            />
          )}
          {q.type === "video" && q.media_url && (
            <video
              src={q.media_url}
              controls
              style={{ marginTop: 18, width: "100%", borderRadius: "var(--r-md)" }}
            />
          )}
        </div>
      </Card>

      {/* Recording area — REAL AudioRecorder wrapped in a Govori Card */}
      {locked ? (
        <Paywall />
      ) : (
        <Card style={{ textAlign: "center" }}>
          {!isPremium && (
            <div className="row center gap-2" style={{ marginBottom: 18 }}>
              <AttemptDots used={totalCount} total={FREE_ATTEMPTS} />
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)" }}>
                {Math.max(0, FREE_ATTEMPTS - totalCount)} / {FREE_ATTEMPTS}
              </span>
            </div>
          )}

          {uploading ? (
            <div className="col center gap-3" style={{ padding: "24px 0" }}>
              <Loading />
              <p style={{ fontSize: 15, fontWeight: 800, color: "var(--primary-press)" }}>
                {t("sending")}
              </p>
            </div>
          ) : (
            <AudioRecorder maxSeconds={q.answer_time_limit_sec} onComplete={handleComplete} />
          )}

          {error && (
            <p style={{ marginTop: 14, fontSize: 14, fontWeight: 700, color: "var(--danger)" }}>
              {error}
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
