import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import type { AiSettings, AiTestResult, SecretState } from "../lib/types";
import type { OutboundLinks } from "../lib/contact";
import { Button, Card, Field, Icon, Loading, PageHead, SectionTitle, Toggle, inp } from "../components/govori";

export function AdminSettings() {
  const { t } = useI18n();

  const ai = useQuery({
    queryKey: ["ai-settings"],
    queryFn: async () => (await api.get<AiSettings>("/admin/settings/ai")).data,
    retry: false,
  });
  const links = useQuery({
    queryKey: ["admin-links"],
    queryFn: async () => (await api.get<OutboundLinks>("/admin/settings/links")).data,
    retry: false,
  });

  if (ai.isLoading || links.isLoading) return <Loading full />;

  return (
    <div className="focus-wrap">
      <PageHead title={t("settingsAiTitle")} sub={t("settingsAiHint")} />
      {ai.isError || !ai.data ? (
        <Card style={{ marginBottom: 16 }}>
          <p style={{ color: "var(--danger)", fontWeight: 700, margin: 0 }}>{t("settingsLoadError")}</p>
          <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 6 }}>{t("settingsLoadHint")}</p>
        </Card>
      ) : (
        <AiSection data={ai.data} />
      )}

      {!links.isError && links.data && <LinksSection data={links.data} />}
    </div>
  );
}

/** A masked API-key input. When a key is stored it shows persistent dots; the
 * eye reveals/edits the real key (fetched on demand). Revealing is NOT an edit —
 * `onReveal` sets both the value and its baseline so the field stays "unchanged"
 * until the admin actually types. */
function SecretInput({
  settingKey,
  state,
  value,
  onChange,
  onReveal,
}: {
  settingKey: string;
  state: SecretState;
  value: string;
  onChange: (v: string) => void;
  onReveal: (raw: string) => void;
}) {
  const { t } = useI18n();
  const [revealed, setRevealed] = useState(false);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const masked = !revealed && value === "" && state.set;

  async function onEye() {
    if (masked) {
      try {
        setLoading(true);
        const { data } = await api.get<{ value: string }>(`/admin/settings/reveal/${settingKey}`);
        onReveal(data.value);
        setRevealed(true);
        setVisible(true);
      } finally {
        setLoading(false);
      }
    } else {
      setVisible((v) => !v);
    }
  }

  return (
    <div className="col gap-1">
      <div style={{ position: "relative" }}>
        <input
          type={masked || !visible ? "password" : "text"}
          autoComplete="new-password"
          readOnly={masked}
          value={masked ? "••••••••••••" : value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={state.set ? "" : t("aiKeyUnset")}
          style={{ ...inp, paddingRight: 42 }}
        />
        <button
          type="button"
          onClick={onEye}
          disabled={loading}
          title={t("view")}
          aria-label={t("view")}
          style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)", padding: 6, display: "flex" }}
        >
          <Icon name={visible && !masked ? "eyeOff" : "eye"} size={18} />
        </button>
      </div>
      <span style={{ fontSize: 12, color: "var(--faint)" }}>
        {state.set ? `•••• ${state.hint} — ${t("aiKeyKeep")}` : t("aiKeyUnset")}
      </span>
    </div>
  );
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      style={{
        fontSize: 13,
        fontWeight: 700,
        padding: "6px 12px",
        borderRadius: 999,
        background: ok ? "var(--primary-tint)" : "var(--surface-2)",
        color: ok ? "var(--primary-press)" : "var(--muted)",
      }}
    >
      {label}
    </span>
  );
}

/** A short hint line under a field. */
function Hint({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: 12.5, color: "var(--faint)", lineHeight: 1.5 }}>{children}</span>;
}

function SaveRow({ dirty, pending, saved, error, t }: { dirty: boolean; pending: boolean; saved: boolean; error: boolean; t: (k: string) => string }) {
  return (
    <div className="row gap-3" style={{ alignItems: "center" }}>
      <Button type="submit" icon="check" disabled={pending || !dirty}>
        {pending ? "…" : t("save")}
      </Button>
      {saved && <span style={{ color: "var(--primary-press)", fontWeight: 700 }}>{t("savedOk")}</span>}
      {error && <span style={{ color: "var(--danger)", fontWeight: 700 }}>{t("registerError")}</span>}
    </div>
  );
}

