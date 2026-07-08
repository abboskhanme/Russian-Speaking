import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { api, postWithRetry, uploadToPresigned } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { friendlyError } from "../lib/errors";
import type { Question, Submission } from "../lib/types";
import { AudioRecorder } from "../components/AudioRecorder";
import { Paywall } from "../components/Paywall";
import { RichText } from "../components/RichTextEditor";
import {
  Bar,
  Button,
  Card,
  Pill,
  Icon,
  Loading,
  MediaImage,
  bandColor,
} from "../components/govori";

export function AnswerQuestion() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const { user } = useAuth();
  const nav = useNavigate();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [serverLocked, setServerLocked] = useState(false);
  // The recorded blob is held here so a failed upload/submit NEVER loses it —
  // the student can hit "Retry send" and re-upload the SAME audio, no re-record.
  const [pending, setPending] = useState<{ blob: Blob; durationSec: number } | null>(null);

  const isPremium = !!user?.is_premium;

  const { data: q, isLoading } = useQuery({
    queryKey: ["question", id],
    queryFn: async () => (await api.get<Question>(`/questions/${id}`)).data,
  });

  if (isLoading || !q) return <Loading full />;

  // Positional freemium: this task is beyond the module's free preview, or the
  // server rejected the submit with 402.
  const locked = serverLocked || (!isPremium && !!q.locked);

  // Store the blob first, THEN attempt the send. On any failure the blob stays
  // in `pending` so it can be re-sent without re-recording.
  function handleComplete(blob: Blob, durationSec: number) {
    setPending({ blob, durationSec });
    void doSend(blob, durationSec);
  }

  async function doSend(blob: Blob, durationSec: number) {
    setUploading(true);
    setError(null);
    setProgress(0);
    // Use the recorder's actual container (webm on Chrome, mp4 on iOS Safari…)
    // rather than assuming webm, so the presigned upload content-type matches.
    const contentType = blob.type || "audio/webm";
    try {
      const { data: up } = await postWithRetry<{ upload_url: string; audio_key: string }>(
        "/submissions/upload-url",
        { question_id: q!.id, content_type: contentType },
      );
      await uploadToPresigned(up.upload_url, blob, contentType, setProgress);
      const { data: sub } = await postWithRetry<Submission>("/submissions", {
        question_id: q!.id,
        audio_key: up.audio_key,
        audio_duration_sec: durationSec,
      });
      setPending(null);
      nav(`/submissions/${sub.id}`);
    } catch (e) {
      const status = (e as { response?: { status?: number } }).response?.status;
      // 402 = free-trial exhausted → show the paywall, not an error message.
      // 403 = task not assigned / deadline passed → specific message, not a
      // generic "couldn't send" (which reads as a technical failure to retry).
      // 429 = busy → friendly "wait a moment"; 5xx → "server problem".
      if (status === 402) {
        setPending(null);
        setServerLocked(true);
      } else if (status === 403) setError(t("notAssignedError"));
      else setError(friendlyError(e, t, t("sendError")));
      setUploading(false);
    }
  }

  function discardPending() {
    setPending(null);
    setError(null);
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

          {q.instruction_text && (
            <div
              style={{
                marginTop: 12,
                padding: "12px 14px",
                background: "var(--primary-tint)",
                borderRadius: "var(--r-md)",
                borderLeft: "3px solid var(--primary)",
              }}
            >
              <div
                style={{
                  fontSize: 11.5,
                  fontWeight: 800,
                  color: "var(--primary-press)",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  marginBottom: 4,
                }}
              >
                {t("taskCondition")}
              </div>
              <div style={{ fontSize: 15, lineHeight: 1.55, color: "var(--ink)", whiteSpace: "pre-wrap" }}>
                {q.instruction_text}
              </div>
            </div>
          )}

          <RichText
            html={q.prompt_text}
            style={{ fontSize: 16, lineHeight: 1.6, color: "var(--ink-soft)", marginTop: 12 }}
          />

          {q.type === "image" && q.media_url && (
            <MediaImage
              src={q.media_url}
              containerStyle={{ marginTop: 18 }}
              style={{
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
          {uploading ? (
            <div className="col center gap-3" style={{ padding: "24px 0" }}>
              <Loading />
              <p style={{ fontSize: 15, fontWeight: 800, color: "var(--primary-press)" }}>
                {t("sending")}
                {progress > 0 && ` · ${progress}%`}
              </p>
              <div style={{ width: "100%", maxWidth: 320 }}>
                <Bar value={progress} hue={47} />
              </div>
            </div>
          ) : pending ? (
            /* Send failed — the recording is preserved, offer a re-send that
               re-uploads the SAME blob (no re-recording). */
            <div className="col center gap-3" style={{ padding: "8px 0" }}>
              {error && (
                <p style={{ fontSize: 14, fontWeight: 700, color: "var(--danger)" }}>{error}</p>
              )}
              <p style={{ fontSize: 13.5, color: "var(--muted)" }}>{t("sendKeptHint")}</p>
              <div className="row gap-3 wrap" style={{ justifyContent: "center" }}>
                <Button variant="ghost" icon="trash" onClick={discardPending}>
                  {t("deleteRecording")}
                </Button>
                <Button icon="refresh" onClick={() => doSend(pending.blob, pending.durationSec)}>
                  {t("retrySend")}
                </Button>
              </div>
            </div>
          ) : (
            <AudioRecorder maxSeconds={q.answer_time_limit_sec} onComplete={handleComplete} />
          )}
        </Card>
      )}
    </div>
  );
}
