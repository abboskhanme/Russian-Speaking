/**
 * AdminSettingsPage (`/admin/settings`) — Sozlamalar.
 *
 *   • `GET/PATCH /api/admin/ai`    → grader + STT providers, models, secrets
 *   • `GET/PATCH /api/admin/links` → the outbound Telegram links
 *   • `GET/PATCH /api/admin/settings/ai-budget` → the AI kill switch, caps and spend
 *
 * Both are fetched together because the screen shows them on one page, and both
 * are re-read after any save so the read-only status fields (`active_provider`,
 * `*_ready`) reflect what the server now believes rather than what was submitted.
 * That distinction is the whole point of showing them.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AdminSettingsScreen } from "../../screens/admin";
import { asSettingsTab } from "../../screens/admin/AdminSettingsScreen";
import type { SettingsTab } from "../../screens/admin/AdminSettingsScreen";
import type { AdminAiBudgetPatch, AdminSettings, AdminSettingsPatch } from "../../screens/admin";
import { endpoints } from "../../shared/api";
import type {
  AiBudgetResponse,
  AiSettingsResponse,
  FeatureFlagsResponse,
  LinksResponse,
} from "../../shared/api";
import { PageError, PageLoading } from "../PageState";
import { useAdminNavHandler } from "../nav";
import { toAdminAiBudget } from "../adapters";

export default function AdminSettingsPage() {
  const onNavigate = useAdminNavHandler();
  // The open tab lives in the URL (`?tab=stt`), so a link or a reload lands on it.
  const [params, setParams] = useSearchParams();
  const tab = asSettingsTab(params.get("tab"));
  const setTab = useCallback(
    (next: SettingsTab) => {
      const p = new URLSearchParams(params);
      if (next === "ai") p.delete("tab");
      else p.set("tab", next);
      setParams(p, { replace: true });
    },
    [params, setParams],
  );

  const [ai, setAi] = useState<AiSettingsResponse | null>(null);
  const [links, setLinks] = useState<LinksResponse | null>(null);
  const [flags, setFlags] = useState<FeatureFlagsResponse | null>(null);
  // Null when the read failed (or an older API has no such route): the card is then
  // left out rather than showing a cap of $0 that nobody set.
  const [budget, setBudget] = useState<AiBudgetResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);

    Promise.allSettled([
      endpoints.adminAiSettings(),
      endpoints.adminLinks(),
      endpoints.adminFeatureFlags(),
      endpoints.adminAiBudget(),
    ])
      .then(([a, l, f, b]) => {
        if (!alive) return;
        setBudget(b.status === "fulfilled" ? b.value : null);
        // The AI settings are load-bearing; the links are not, so a failing links
        // read costs that card its values, not the page.
        if (a.status !== "fulfilled") {
          setFailed(true);
          return;
        }
        setAi(a.value);
        setLinks(l.status === "fulfilled" ? l.value : { tg_support_url: "", tg_channel_url: "" });
        // Like the links: a failing flags read costs that card its values, not the page.
        // The fallback mirrors the server defaults, so a reader is never told a feature is
        // on when the server could not say.
        setFlags(
          f.status === "fulfilled"
            ? f.value
            : {
                review_drill_enabled: false,
                roleplay_enabled: false,
                roleplay_max_turns: 8,
                roleplay_daily_turns: 24,
                class_insights_enabled: false,
                daily_five_enabled: false,
                payments_enabled: false,
                phoneme_drill_enabled: false,
                phoneme_drill_daily_attempts: 40,
              },
        );
      })
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const settings = useMemo<AdminSettings | null>(() => {
    if (!ai || !links || !flags) return null;
    return {
      reviewDrillEnabled: flags.review_drill_enabled,
      roleplayEnabled: flags.roleplay_enabled,
      roleplayMaxTurns: flags.roleplay_max_turns,
      roleplayDailyTurns: flags.roleplay_daily_turns,
      classInsightsEnabled: flags.class_insights_enabled,
      dailyFiveEnabled: flags.daily_five_enabled,
      paymentsEnabled: flags.payments_enabled,
      phonemeDrillEnabled: flags.phoneme_drill_enabled,
      phonemeDrillDailyAttempts: flags.phoneme_drill_daily_attempts,
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
      // The three fields below are typed as the current contract has them, and read
      // through a fallback anyway: an API image built before they landed still answers
      // every other field, and the panel is worth more with one empty box than with a
      // crash. `openai_grader_model` in particular must not reach the screen as
      // `undefined` — that turns a controlled input into an uncontrolled one.
      //
      // Two spellings for the OpenAI list because the server's snake_case policy splits
      // `KnownOpenAiModels` into `known_open_ai_models` while `OpenaiApiKey` beside it
      // becomes `openai_api_key`. Reading both means a rename cannot quietly empty the
      // suggestion chips.
      knownWhisperModels: ai.known_whisper_models ?? [],
      openaiGraderModel: ai.openai_grader_model ?? "",
      knownOpenaiModels: ai.known_open_ai_models ?? ai.known_openai_models ?? [],
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
    // All THREE payloads, including `flags` — it was missing, so a saved feature
    // switch updated the state and never reached this object: the Faza 6 card went
    // on showing the values from the page load until someone reloaded.
    //
    // Adding it is only safe because the screen no longer re-seeds its draft state
    // from this object's IDENTITY (see AdminSettingsScreen's two seed effects). It
    // used to, which is why the obvious fix was a worse bug: every flag toggle
    // produced a new `settings` and wiped a half-typed API key out from under the
    // person typing it.
  }, [ai, links, flags]);

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
        openai_grader_model: patch.openaiGraderModel,
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

  // Deliberately NOT cached, retried or prefetched: every call bills every backend that
  // holds a key. It runs when the admin presses the button and at no other moment, and a
  // rejection is left to propagate so the screen can say the REQUEST failed rather than
  // report five backends as broken on the strength of one dead socket.
  const testAi = useCallback(async () => {
    const { results } = await endpoints.adminTestAiSettings();
    return results.map((r) => ({
      name: r.name,
      kind: r.kind,
      configured: r.configured,
      ok: r.ok,
      model: r.model,
      error: r.error,
      elapsedMs: r.elapsed_ms,
    }));
  }, []);

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

  const saveFeatures = useCallback(
    async (patch: {
      reviewDrillEnabled: string;
      roleplayEnabled: string;
      roleplayMaxTurns: string;
      roleplayDailyTurns: string;
      classInsightsEnabled: string;
      dailyFiveEnabled: string;
      phonemeDrillEnabled: string;
      phonemeDrillDailyAttempts: string;
      paymentsEnabled: string;
    }) => {
      setFlags(
        await endpoints.adminUpdateFeatureFlags({
          review_drill_enabled: patch.reviewDrillEnabled,
          roleplay_enabled: patch.roleplayEnabled,
          roleplay_max_turns: patch.roleplayMaxTurns,
          roleplay_daily_turns: patch.roleplayDailyTurns,
          class_insights_enabled: patch.classInsightsEnabled,
          daily_five_enabled: patch.dailyFiveEnabled,
          payments_enabled: patch.paymentsEnabled,
          phoneme_drill_enabled: patch.phonemeDrillEnabled,
          phoneme_drill_daily_attempts: patch.phonemeDrillDailyAttempts,
        }),
      );
    },
    [],
  );

  const saveBudget = useCallback(async (patch: AdminAiBudgetPatch) => {
    setBudget(
      await endpoints.adminUpdateAiBudget({
        ai_paused: patch.aiPaused,
        daily_cap_usd: patch.dailyCapUsd,
        monthly_cap_usd: patch.monthlyCapUsd,
      }),
    );
  }, []);

  const aiBudget = useMemo(() => (budget ? toAdminAiBudget(budget) : null), [budget]);

  if (loading) return <PageLoading />;
  if (failed || !settings) return <PageError onRetry={refetch} />;

  return (
    <AdminSettingsScreen
      settings={settings}
      activeNavKey="settings"
      onNavigate={onNavigate}
      onSaveAi={saveAi}
      onTestAi={testAi}
      onSaveLinks={saveLinks}
      onSaveFeatures={saveFeatures}
      aiBudget={aiBudget}
      onSaveAiBudget={saveBudget}
      tab={tab}
      onTabChange={setTab}
    />
  );
}