/** Live grader connectivity test — the key diagnostic for rate-limit problems. */
function TestConnection() {
  const { t } = useI18n();
  const test = useMutation({
    mutationFn: async () => (await api.post<AiTestResult>("/admin/settings/ai/test")).data,
  });
  const r = test.data;

  return (
    <div className="col gap-3">
      <div className="row between wrap gap-3" style={{ alignItems: "center" }}>
        <span style={{ fontSize: 15, fontWeight: 800 }}>{t("testConn")}</span>
        <Button variant="soft" icon="refresh" onClick={() => test.mutate()} disabled={test.isPending}>
          {test.isPending ? t("testConnRunning") : t("testConn")}
        </Button>
      </div>

      {r && (
        <div
          className="col gap-2"
          style={{
            padding: "12px 14px",
            borderRadius: "var(--r-sm)",
            border: `1px solid ${r.ok ? "var(--success)" : "var(--danger)"}`,
            background: r.ok ? "oklch(0.95 0.05 152 / 0.5)" : "var(--danger-tint)",
          }}
        >
          <div className="row gap-2 wrap" style={{ alignItems: "center" }}>
            <span
              className="row gap-1"
              style={{
                alignItems: "center",
                fontSize: 13,
                fontWeight: 800,
                padding: "4px 10px",
                borderRadius: 999,
                color: "#fff",
                background: r.ok ? "var(--success)" : "var(--danger)",
              }}
            >
              <Icon name={r.ok ? "check" : "x"} size={14} sw={2.6} />
              {r.ok ? t("testConnOk") : t("testConnFail")}
            </span>
            <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>
              <b>{t("testConnProvider")}:</b> {r.provider || "—"}
            </span>
            <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>
              <b>{t("testConnModel")}:</b> {r.model || "—"}
            </span>
            <span className="mono" style={{ fontSize: 13, color: "var(--ink-soft)" }}>
              <b>{t("testConnLatency")}:</b> {r.latency_ms} ms
            </span>
          </div>
          {!r.ok && r.error && (
            <span className="mono" style={{ fontSize: 12.5, color: "var(--danger)", wordBreak: "break-word" }}>
              {r.error}
            </span>
          )}
        </div>
      )}
      {test.isError && (
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--danger)" }}>{t("testConnFail")}</span>
      )}
    </div>
  );
}

/** Full AI form (grader + speech-to-text). Secrets start empty. */
interface AiForm {
  llm_provider: string;
  gemini_model: string;
  gemini_api_key: string;
  azure_openai_endpoint: string;
  azure_openai_deployment: string;
  azure_openai_api_version: string;
  azure_openai_api_key: string;
  orthoepy_enabled: boolean;
  stt_provider: string;
  azure_speech_region: string;
  whisper_model: string;
  azure_speech_key: string;
  openai_api_key: string;
}

type SecretKey = "gemini_api_key" | "azure_openai_api_key" | "azure_speech_key" | "openai_api_key";

