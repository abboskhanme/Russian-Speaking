import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import type { AiSettings, SecretState } from "../lib/types";
import type { OutboundLinks } from "../lib/contact";
import { Button, Card, Field, Icon, Loading, PageHead, inp } from "../components/govori";

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

/** A masked API-key input. When a key is already stored, it persistently shows
 * dots; focusing clears it so the admin can type a new one. A blank field on
 * save keeps the stored value untouched. */
function SecretInput({ settingKey, state, value, onChange }: { settingKey: string; state: SecretState; value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  const [revealed, setRevealed] = useState(false);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  // Masked resting state: a key is stored and the admin hasn't revealed/typed.
  const masked = !revealed && value === "" && state.set;

  async function onEye() {
    if (masked) {
      // Fetch the stored key so it can be viewed and edited.
      try {
        setLoading(true);
        const { data } = await api.get<{ value: string }>(`/admin/settings/reveal/${settingKey}`);
        onChange(data.value);
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

/** Full AI form (grader + speech-to-text). Secrets start empty. */
interface AiForm {
  llm_provider: string;
  gemini_model: string;
  gemini_api_key: string;
  azure_openai_endpoint: string;
  azure_openai_deployment: string;
  azure_openai_api_version: string;
  azure_openai_api_key: string;
  stt_provider: string;
  azure_speech_region: string;
  whisper_model: string;
  azure_speech_key: string;
  openai_api_key: string;
}

function AiSection({ data }: { data: AiSettings }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [form, setForm] = useState<AiForm>({
    llm_provider: data.llm_provider,
    gemini_model: data.gemini_model,
    gemini_api_key: "",
    azure_openai_endpoint: data.azure_openai_endpoint,
    azure_openai_deployment: data.azure_openai_deployment,
    azure_openai_api_version: data.azure_openai_api_version,
    azure_openai_api_key: "",
    stt_provider: data.stt_provider,
    azure_speech_region: data.azure_speech_region,
    whisper_model: data.whisper_model,
    azure_speech_key: "",
    openai_api_key: "",
  });
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: async () => {
      const payload: Record<string, string> = {
        llm_provider: form.llm_provider,
        gemini_model: form.gemini_model,
        azure_openai_endpoint: form.azure_openai_endpoint,
        azure_openai_deployment: form.azure_openai_deployment,
        azure_openai_api_version: form.azure_openai_api_version,
        stt_provider: form.stt_provider,
        azure_speech_region: form.azure_speech_region,
        whisper_model: form.whisper_model,
      };
      // Secrets: only send the ones the admin actually typed.
      if (form.gemini_api_key) payload.gemini_api_key = form.gemini_api_key;
      if (form.azure_openai_api_key) payload.azure_openai_api_key = form.azure_openai_api_key;
      if (form.azure_speech_key) payload.azure_speech_key = form.azure_speech_key;
      if (form.openai_api_key) payload.openai_api_key = form.openai_api_key;
      return (await api.patch<AiSettings>("/admin/settings/ai", payload)).data;
    },
    onSuccess: (fresh) => {
      qc.setQueryData(["ai-settings"], fresh);
      setForm((p) => ({ ...p, gemini_api_key: "", azure_openai_api_key: "", azure_speech_key: "", openai_api_key: "" }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  const set = (k: keyof AiForm, v: string) => setForm({ ...form, [k]: v });

  return (
    <form
      className="col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!save.isPending) save.mutate();
      }}
    >
      {/* ── AI grader ── */}
      <Card>
        <div className="row gap-4 wrap" style={{ alignItems: "center" }}>
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
        <h3 style={{ fontSize: 16, marginBottom: 14 }}>Azure OpenAI</h3>
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
            <SecretInput settingKey="azure_openai_api_key" state={data.azure_openai_api_key} value={form.azure_openai_api_key} onChange={(v) => set("azure_openai_api_key", v)} />
          </Field>
        </div>
      </Card>

      <Card>
        <h3 style={{ fontSize: 16, marginBottom: 14 }}>Google Gemini</h3>
        <div className="col gap-4">
          <Field label={t("geminiModel")}>
            <input value={form.gemini_model} onChange={(e) => set("gemini_model", e.target.value)} placeholder="gemini-2.5-flash" style={inp} />
          </Field>
          <Field label={t("geminiApiKey")}>
            <SecretInput settingKey="gemini_api_key" state={data.gemini_api_key} value={form.gemini_api_key} onChange={(v) => set("gemini_api_key", v)} />
          </Field>
        </div>
      </Card>

      {/* ── Speech-to-text ── */}
      <div style={{ marginTop: 10 }}>
        <h2 style={{ fontSize: 20 }}>{t("sttTitle")}</h2>
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
        <h3 style={{ fontSize: 16, marginBottom: 14 }}>Azure Speech</h3>
        <div className="col gap-4">
          <Field label={t("azureSpeechRegion")}>
            <input value={form.azure_speech_region} onChange={(e) => set("azure_speech_region", e.target.value)} placeholder="eastus" style={inp} />
          </Field>
          <Field label={t("azureSpeechKey")}>
            <SecretInput settingKey="azure_speech_key" state={data.azure_speech_key} value={form.azure_speech_key} onChange={(v) => set("azure_speech_key", v)} />
          </Field>
        </div>
      </Card>

      <Card>
        <h3 style={{ fontSize: 16, marginBottom: 14 }}>OpenAI Whisper</h3>
        <div className="col gap-4">
          <Field label={t("whisperModel")}>
            <input value={form.whisper_model} onChange={(e) => set("whisper_model", e.target.value)} placeholder="whisper-1" style={inp} />
          </Field>
          <Field label={t("openaiKey")}>
            <SecretInput settingKey="openai_api_key" state={data.openai_api_key} value={form.openai_api_key} onChange={(v) => set("openai_api_key", v)} />
          </Field>
        </div>
      </Card>

      <div className="row gap-3" style={{ alignItems: "center" }}>
        <Button type="submit" icon="check" disabled={save.isPending}>
          {save.isPending ? "…" : t("save")}
        </Button>
        {saved && <span style={{ color: "var(--primary-press)", fontWeight: 700 }}>{t("savedOk")}</span>}
        {save.isError && <span style={{ color: "var(--danger)", fontWeight: 700 }}>{t("registerError")}</span>}
      </div>
    </form>
  );
}

function LinksSection({ data }: { data: OutboundLinks }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [form, setForm] = useState<OutboundLinks>(data);
  const [saved, setSaved] = useState(false);

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
        if (!save.isPending) save.mutate();
      }}
    >
      <div>
        <h2 style={{ fontSize: 22 }}>{t("linksTitle")}</h2>
        <p style={{ color: "var(--muted)", fontSize: 14, margin: "4px 0 0" }}>{t("linksHint")}</p>
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
      <div className="row gap-3" style={{ alignItems: "center" }}>
        <Button type="submit" icon="check" disabled={save.isPending}>
          {save.isPending ? "…" : t("save")}
        </Button>
        {saved && <span style={{ color: "var(--primary-press)", fontWeight: 700 }}>{t("savedOk")}</span>}
        {save.isError && <span style={{ color: "var(--danger)", fontWeight: 700 }}>{t("registerError")}</span>}
      </div>
    </form>
  );
}
