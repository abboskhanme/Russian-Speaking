import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, uploadToPresigned } from "../lib/api";
import { useI18n } from "../lib/i18n";
import type { Question, QuestionBlock, QuestionType, RuStyle, Topic } from "../lib/types";
import {
  Card,
  Button,
  Icon,
  Field,
  MediaImage,
  Toggle,
  inp,
  type IconName,
} from "../components/govori";
import { RichTextEditor, isEmptyRich } from "../components/RichTextEditor";
import { AdminTeacherPicker } from "../components/AdminTeacherPicker";
import { useAuth } from "../lib/auth";

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

// Keep in sync with nginx `client_max_body_size` for /russpeak-media/ (200m).
const MAX_MEDIA_BYTES = 200 * 1024 * 1024;

const TYPE_META: Record<QuestionType, { hue: number; icon: IconName }> = {
  text: { hue: 47, icon: "message" },
  image: { hue: 152, icon: "eye" },
  video: { hue: 248, icon: "play" },
};

// The same component backs both /new and /:id/edit. React Router reuses the
// instance when navigating between those routes, so without a key the previous
// form's state (title, prompt, level…) leaks into the next screen — e.g. opening
// "new" right after editing a question would show the edited question's data.
// Keying by id forces a fresh remount whenever the target changes.
export function CreateQuestion() {
  const { id } = useParams<{ id: string }>();
  return <CreateQuestionForm key={id ?? "new"} />;
}

