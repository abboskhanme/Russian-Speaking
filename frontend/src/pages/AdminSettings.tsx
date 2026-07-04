import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import type { AiSettings } from "../lib/types";
import { Button, Card, Field, Loading, PageHead, inp } from "../components/govori";

/** Editable form fields. Secrets start empty; leaving one empty keeps the
 * stored value (only a typed value is sent). */
interface Form {
  llm_provider: string;
  gemini_model: string;
  gemini_api_key: string;
  azure_openai_endpoint: string;
  azure_openai_deployment: string;
  azure_openai_api_version: string;
  azure_openai_api_key: string;
}

export function AdminSettings() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["ai-settings"],
    queryFn: async () => (await api.get<AiSettings>("/admin/settings/ai")).data,
  });

  // Seed the form once the server config arrives (secrets stay blank).
  useEffect(() => {
    if (data && !form)
      setForm({
        llm_provider: data.llm_provider,
        gemini_model: data.gemini_model,
        gemini_api_key: "",
        azure_openai_endpoint: data.azure_openai_endpoint,
        azure_openai_deployment: data.azure_openai_deployment,
        azure_openai_api_version: data.azure_openai_api_version,
        azure_openai_api_key: "",
      });
  }, [data, form]);

  const save = useMutation({
    mutationFn: async (f: Form) => {
      // Always send non-secret fields; send a secret only when the admin typed one.
      const payload: Record<string, string> = {
        llm_provider: f.llm_provider,
        gemini_model: f.gemini_model,
        azure_openai_endpoint: f.azure_openai_endpoint,
        azure_openai_deployment: f.azure_openai_deployment,
        azure_openai_api_version: f.azure_openai_api_version,
      };
      if (f.gemini_api_key) payload.gemini_api_key = f.gemini_api_key;
      if (f.azure_openai_api_key) payload.azure_openai_api_key = f.azure_openai_api_key;
      return (await api.patch<AiSettings>("/admin/settings/ai", payload)).data;
    },
    onSuccess: (fresh) => {
      qc.setQueryData(["ai-settings"], fresh);
      setForm((prev) =>
        prev ? { ...prev, gemini_api_key: "", azure_openai_api_key: "" } : prev,
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  if (isLoading || !form || !data) return <Loading full />;

  const set = (k: keyof Form, v: string) => setForm({ ...form, [k]: v });
  const secretPh = (s: { set: boolean; hint: string }) =>
    s.set ? `•••• ${s.hint} — ${t("aiKeyKeep")}` : t("aiKeyUnset");

  return (
    <div className="focus-wrap">
      <PageHead title={t("settingsAiTitle")} sub={t("settingsAiHint")} />

      {/* Live status */}
      <Card style={{ marginBottom: 16 }}>
        <div className="row gap-4 wrap" style={{ alignItems: "center" }}>
          <div className="col gap-1">
            <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--faint)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {t("aiActiveNow")}
            </span>
            <span style={{ fontSize: 20, fontWeight: 800 }}>
              {data.active_provider === "azure" ? "Azure OpenAI" : "Gemini"}
            </span>
          </div>
          <span
            style={{
              fontSize: 13,
              fontWeight: 700,
              padding: "6px 12px",
              borderRadius: 999,
              background: data.azure_ready ? "var(--success-tint, #e7f6ec)" : "var(--surface-2)",
              color: data.azure_ready ? "var(--success, #1a7f3d)" : "var(--muted)",
            }}
          >
            {data.azure_ready ? t("aiAzureReady") : t("aiAzureNotReady")}
          </span>
        </div>
      </Card>

      <form
        className="col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!save.isPending) save.mutate(form);
        }}
      >
        {/* Provider choice */}
        <Card>
          <h3 style={{ fontSize: 17, marginBottom: 14 }}>{t("aiProvider")}</h3>
          <Field label={t("aiProvider")}>
            <select value={form.llm_provider} onChange={(e) => set("llm_provider", e.target.value)} style={inp}>
              <option value="auto">{t("aiProviderAuto")}</option>
              <option value="azure">{t("aiProviderAzure")}</option>
              <option value="gemini">{t("aiProviderGemini")}</option>
            </select>
          </Field>
        </Card>

        {/* Azure OpenAI */}
        <Card>
          <h3 style={{ fontSize: 17, marginBottom: 14 }}>Azure OpenAI</h3>
          <div className="col gap-4">
            <Field label={t("azureEndpoint")}>
              <input
                value={form.azure_openai_endpoint}
                onChange={(e) => set("azure_openai_endpoint", e.target.value)}
                placeholder="https://<resource>.openai.azure.com"
                style={inp}
              />
            </Field>
            <Field label={t("azureDeployment")}>
              <input
                value={form.azure_openai_deployment}
                onChange={(e) => set("azure_openai_deployment", e.target.value)}
                placeholder="gpt-4o"
                style={inp}
              />
            </Field>
            <Field label={t("azureApiVersion")}>
              <input
                value={form.azure_openai_api_version}
                onChange={(e) => set("azure_openai_api_version", e.target.value)}
                placeholder="2024-10-21"
                style={inp}
              />
            </Field>
            <Field label={t("azureApiKey")}>
              <input
                type="password"
                autoComplete="new-password"
                value={form.azure_openai_api_key}
                onChange={(e) => set("azure_openai_api_key", e.target.value)}
                placeholder={secretPh(data.azure_openai_api_key)}
                style={inp}
              />
            </Field>
          </div>
        </Card>

        {/* Gemini */}
        <Card>
          <h3 style={{ fontSize: 17, marginBottom: 14 }}>Google Gemini</h3>
          <div className="col gap-4">
            <Field label={t("geminiModel")}>
              <input
                value={form.gemini_model}
                onChange={(e) => set("gemini_model", e.target.value)}
                placeholder="gemini-2.5-flash"
                style={inp}
              />
            </Field>
            <Field label={t("geminiApiKey")}>
              <input
                type="password"
                autoComplete="new-password"
                value={form.gemini_api_key}
                onChange={(e) => set("gemini_api_key", e.target.value)}
                placeholder={secretPh(data.gemini_api_key)}
                style={inp}
              />
            </Field>
          </div>
        </Card>

        <div className="row gap-3" style={{ alignItems: "center" }}>
          <Button type="submit" icon="check" disabled={save.isPending}>
            {save.isPending ? "…" : t("save")}
          </Button>
          {saved && <span style={{ color: "var(--success, #1a7f3d)", fontWeight: 700 }}>{t("savedOk")}</span>}
          {save.isError && <span style={{ color: "var(--danger)", fontWeight: 700 }}>{t("registerError")}</span>}
        </div>
      </form>
    </div>
  );
}
