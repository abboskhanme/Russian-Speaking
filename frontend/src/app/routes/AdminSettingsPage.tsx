/**
 * AdminSettingsPage (`/admin/settings`) — Sozlamalar.
 *
 *   • `GET/PATCH /api/admin/ai`    → grader + STT providers, models, secrets
 *   • `GET/PATCH /api/admin/links` → the outbound Telegram links
 *
 * Both are fetched together because the screen shows them on one page, and both
 * are re-read after any save so the read-only status fields (`active_provider`,
 * `*_ready`) reflect what the server now believes rather than what was submitted.
 * That distinction is the whole point of showing them.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminSettingsScreen } from "../../screens/admin";
import type { AdminSettings, AdminSettingsPatch } from "../../screens/admin";
import { endpoints } from "../../shared/api";
import type { AiSettingsResponse, LinksResponse } from "../../shared/api";
import { PageError, PageLoading } from "../PageState";
import { useAdminNavHandler } from "../nav";

export default function AdminSettingsPage() {
  const onNavigate = useAdminNavHandler();

  const [ai, setAi] = useState<AiSettingsResponse | null>(null);
  const [links, setLinks] = useState<LinksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);

    Promise.allSettled([endpoints.adminAiSettings(), endpoints.adminLinks()])
      .then(([a, l]) => {
        if (!alive) return;
        // The AI settings are load-bearing; the links are not, so a failing links
        // read costs that card its values, not the page.
        if (a.status !== "fulfilled") {
          setFailed(true);
          return;
        }
        setAi(a.value);
        setLinks(l.status === "fulfilled" ? l.value : { tg_support_url: "", tg_channel_url: "" });
      })
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const settings = useMemo<AdminSettings | null>(() => {
    if (!ai || !links) return null;
    return {
      llmProvider: ai.llm_provider,
      geminiModel: ai.gemini_model,
      knownGeminiModels: ai.known_gemini_models,
      anthropicModel: ai.anthropic_model,
      knownAnthropicModels: ai.known_anthropic_models,
      anthropicApiKey: ai.anthropic_api_key,
      orthoepyEnabled: ai.orthoepy_enabled,
      azureOpenaiEndpoint: ai.azure_openai_endpoint,
      azureOpenaiDeployment: ai.azure_openai_deployment,
      azureOpenaiApiVersion: ai.azure_openai_api_version,
      geminiApiKey: ai.gemini_api_key,
      azureOpenaiApiKey: ai.azure_openai_api_key,
      azureReady: ai.azure_ready,
      activeProvider: ai.active_provider,
      sttProvider: ai.stt_provider,
      azureSpeechRegion: ai.azure_speech_region,
      whisperModel: ai.whisper_model,
      azureSpeechKey: ai.azure_speech_key,
      openaiApiKey: ai.openai_api_key,
      azureSpeechReady: ai.azure_speech_ready,
      sttActiveProvider: ai.stt_active_provider,
      graderChain: ai.grader_chain,
      sttChain: ai.stt_chain,
      graderBackends: ai.grader_backends,
      sttBackends: ai.stt_backends,
      readyGraderBackends: ai.ready_grader_backends,
      readySttBackends: ai.ready_stt_backends,
      tgSupportUrl: links.tg_support_url,
      tgChannelUrl: links.tg_channel_url,
    };
  }, [ai, links]);

  const saveAi = useCallback(
    async (patch: AdminSettingsPatch) => {
      // The screen only puts CHANGED fields in the patch, so this maps one-to-one
      // onto the tri-state contract: absent = unchanged.
      const updated = await endpoints.adminUpdateAiSettings({
        llm_provider: patch.llmProvider,
        gemini_model: patch.geminiModel,
        gemini_api_key: patch.geminiApiKey,
        orthoepy_enabled: patch.orthoepyEnabled,
        azure_openai_endpoint: patch.azureOpenaiEndpoint,
        azure_openai_api_key: patch.azureOpenaiApiKey,
        azure_openai_deployment: patch.azureOpenaiDeployment,
        azure_openai_api_version: patch.azureOpenaiApiVersion,
        stt_provider: patch.sttProvider,
        azure_speech_region: patch.azureSpeechRegion,
        whisper_model: patch.whisperModel,
        azure_speech_key: patch.azureSpeechKey,
        openai_api_key: patch.openaiApiKey,
        grader_chain: patch.graderChain,
        stt_chain: patch.sttChain,
        anthropic_api_key: patch.anthropicApiKey,
        anthropic_model: patch.anthropicModel,
      });
      setAi(updated);
    },
    [],
  );

  const saveLinks = useCallback(
    async (patch: { tgSupportUrl?: string; tgChannelUrl?: string }) => {
      setLinks(
        await endpoints.adminUpdateLinks({
          tg_support_url: patch.tgSupportUrl,
          tg_channel_url: patch.tgChannelUrl,
        }),
      );
    },
    [],
  );

  if (loading) return <PageLoading />;
  if (failed || !settings) return <PageError onRetry={refetch} />;

  return (
    <AdminSettingsScreen
      settings={settings}
      activeNavKey="settings"
      onNavigate={onNavigate}
      onSaveAi={saveAi}
      onSaveLinks={saveLinks}
    />
  );
}