function CreateQuestionForm() {
  const { t } = useI18n();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const nav = useNavigate();
  const qc = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const [search] = useSearchParams();
  const isEdit = !!id;
  // When a task is created from inside a module, pre-link it to that module and
  // send the teacher back there on save.
  const presetBlock = search.get("block") ?? "";
  const returnTo = search.get("return") || "/teacher/questions";

  const [type, setType] = useState<QuestionType>("text");
  const [title, setTitle] = useState("");
  const [instruction, setInstruction] = useState("");
  const [prompt, setPrompt] = useState("");
  const [level, setLevel] = useState("");
  const [topic, setTopic] = useState("");
  const [ruStyle, setRuStyle] = useState<"" | RuStyle>("");
  const [blockId, setBlockId] = useState(presetBlock);
  // Admin-only: which teacher owns the created question.
  const [ownerTeacherId, setOwnerTeacherId] = useState("");
  const [answerLimit, setAnswerLimit] = useState(120);
  const [modelAnswer, setModelAnswer] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const previewRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [publish, setPublish] = useState(true);
  const [existingMedia, setExistingMedia] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Media upload progress: null = no upload phase (creating/finishing, shown as
  // an indeterminate spinner), 0–100 = bytes uploaded (shown as a % ring).
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Pick a media file and build a local preview URL (revoking the previous one).
  function onPickFile(f: File | null) {
    // Reset the input value so re-selecting the same file still fires onChange.
    if (fileInputRef.current) fileInputRef.current.value = "";
    // Reject oversized files up front instead of failing after a long upload.
    if (f && f.size > MAX_MEDIA_BYTES) {
      setError(t("mediaTooLarge"));
      return;
    }
    setError(null);
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    const url = f ? URL.createObjectURL(f) : null;
    previewRef.current = url;
    setPreview(url);
    setFile(f);
  }
  // Revoke the object URL when leaving the page.
  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); }, []);

  const [addingTopic, setAddingTopic] = useState(false);
  const [newTopic, setNewTopic] = useState("");

  // Load the question when editing, then prefill the form.
  const { data: editing } = useQuery({
    queryKey: ["question", id],
    queryFn: async () => (await api.get<Question>(`/questions/${id}`)).data,
    enabled: isEdit,
  });

  useEffect(() => {
    if (!editing) return;
    setType(editing.type);
    setTitle(editing.title);
    setInstruction(editing.instruction_text ?? "");
    setPrompt(editing.prompt_text);
    setLevel(editing.level ?? "");
    setTopic(editing.topic ?? "");
    setRuStyle(editing.ru_style ?? "");
    setBlockId(editing.block_id ?? "");
    setAnswerLimit(editing.answer_time_limit_sec);
    setModelAnswer(editing.model_answer_text ?? "");
    setPublish(editing.is_published);
    setExistingMedia(editing.media_url);
  }, [editing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: topics } = useQuery({
    queryKey: ["topics-managed"],
    queryFn: async () => (await api.get<Topic[]>("/topics")).data,
  });

  const { data: blocks } = useQuery({
    queryKey: ["blocks"],
    queryFn: async () => (await api.get<QuestionBlock[]>("/blocks")).data,
  });

  const addTopic = useMutation({
    mutationFn: async (name: string) => (await api.post<Topic>("/topics", { name })).data,
    onSuccess: (tp) => {
      qc.invalidateQueries({ queryKey: ["topics-managed"] });
      qc.invalidateQueries({ queryKey: ["topics"] });
      setTopic(tp.name);
      setNewTopic("");
      setAddingTopic(false);
    },
  });

  const generateModel = useMutation({
    mutationFn: async () =>
      (await api.post<Question>(`/questions/${id}/generate-model-answer`)).data,
    onSuccess: (q) => setModelAnswer(q.model_answer_text ?? ""),
  });

  async function uploadMedia(questionId: string) {
    if (type === "text" || !file) return;
    const ct = file.type || (type === "image" ? "image/jpeg" : "video/mp4");
    const { data: up } = await api.post(`/questions/${questionId}/media-url`, { content_type: ct });
    // Enter the determinate phase and stream real upload progress to the overlay.
    setUploadPct(0);
    await uploadToPresigned(up.upload_url, file, ct, setUploadPct);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // The rich-text prompt is required, but contentEditable can't use native
    // `required`, so validate it (ignoring empty formatting tags) by hand.
    if (isEmptyRich(prompt)) {
      setError(t("instructionRequired"));
      return;
    }
    // Media is required when creating an image/video question.
    if (!isEdit && type !== "text" && !file) {
      setError(t("mediaRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    setUploadPct(null);
    try {
      if (isEdit) {
        await api.patch(`/questions/${id}`, {
          title,
          instruction_text: instruction.trim() || null,
          prompt_text: prompt,
          level: level || null,
          topic: topic || null,
          ru_style: ruStyle || null,
          block_id: blockId || null,
          answer_time_limit_sec: answerLimit,
          model_answer_text: modelAnswer || null,
          is_published: publish,
          is_public: false,
        });
        await uploadMedia(id!); // only if a new file was chosen
      } else {
        const { data: q } = await api.post<Question>("/questions", {
          type,
          title,
          instruction_text: instruction.trim() || null,
          prompt_text: prompt,
          level: level || null,
          topic: topic || null,
          ru_style: ruStyle || null,
          block_id: blockId || null,
          answer_time_limit_sec: answerLimit,
          model_answer_text: modelAnswer || null,
          is_published: publish,
          is_public: false,
          // Admin: attribute to the chosen teacher (backend ignores for non-admins).
          teacher_id: ownerTeacherId || undefined,
        });
        try {
          await uploadMedia(q.id);
        } catch (err) {
          // Media upload failed (e.g. video too large) — delete the orphaned
          // question so retries don't pile up duplicate copies.
          await api.delete(`/questions/${q.id}`).catch(() => {});
          throw err;
        }
      }
      // Refresh every view that could show this question BEFORE navigating back,
      // so the list/detail we return to reflects the save instead of stale cache.
      // refetchType "all" also refetches queries that are currently inactive
      // (the destination list isn't mounted yet), and awaiting lets the fresh
      // data land while the busy overlay is still up.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["questions"], refetchType: "all" }),
        // Assigning/changing block_id shifts a block's question_count.
        qc.invalidateQueries({ queryKey: ["blocks"], refetchType: "all" }),
        qc.invalidateQueries({ queryKey: ["block-questions"], refetchType: "all" }),
        // The edit form itself prefills from this detail query — drop it so
        // reopening the editor doesn't show the pre-save state.
        isEdit ? qc.invalidateQueries({ queryKey: ["question", id], refetchType: "all" }) : null,
      ]);
      nav(returnTo);
    } catch (err) {
      // A 413 from the upload proxy means the file exceeded the size limit.
      const tooLarge = axios.isAxiosError(err) && err.response?.status === 413;
      setError(tooLarge ? t("mediaTooLarge") : t("createError"));
      setBusy(false);
      setUploadPct(null);
    }
  }

  const typeOptions: { value: QuestionType; label: string }[] = [
    { value: "text", label: t("typeText") },
    { value: "image", label: t("typeImage") },
    { value: "video", label: t("typeVideo") },
  ];

  return (
    <div className="focus-wrap anim-fade-up" style={{ maxWidth: 920, marginInline: "auto" }}>
      {/* Blocking progress overlay — gives clear feedback during the (possibly
          slow) media upload so the teacher waits instead of re-clicking. */}
      {busy && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 200,
            background: "oklch(0.30 0.02 60 / 0.45)", backdropFilter: "blur(2px)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
          }}
        >
          <div
            className="anim-pop"
            style={{
              background: "var(--surface)", borderRadius: "var(--r-lg)", boxShadow: "var(--sh-lg)",
              padding: "30px 34px", width: "100%", maxWidth: 320,
              display: "flex", flexDirection: "column", alignItems: "center", gap: 16,
            }}
          >
            {uploadPct === null ? (
              <div
                style={{
                  width: 64, height: 64, borderRadius: "50%",
                  border: "5px solid var(--surface-3)", borderTopColor: "var(--primary)",
                  animation: "spin 0.8s linear infinite",
                }}
              />
            ) : (
              (() => {
                const R = 50.5;
                const C = 2 * Math.PI * R;
                const off = C * (1 - uploadPct / 100);
                return (
                  <div style={{ position: "relative", width: 110, height: 110 }}>
                    <svg width="110" height="110" style={{ transform: "rotate(-90deg)" }}>
                      <circle cx="55" cy="55" r={R} fill="none" stroke="var(--surface-3)" strokeWidth="9" />
                      <circle
                        cx="55" cy="55" r={R} fill="none" stroke="var(--primary)" strokeWidth="9"
                        strokeLinecap="round" strokeDasharray={C} strokeDashoffset={off}
                        style={{ transition: "stroke-dashoffset 0.2s ease" }}
                      />
                    </svg>
                    <span
                      style={{
                        position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
                        fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 22, color: "var(--ink)",
                      }}
                    >
                      {uploadPct}%
                    </span>
                  </div>
                );
              })()
            )}
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 15.5, color: "var(--ink-soft)" }}>
              {uploadPct !== null && uploadPct < 100 ? t("uploadingMedia") : t("saving")}
            </span>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        </div>
      )}
      <Button variant="ghost" size="sm" icon="chevL" onClick={() => nav(-1)} style={{ marginBottom: 16 }}>
        {t("back")}
      </Button>
      <h2 style={{ fontSize: 24, marginBottom: 4 }}>{isEdit ? t("editTest") : t("newTest")}</h2>
      <p style={{ color: "var(--muted)", fontSize: 15, marginBottom: 20 }}>{t("testType")}</p>

      <form onSubmit={submit} className="col gap-4">
        {/* Type picker (only when creating — type is immutable on edit) */}
        <div className="g3">
          {typeOptions.map((opt) => {
            const meta = TYPE_META[opt.value];
            const active = type === opt.value;
            const disabled = isEdit && type !== opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => !isEdit && setType(opt.value)}
                className="tap"
                disabled={disabled}
                style={{
                  padding: 18,
                  borderRadius: "var(--r-md)",
                  textAlign: "left",
                  cursor: isEdit ? "default" : "pointer",
                  opacity: disabled ? 0.4 : 1,
                  border: active
                    ? `2px solid oklch(0.7 0.16 ${meta.hue})`
                    : "2px solid var(--line)",
                  background: active ? `oklch(0.97 0.03 ${meta.hue})` : "var(--surface)",
                }}
              >
                <div
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 12,
                    background: `oklch(0.94 0.06 ${meta.hue})`,
                    color: `oklch(0.5 0.15 ${meta.hue})`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 12,
                  }}
                >
                  <Icon name={meta.icon} size={21} />
                </div>
                <div style={{ fontWeight: 800, fontFamily: "var(--font-display)", fontSize: 15.5 }}>
                  {opt.label}
                </div>
              </button>
            );
          })}
        </div>

        <Card>
          <div className="col gap-4">
            {/* Admin creates content on behalf of a chosen teacher. */}
            {!isEdit && (
              <AdminTeacherPicker
                value={ownerTeacherId}
                onChange={(id) => {
                  setOwnerTeacherId(id);
                  // Module list is teacher-scoped — drop a now-mismatched pick.
                  setBlockId("");
                }}
              />
            )}
            {type !== "text" && (
              <>
              {/* The hidden file input lives OUTSIDE <Field>'s <label>. When it sat
                  inside the label, a single click on the drop-zone fired both our
                  onClick (which calls input.click()) AND the label's native "activate
                  the control" behavior — opening the file picker twice, so the user
                  had to choose a file on every attempt. Keeping it outside the label
                  leaves exactly one trigger. */}
              <input
                ref={fileInputRef}
                type="file"
                accept={type === "image" ? "image/*" : "video/*"}
                onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
                style={{ display: "none" }}
              />
              <Field label={type === "image" ? t("mediaImage") : t("mediaVideo")}>
                {(() => {
                  const hue = TYPE_META[type].hue;
                  // What to show inside the drop-zone: new file preview > existing media > empty hint.
                  const showNew = !!file && !!preview;
                  const showExisting = !showNew && isEdit && !!existingMedia;
                  const src = showNew ? preview! : showExisting ? existingMedia! : null;
                  return (
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => fileInputRef.current?.click()}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            fileInputRef.current?.click();
                          }
                        }}
                        className="tap"
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 8,
                          minHeight: src ? "auto" : 150,
                          padding: src ? 12 : 20,
                          textAlign: "center",
                          cursor: "pointer",
                          borderRadius: "var(--r-md)",
                          border: `2px dashed oklch(0.78 0.1 ${hue})`,
                          background: `oklch(0.975 0.02 ${hue})`,
                          color: "var(--ink-soft)",
                        }}
                      >
                        {src ? (
                          <>
                            {type === "image" ? (
                              showNew ? (
                                // Fresh local pick — an instant object-URL blob.
                                <img src={src} alt="" style={{ maxHeight: 200, maxWidth: "100%", borderRadius: "var(--r-sm)", objectFit: "contain" }} />
                              ) : (
                                // Existing media is a remote presigned URL that can
                                // stall/fail on slow networks — load it resiliently.
                                // Stop clicks here from also opening the file picker;
                                // the "change file" label below still does that.
                                <div onClick={(e) => e.stopPropagation()}>
                                  <MediaImage
                                    src={src}
                                    style={{ maxHeight: 200, maxWidth: "100%", borderRadius: "var(--r-sm)", objectFit: "contain" }}
                                  />
                                </div>
                              )
                            ) : (
                              <video src={src} style={{ maxHeight: 200, maxWidth: "100%", borderRadius: "var(--r-sm)" }} controls onClick={(e) => e.stopPropagation()} />
                            )}
                            <span className="row gap-2" style={{ fontSize: 13, fontWeight: 800, color: `oklch(0.5 0.15 ${hue})` }}>
                              <Icon name="refresh" size={15} />
                              {file?.name ?? t("changeMedia")}
                            </span>
                          </>
                        ) : (
                          <>
                            <div style={{ width: 52, height: 52, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: `oklch(0.93 0.06 ${hue})`, color: `oklch(0.5 0.15 ${hue})` }}>
                              <Icon name={type === "image" ? "image" : "play"} size={26} />
                            </div>
                            <span style={{ fontSize: 15, fontWeight: 800, fontFamily: "var(--font-display)", color: "var(--ink)" }}>
                              {t("uploadMedia")}
                            </span>
                            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
                              {type === "image" ? "PNG, JPG · " : "MP4 · "}{t("uploadHint")}
                            </span>
                          </>
                        )}
                      </div>
                  );
                })()}
              </Field>
              </>
            )}

            <Field label={t("title")}>
              <input
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("titlePh")}
                style={inp}
              />
            </Field>

            <Field label={t("taskCondition")}>
              <textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder={t("taskConditionPh")}
                rows={2}
                style={{ ...inp, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
              />
            </Field>

            <Field label={t("taskText")} as="div">
              <RichTextEditor
                value={prompt}
                onChange={setPrompt}
                placeholder={t("instructionPh")}
                minHeight={260}
              />
            </Field>

            <Field
              label={
                <div className="row between">
                  <span>{t("modelAnswerField")}</span>
                  {isEdit && (
                    <button
                      type="button"
                      disabled={generateModel.isPending}
                      onClick={() => generateModel.mutate()}
                      className="row gap-1 tap"
                      style={{
                        border: "none",
                        background: "var(--grape-tint)",
                        color: "var(--grape)",
                        fontWeight: 800,
                        fontFamily: "var(--font-display)",
                        fontSize: 12.5,
                        padding: "5px 11px",
                        borderRadius: 999,
                        cursor: generateModel.isPending ? "not-allowed" : "pointer",
                        opacity: generateModel.isPending ? 0.6 : 1,
                      }}
                    >
                      <Icon name="sparkles" size={14} />
                      {generateModel.isPending ? t("generating") : t("generateAi")}
                    </button>
                  )}
                </div>
              }
            >
              <textarea
                rows={3}
                value={modelAnswer}
                onChange={(e) => setModelAnswer(e.target.value)}
                placeholder={t("modelAnswerPh")}
                style={inp}
              />
            </Field>

            <div className="g2">
              <Field label={t("levelCefr")}>
                <select value={level} onChange={(e) => setLevel(e.target.value)} style={inp}>
                  <option value="">—</option>
                  {LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("answerLimit")}>
                <input
                  type="number"
                  min={30}
                  max={600}
                  value={answerLimit}
                  onChange={(e) => setAnswerLimit(Number(e.target.value))}
                  style={inp}
                />
              </Field>
            </div>

            <Field label={t("topic")}>
              {addingTopic ? (
                <div className="row gap-2 wrap">
                  <input
                    autoFocus
                    value={newTopic}
                    onChange={(e) => setNewTopic(e.target.value)}
                    placeholder={t("topicNamePh")}
                    style={{ ...inp, flex: 1 }}
                  />
                  <Button
                    disabled={!newTopic.trim() || addTopic.isPending}
                    onClick={() => addTopic.mutate(newTopic.trim())}
                  >
                    {t("addTopic")}
                  </Button>
                  <Button variant="ghost" onClick={() => setAddingTopic(false)}>
                    {t("cancel")}
                  </Button>
                </div>
              ) : (
                <>
                  <select value={topic} onChange={(e) => setTopic(e.target.value)} style={inp}>
                    <option value="">— {t("selectTopic")} —</option>
                    {(topics ?? []).map((tp) => (
                      <option key={tp.id} value={tp.name}>
                        {tp.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setAddingTopic(true)}
                    className="tap"
                    style={{
                      border: "none",
                      background: "transparent",
                      color: "var(--primary-press)",
                      fontWeight: 800,
                      fontFamily: "var(--font-display)",
                      fontSize: 13.5,
                      marginTop: 6,
                      cursor: "pointer",
                      alignSelf: "flex-start",
                      padding: 0,
                    }}
                  >
                    {t("newTopicInline")}
                  </button>
                </>
              )}
            </Field>

            <div className="g2">
              <Field label={t("ruStyle")}>
                <select
                  value={ruStyle}
                  onChange={(e) => setRuStyle(e.target.value as "" | RuStyle)}
                  style={inp}
                >
                  <option value="">—</option>
                  <option value="regular">{t("ruRegular")}</option>
                  <option value="live">{t("ruLive")}</option>
                </select>
              </Field>
              <Field label={t("navBlocks")}>
                <select value={blockId} onChange={(e) => setBlockId(e.target.value)} style={inp}>
                  <option value="">— {t("noBlock")} —</option>
                  {(blocks ?? [])
                    // Admin picked a teacher → only show that teacher's modules.
                    .filter((b) => !(isAdmin && ownerTeacherId) || b.teacher_id === ownerTeacherId)
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                </select>
              </Field>
            </div>

            <label
              className="row between"
              style={{
                background: "var(--surface-2)",
                borderRadius: "var(--r-sm)",
                padding: "13px 16px",
                cursor: "pointer",
              }}
            >
              <span style={{ fontSize: 15, fontWeight: 700 }}>{t("publishNow")}</span>
              <Toggle on={publish} set={setPublish} />
            </label>
          </div>

          {error && (
            <p style={{ color: "var(--danger)", fontSize: 13.5, fontWeight: 700, marginTop: 14 }}>
              {error}
            </p>
          )}

          <div className="row gap-3 between" style={{ marginTop: 20 }}>
            <Button variant="ghost" onClick={() => nav(-1)}>
              {t("cancel")}
            </Button>
            <Button icon="check" type="submit" disabled={busy}>
              {busy ? t("saving") : isEdit ? t("save") : t("create")}
            </Button>
          </div>
        </Card>
      </form>
    </div>
  );
}