function AiSection({ data }: { data: AiSettings }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const known = data.known_gemini_models ?? [];
  const [form, setForm] = useState<AiForm>({
    llm_provider: data.llm_provider,
    gemini_model: data.gemini_model,
    gemini_api_key: "",
    azure_openai_endpoint: data.azure_openai_endpoint,
    azure_openai_deployment: data.azure_openai_deployment,
    azure_openai_api_version: data.azure_openai_api_version,
    azure_openai_api_key: "",
    orthoepy_enabled: data.orthoepy_enabled,
    stt_provider: data.stt_provider,
    azure_speech_region: data.azure_speech_region,
    whisper_model: data.whisper_model,
    azure_speech_key: "",
    openai_api_key: "",
  });
  // Model picker: "custom" reveals the free-text input for any new/unknown id.
  const [customModel, setCustomModel] = useState(() => !known.some((m) => m.id === data.gemini_model));
  // Baseline for each secret: "" normally, or the revealed value (so a reveal
  // isn't treated as an edit). A secret is "changed" iff form !== baseline.
  const [baseline, setBaseline] = useState<Record<SecretKey, string>>({
    gemini_api_key: "",
    azure_openai_api_key: "",
    azure_speech_key: "",
    openai_api_key: "",
  });
  const [saved, setSaved] = useState(false);

  const nonSecretDirty =
    form.llm_provider !== data.llm_provider ||
    form.gemini_model !== data.gemini_model ||
    form.azure_openai_endpoint !== data.azure_openai_endpoint ||
    form.azure_openai_deployment !== data.azure_openai_deployment ||
    form.azure_openai_api_version !== data.azure_openai_api_version ||
    form.orthoepy_enabled !== data.orthoepy_enabled ||
    form.stt_provider !== data.stt_provider ||
    form.azure_speech_region !== data.azure_speech_region ||
    form.whisper_model !== data.whisper_model;
  const secretsDirty =
    form.gemini_api_key !== baseline.gemini_api_key ||
    form.azure_openai_api_key !== baseline.azure_openai_api_key ||
    form.azure_speech_key !== baseline.azure_speech_key ||
    form.openai_api_key !== baseline.openai_api_key;
  const dirty = nonSecretDirty || secretsDirty;

  const save = useMutation({
    mutationFn: async () => {
      const p: Record<string, string> = {};
      if (form.llm_provider !== data.llm_provider) p.llm_provider = form.llm_provider;
      if (form.gemini_model !== data.gemini_model) p.gemini_model = form.gemini_model;
      if (form.azure_openai_endpoint !== data.azure_openai_endpoint) p.azure_openai_endpoint = form.azure_openai_endpoint;
      if (form.azure_openai_deployment !== data.azure_openai_deployment) p.azure_openai_deployment = form.azure_openai_deployment;
      if (form.azure_openai_api_version !== data.azure_openai_api_version) p.azure_openai_api_version = form.azure_openai_api_version;
      if (form.orthoepy_enabled !== data.orthoepy_enabled) p.orthoepy_enabled = form.orthoepy_enabled ? "true" : "false";
      if (form.stt_provider !== data.stt_provider) p.stt_provider = form.stt_provider;
      if (form.azure_speech_region !== data.azure_speech_region) p.azure_speech_region = form.azure_speech_region;
      if (form.whisper_model !== data.whisper_model) p.whisper_model = form.whisper_model;
      if (form.gemini_api_key !== baseline.gemini_api_key) p.gemini_api_key = form.gemini_api_key;
      if (form.azure_openai_api_key !== baseline.azure_openai_api_key) p.azure_openai_api_key = form.azure_openai_api_key;
      if (form.azure_speech_key !== baseline.azure_speech_key) p.azure_speech_key = form.azure_speech_key;
      if (form.openai_api_key !== baseline.openai_api_key) p.openai_api_key = form.openai_api_key;
      return (await api.patch<AiSettings>("/admin/settings/ai", p)).data;
    },
    onSuccess: (fresh) => {
      qc.setQueryData(["ai-settings"], fresh);
      setForm((prev) => ({ ...prev, gemini_api_key: "", azure_openai_api_key: "", azure_speech_key: "", openai_api_key: "" }));
      setBaseline({ gemini_api_key: "", azure_openai_api_key: "", azure_speech_key: "", openai_api_key: "" });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  const set = (k: keyof AiForm, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));
  const reveal = (k: SecretKey, raw: string) => {
    setForm((f) => ({ ...f, [k]: raw }));
    setBaseline((b) => ({ ...b, [k]: raw }));
  };

  // Currently selected known model (for the note hint under the picker).
  const selectedKnown = known.find((m) => m.id === form.gemini_model);
  const pickerValue = customModel ? "__custom__" : form.gemini_model;

  const onPickModel = (v: string) => {
    if (v === "__custom__") {
      setCustomModel(true);
    } else {
      setCustomModel(false);
      set("gemini_model", v);
    }
  };

  return (
    <form
      className="col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty && !save.isPending) save.mutate();
      }}
    >
      {/* ── AI grader: active provider + live connection test ── */}
      <Card>
        <div className="col gap-4">
          <div className="row between wrap gap-4" style={{ alignItems: "center" }}>
            <div className="col gap-1">
              <span style={{ fontSize: 12, fontWeight: 800, color: "var(--faint)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {t("aiActiveNow")}
              </span>
              <span style={{ fontSize: 20, fontWeight: 800 }}>
                {data.active_provider === "azure" ? "Azure OpenAI" : "Gemini"}
              </span>
            </div>
            <StatusBadge ok={data.azure_ready} label={data.azure_ready ? t("aiAzureReady") : t("aiAzureNotReady")} />
          </div>
          <div style={{ height: 1, background: "var(--line)" }} />
          <TestConnection />
        </div>
      </Card>

      <Card>
        <Field label={t("aiProvider")}>
          <select value={form.llm_provider} onChange={(e) => set("llm_provider", e.target.value)} style={inp}>
            <option value="auto">{t("aiProviderAuto")}</option>
            <option value="azure">{t("aiProviderAzure")}</option>
            <option value="gemini">{t("aiProviderGemini")}</option>
          </select>
        </Field>
      </Card>

      <Card>
        <SectionTitle>Google Gemini</SectionTitle>
        <div className="col gap-4">
          <Field label={t("geminiModel")}>
            <div className="col gap-2">
              <select value={pickerValue} onChange={(e) => onPickModel(e.target.value)} style={inp}>
                {known.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
                <option value="__custom__">{t("geminiModelCustom")}</option>
              </select>
              {customModel && (
                <input
                  value={form.gemini_model}
                  onChange={(e) => set("gemini_model", e.target.value)}
                  placeholder="gemini-2.5-flash"
                  style={inp}
                />
              )}
              {!customModel && selectedKnown?.note && <Hint>{selectedKnown.note}</Hint>}
            </div>
          </Field>
          <Field label={t("geminiApiKey")}>
            <SecretInput settingKey="gemini_api_key" state={data.gemini_api_key} value={form.gemini_api_key} onChange={(v) => set("gemini_api_key", v)} onReveal={(r) => reveal("gemini_api_key", r)} />
          </Field>
        </div>
      </Card>

      <Card>
        <SectionTitle>Azure OpenAI</SectionTitle>
        <div className="col gap-4">
          <Field label={t("azureEndpoint")}>
            <input value={form.azure_openai_endpoint} onChange={(e) => set("azure_openai_endpoint", e.target.value)} placeholder="https://<resource>.openai.azure.com" style={inp} />
          </Field>
          <Field label={t("azureDeployment")}>
            <input value={form.azure_openai_deployment} onChange={(e) => set("azure_openai_deployment", e.target.value)} placeholder="gpt-4o" style={inp} />
          </Field>
          <Field label={t("azureApiVersion")}>
            <input value={form.azure_openai_api_version} onChange={(e) => set("azure_openai_api_version", e.target.value)} placeholder="2024-10-21" style={inp} />
          </Field>
          <Field label={t("azureApiKey")}>
            <SecretInput settingKey="azure_openai_api_key" state={data.azure_openai_api_key} value={form.azure_openai_api_key} onChange={(v) => set("azure_openai_api_key", v)} onReveal={(r) => reveal("azure_openai_api_key", r)} />
          </Field>
        </div>
      </Card>

      {/* ── Orthoepy toggle — one fewer AI call per answer when off ── */}
      <Card>
        <div className="row between gap-4" style={{ alignItems: "flex-start" }}>
          <div className="col gap-1" style={{ minWidth: 0 }}>
            <span style={{ fontSize: 14.5, fontWeight: 800, color: "var(--ink-soft)" }}>{t("orthoepyLabel")}</span>
            <Hint>{t("orthoepyToggleHint")}</Hint>
          </div>
          <Toggle on={form.orthoepy_enabled} set={(v) => set("orthoepy_enabled", v)} />
        </div>
      </Card>

      {/* ── Speech-to-text ── */}
      <div style={{ marginTop: 10 }}>
        <SectionTitle>{t("sttTitle")}</SectionTitle>
      </div>
      <Card>
        <div className="row gap-4 wrap" style={{ alignItems: "center" }}>
          <div className="col gap-1">
            <span style={{ fontSize: 12, fontWeight: 800, color: "var(--faint)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {t("aiActiveNow")}
            </span>
            <span style={{ fontSize: 20, fontWeight: 800 }}>
              {data.stt_active_provider === "azure" ? "Azure Speech" : data.stt_active_provider === "whisper" ? "Whisper" : "—"}
            </span>
          </div>
          <StatusBadge ok={data.azure_speech_ready} label={data.azure_speech_ready ? t("azureSpeechReady") : t("azureSpeechNotReady")} />
        </div>
      </Card>

      <Card>
        <Field label={t("sttProvider")}>
          <select value={form.stt_provider} onChange={(e) => set("stt_provider", e.target.value)} style={inp}>
            <option value="auto">{t("sttAuto")}</option>
            <option value="azure">{t("sttAzure")}</option>
            <option value="whisper">{t("sttWhisper")}</option>
          </select>
        </Field>
      </Card>

      <Card>
        <SectionTitle>Azure Speech</SectionTitle>
        <div className="col gap-4">
          <Field label={t("azureSpeechRegion")}>
            <input value={form.azure_speech_region} onChange={(e) => set("azure_speech_region", e.target.value)} placeholder="eastus" style={inp} />
          </Field>
          <Field label={t("azureSpeechKey")}>
            <SecretInput settingKey="azure_speech_key" state={data.azure_speech_key} value={form.azure_speech_key} onChange={(v) => set("azure_speech_key", v)} onReveal={(r) => reveal("azure_speech_key", r)} />
          </Field>
        </div>
      </Card>

      <Card>
        <SectionTitle>OpenAI Whisper</SectionTitle>
        <div className="col gap-4">
          <Field label={t("whisperModel")}>
            <input value={form.whisper_model} onChange={(e) => set("whisper_model", e.target.value)} placeholder="whisper-1" style={inp} />
          </Field>
          <Field label={t("openaiKey")}>
            <SecretInput settingKey="openai_api_key" state={data.openai_api_key} value={form.openai_api_key} onChange={(v) => set("openai_api_key", v)} onReveal={(r) => reveal("openai_api_key", r)} />
          </Field>
        </div>
      </Card>

      <SaveRow dirty={dirty} pending={save.isPending} saved={saved} error={save.isError} t={t} />
    </form>
  );
}

function LinksSection({ data }: { data: OutboundLinks }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [form, setForm] = useState<OutboundLinks>(data);
  const [saved, setSaved] = useState(false);

  const dirty = form.tg_support_url !== data.tg_support_url || form.tg_channel_url !== data.tg_channel_url;

  const save = useMutation({
    mutationFn: async () => (await api.patch<OutboundLinks>("/admin/settings/links", form)).data,
    onSuccess: (fresh) => {
      qc.setQueryData(["admin-links"], fresh);
      qc.invalidateQueries({ queryKey: ["outbound-links"] });
      setForm(fresh);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  return (
    <form
      className="col gap-4"
      style={{ marginTop: 28 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty && !save.isPending) save.mutate();
      }}
    >
      <div>
        <SectionTitle>{t("linksTitle")}</SectionTitle>
        <p style={{ color: "var(--muted)", fontSize: 14, margin: "-8px 0 0" }}>{t("linksHint")}</p>
      </div>
      <Card>
        <div className="col gap-4">
          <Field label={t("tgSupport")}>
            <input value={form.tg_support_url} onChange={(e) => setForm({ ...form, tg_support_url: e.target.value })} placeholder="https://t.me/..." style={inp} />
          </Field>
          <Field label={t("tgChannel")}>
            <input value={form.tg_channel_url} onChange={(e) => setForm({ ...form, tg_channel_url: e.target.value })} placeholder="https://t.me/..." style={inp} />
          </Field>
        </div>
      </Card>
      <SaveRow dirty={dirty} pending={save.isPending} saved={saved} error={save.isError} t={t} />
    </form>
  );
}
