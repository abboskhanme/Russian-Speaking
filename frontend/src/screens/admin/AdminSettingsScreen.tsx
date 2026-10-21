import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card, Input, Spinner, Switch, Text } from "../../shared/ui";
import { AppShell, Brand, NotificationsBell, adminNavItems } from "../../widgets";
import type { NavItem } from "../../widgets";
import { AdminAccountButton } from "./AdminChrome";
import { adminErrorBody, isNetworkError } from "./adminErrors";
import { mockAdminSettings } from "./admin.mock";
import { AiBudgetCard } from "./AiBudgetCard";
import type { AdminAiBudget, AdminAiBudgetPatch } from "./AiBudgetCard";
import { modelNote } from "./modelNote";
import styles from "./AdminSettingsScreen.module.css";

/** The three independently saved sections. */
type SaveSection = "ai" | "features" | "links";

/** The outcome of the last save, and WHICH section's button produced it. */
interface SaveFeedback {
  section: SaveSection;
  tone: "success" | "muted" | "danger";
  text: string;
}

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

/** A stored secret as the server is willing to describe it: whether it is set, and
 * a hint. The value itself only ever arrives through an explicit reveal. */
export interface AdminSecret {
  set: boolean;
  hint: string;
}

/** One curated model the server suggests. A SUGGESTION, never a whitelist: the model
 * fields below take any id typed into them, and `note` carries the price/quality line
 * an owner actually chooses on. */
export interface KnownModel {
  id: string;
  label: string;
  note: string;
}

export interface AdminSettings {
  /** Faza 6 switches. They live on the same read model because the screen shows them,
   *  but they travel over their own endpoint — they decide whether a surface exists,
   *  not how the AI behaves. */
  reviewDrillEnabled: boolean;
  roleplayEnabled: boolean;
  roleplayMaxTurns: number;
  roleplayDailyTurns: number;
  classInsightsEnabled: boolean;
  dailyFiveEnabled: boolean;
  /** F2 · the minimal-pair phoneme drill. */
  phonemeDrillEnabled: boolean;
  /** F2 · attempts per student per UTC day. */
  phonemeDrillDailyAttempts: number;
  paymentsEnabled: boolean;
  llmProvider: string;
  geminiModel: string;
  knownGeminiModels: KnownModel[];
  anthropicModel: string;
  knownAnthropicModels: KnownModel[];
  anthropicApiKey: AdminSecret;
  orthoepyEnabled: boolean;
  azureOpenaiEndpoint: string;
  azureOpenaiDeployment: string;
  azureOpenaiApiVersion: string;
  geminiApiKey: AdminSecret;
  azureOpenaiApiKey: AdminSecret;
  azureReady: boolean;
  /** What would ACTUALLY run right now — not the same as what is selected. */
  activeProvider: string;
  sttProvider: string;
  azureSpeechRegion: string;
  whisperModel: string;
  knownWhisperModels: KnownModel[];
  openaiGraderModel: string;
  knownOpenaiModels: KnownModel[];
  azureSpeechKey: AdminSecret;
  openaiApiKey: AdminSecret;
  azureSpeechReady: boolean;
  sttActiveProvider: string;
  /** The order backends are tried in, comma-joined ("anthropic,gemini,openai").
   * First one that is configured AND answers wins; the rest are the fallback. */
  graderChain: string;
  sttChain: string;
  /** Every implemented backend — the pool a chain is built from. */
  graderBackends: string[];
  sttBackends: string[];
  /** The subset that holds a key. Anything else in the chain is skipped. */
  readyGraderBackends: string[];
  readySttBackends: string[];
  tgSupportUrl: string;
  tgChannelUrl: string;
}

/** Only the fields the operator changed. Everything omitted is left alone — the
 * server treats absent as "unchanged" and `""` as "clear back to the env default",
 * and this screen never sends a field it did not edit. */
export interface AdminSettingsPatch {
  llmProvider?: string;
  geminiModel?: string;
  geminiApiKey?: string;
  orthoepyEnabled?: string;
  azureOpenaiEndpoint?: string;
  azureOpenaiApiKey?: string;
  azureOpenaiDeployment?: string;
  azureOpenaiApiVersion?: string;
  sttProvider?: string;
  azureSpeechRegion?: string;
  whisperModel?: string;
  openaiGraderModel?: string;
  azureSpeechKey?: string;
  openaiApiKey?: string;
  /** Comma-joined order. `""` is a real, reachable value here: an emptied chain
   * clears the override and the server falls back to its own default order. */
  graderChain?: string;
  sttChain?: string;
  anthropicApiKey?: string;
  anthropicModel?: string;
}

/** What one backend answered when it was actually called. `configured: false` means
 * SKIPPED — no key, no call, no cost — and is never a failure. */
export interface AdminProbe {
  name: string;
  kind: string;
  configured: boolean;
  ok: boolean;
  model: string | null;
  error: string | null;
  elapsedMs: number;
}

export interface AdminSettingsProps {
  settings: AdminSettings;
  activeNavKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
  onSaveAi?: (patch: AdminSettingsPatch) => Promise<void>;
  /** Spends money: one real vendor call per configured backend. Wired to an explicit
   * button and nothing else — never a render, a poll or an automatic retry. */
  onTestAi?: () => Promise<AdminProbe[]>;
  onSaveLinks?: (patch: { tgSupportUrl?: string; tgChannelUrl?: string }) => Promise<void>;
  onSaveFeatures?: (patch: {
    reviewDrillEnabled: string;
    roleplayEnabled: string;
    roleplayMaxTurns: string;
    roleplayDailyTurns: string;
    classInsightsEnabled: string;
    dailyFiveEnabled: string;
    phonemeDrillEnabled: string;
    phonemeDrillDailyAttempts: string;
    paymentsEnabled: string;
  }) => Promise<void>;
  /** The global AI spend ceiling + kill switch. Optional: without it (an older API, or
   * a failed read) the card is simply not shown, and nothing else on the page depends
   * on it. */
  aiBudget?: AdminAiBudget | null;
  onSaveAiBudget?: (patch: AdminAiBudgetPatch) => Promise<void>;
}


/**
 * The server's curated model labels carry an advisory suffix typed in whatever
 * language that list was written in — "(recommended)" on Gemini, "(tavsiya etiladi)"
 * on Claude — so one screen mixed English and Uzbek. The model name before it is a
 * product name and stays as sent; the suffix is recognised and re-said in the
 * interface language. An unrecognised suffix is left alone rather than guessed at.
 */
const MODEL_LABEL_TAGS: ReadonlyArray<{ pattern: RegExp; key: string }> = [
  { pattern: /\s*\((?:recommended|tavsiya etiladi|рекомендуется)\)\s*$/i, key: "admin.modelRecommended" },
  { pattern: /\s*\((?:avoid on free tier)\)\s*$/i, key: "admin.modelAvoidFreeTier" },
];

export function modelLabel(label: string, t: TFunction): string {
  for (const { pattern, key } of MODEL_LABEL_TAGS) {
    if (pattern.test(label)) return `${label.replace(pattern, "")} (${t(key)})`;
  }
  return label;
}

/** Splits a stored chain into backend names, dropping blanks and duplicates while
 * keeping order — the same normalisation the server does, so an unedited chain
 * compares equal to itself and never lands in the patch. */
function parseChain(stored: string): string[] {
  const names = stored
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(names)];
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * AdminSettingsScreen — **Sozlamalar**: the runtime AI/STT configuration and the
 * outbound contact links.
 *
 * ## Secrets are never displayed
 *
 * `GET /api/admin/ai` returns each key as `{ set, hint }` and never the value. This
 * screen shows that state, and an empty field means "leave it alone" — NOT "clear
 * it". Clearing is a separate, explicit control, because typing nothing is what
 * happens by accident and losing a production API key by accident is not an
 * acceptable outcome of opening a settings page.
 *
 * The mockup's reveal-the-value control is intentionally not wired here: the
 * endpoint exists (`GET /api/admin/reveal/{key}`), but printing a live key into the
 * DOM is a decision worth making deliberately rather than shipping as a convenience.
 *
 * ## Selected ≠ active
 *
 * `active_provider` and `stt_active_provider` are computed server-side and answer
 * "what would run on the next request". They can differ from the dropdown — pick
 * Azure without a key and `auto` quietly stays on Gemini. Both are shown, because a
 * settings screen that only echoes your selection back cannot tell you it is being
 * ignored.
 *
 * ## The chain is the routing decision
 *
 * Grading and STT each run an ORDERED chain: the first backend that is configured
 * *and* answers serves the request, and anything unconfigured is passed over
 * silently at no cost. So the honest unit of status is per backend, not per screen —
 * `ChainEditor` labels every row from `ready*Backends`, and a keyless backend is
 * shown as skipped rather than as something that runs.
 *
 * ## One card per backend
 *
 * The settings under each chain are grouped the same way the chain is: a `BackendCard`
 * per backend, carrying only what that backend needs and stating its own readiness.
 * The flat field list this replaced could only describe the two backends someone had
 * got round to rendering — the OpenAI key, the Azure OpenAI endpoint/deployment and the
 * Whisper model were reachable only through an env var and a redeploy, which is not a
 * setting an owner has.
 *
 * Azure OpenAI is a card but NOT a chain row, because the server does not treat it as a
 * separate backend: it is the `openai` backend's other route, and it wins over the
 * public API whenever endpoint + deployment + key are all present. The card says that
 * out loud rather than leaving an admin to discover it from a bill.
 *
 * Whisper likewise gets no key field: it authenticates with the same `openai_api_key`
 * as the OpenAI grader, and a second box writing one value is how someone ends up sure
 * they cleared a key they did not.
 *
 * ## Models are typed, not picked
 *
 * Every model field is free text with the curated list as suggestions. A fixed chip
 * strip cannot select a model released after the last deploy, which makes "run on the
 * newest model" a code change instead of a setting.
 */
export function AdminSettingsScreen({
  settings,
  activeNavKey = "settings",
  onNavigate,
  onSaveAi,
  onTestAi,
  onSaveLinks,
  onSaveFeatures,
  aiBudget,
  onSaveAiBudget,
}: AdminSettingsProps) {
  const { t } = useTranslation();

  const [model, setModel] = useState(settings.geminiModel);
  const [claudeModel, setClaudeModel] = useState(settings.anthropicModel);
  const [openaiModel, setOpenaiModel] = useState(settings.openaiGraderModel);
  const [whisperModel, setWhisperModel] = useState(settings.whisperModel);
  const [graderChain, setGraderChain] = useState(() => parseChain(settings.graderChain));
  const [sttChain, setSttChain] = useState(() => parseChain(settings.sttChain));
  const [orthoepy, setOrthoepy] = useState(settings.orthoepyEnabled);
  const [region, setRegion] = useState(settings.azureSpeechRegion);
  const [azureEndpoint, setAzureEndpoint] = useState(settings.azureOpenaiEndpoint);
  const [azureDeployment, setAzureDeployment] = useState(settings.azureOpenaiDeployment);
  const [azureApiVersion, setAzureApiVersion] = useState(settings.azureOpenaiApiVersion);
  const [geminiKey, setGeminiKey] = useState("");
  const [claudeKey, setClaudeKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [azureOpenaiKey, setAzureOpenaiKey] = useState("");
  const [speechKey, setSpeechKey] = useState("");
  const [support, setSupport] = useState(settings.tgSupportUrl);
  const [channel, setChannel] = useState(settings.tgChannelUrl);
  const [drill, setDrill] = useState(settings.reviewDrillEnabled);
  const [roleplay, setRoleplay] = useState(settings.roleplayEnabled);
  const [maxTurns, setMaxTurns] = useState(String(settings.roleplayMaxTurns));
  const [dailyTurns, setDailyTurns] = useState(String(settings.roleplayDailyTurns));
  const [classInsights, setClassInsights] = useState(settings.classInsightsEnabled);
  const [dailyFive, setDailyFive] = useState(settings.dailyFiveEnabled);
  const [phonemeDrill, setPhonemeDrill] = useState(settings.phonemeDrillEnabled);
  const [drillAttempts, setDrillAttempts] = useState(
    String(settings.phonemeDrillDailyAttempts),
  );
  const [payments, setPayments] = useState(settings.paymentsEnabled);
  const [busy, setBusy] = useState(false);
  // One result line, printed beside the button that produced it. It used to be a
  // single line at the very bottom of a ~5,900px page, so "Saqlandi" — and worse,
  // "Saqlanmadi" — appeared off-screen from the button the admin had just pressed.
  const [feedback, setFeedback] = useState<SaveFeedback | null>(null);
  // `invalid_link` names the field; the message goes on THAT input.
  const [linkErrors, setLinkErrors] = useState<{ support?: string; channel?: string }>({});
  // Probe results keyed `kind:name`, plus one in-flight flag. One flag and not one per
  // section because the endpoint has no scope argument: it probes everything, so both
  // buttons buy the same round of calls and every card is genuinely pending.
  const [probes, setProbes] = useState<Record<string, AdminProbe>>({});
  const [probing, setProbing] = useState(false);
  // Which section's button was pressed. Not a second in-flight flag — it only decides
  // where the transport-failure line is printed, so that a request that never reached
  // the server reports itself next to the button the admin actually pressed instead of
  // twice, once in each section, out of one failure.
  const [probeFailed, setProbeFailed] = useState<"grader" | "stt" | null>(null);

  // Which backend will actually serve the next request: the first one in the SAVED order that has
  // a key. This is the same walk the server does at runtime, deliberately mirrored rather than read
  // from `active_provider` — that field is computed from the retired single-provider setting and no
  // longer describes anything the pipeline does.
  //
  // Derived from `settings`, not from the local draft, so reordering the chain does not claim a
  // change has taken effect before it is saved.
  const firstReady = (chain: string, ready: readonly string[]) =>
    parseChain(chain).find((name) => ready.includes(name)) ?? null;
  const graderServing = firstReady(settings.graderChain, settings.readyGraderBackends);
  const sttServing = firstReady(settings.sttChain, settings.readySttBackends);

  // Per-card readiness comes from the server's ready lists, so a card and its chain row can
  // never disagree about the same backend.
  const graderReady = (name: string) => settings.readyGraderBackends.includes(name);
  const sttReady = (name: string) => settings.readySttBackends.includes(name);

  /* -- Re-seeding the draft from the server ---------------------------------
   *
   * TWO effects, each depending on the VALUES it mirrors rather than on the
   * `settings` object. This is not a style choice; the single effect it replaces
   * keyed on `settings` itself, and `settings` is rebuilt by the page from three
   * separate payloads, so saving ANY one of them re-ran the whole seed.
   *
   * That coupling is what made the stale-flags bug unfixable at the obvious spot:
   * the page had `flags` missing from its memo deps (the Faza 6 card showed the
   * values from page load forever), and adding it back handed every flag toggle a
   * fresh `settings` — which re-ran this seed and cleared the key inputs, deleting
   * a half-typed production API key out from under whoever was typing it.
   *
   * Split by source, neither can do that: flipping a switch cannot touch the AI
   * fields, and saving a model cannot reset the switches. The key inputs are not
   * seeded from props at all any more — they are cleared by the save that
   * consumed them (see `saveAi`), which is the moment that actually means
   * "these are no longer yours to send".
   */

  // AI + links, from `GET /admin/ai` and `GET /admin/links`.
  useEffect(() => {
    setModel(settings.geminiModel);
    setClaudeModel(settings.anthropicModel);
    setOpenaiModel(settings.openaiGraderModel);
    setWhisperModel(settings.whisperModel);
    setGraderChain(parseChain(settings.graderChain));
    setSttChain(parseChain(settings.sttChain));
    setOrthoepy(settings.orthoepyEnabled);
    setRegion(settings.azureSpeechRegion);
    setAzureEndpoint(settings.azureOpenaiEndpoint);
    setAzureDeployment(settings.azureOpenaiDeployment);
    setAzureApiVersion(settings.azureOpenaiApiVersion);
    setSupport(settings.tgSupportUrl);
    setChannel(settings.tgChannelUrl);
    // Stale results are worse than none: a probe round described the configuration
    // as it was before this change.
    setProbes({});
    setProbeFailed(null);
  }, [
    settings.geminiModel,
    settings.anthropicModel,
    settings.openaiGraderModel,
    settings.whisperModel,
    settings.graderChain,
    settings.sttChain,
    settings.orthoepyEnabled,
    settings.azureSpeechRegion,
    settings.azureOpenaiEndpoint,
    settings.azureOpenaiDeployment,
    settings.azureOpenaiApiVersion,
    settings.tgSupportUrl,
    settings.tgChannelUrl,
  ]);

  // Faza 6 switches, from `GET/PATCH /admin/feature-flags` — their own endpoint and
  // now their own seed, so a saved switch shows what the SERVER stored (it clamps
  // the turn limits) rather than what was typed at it.
  useEffect(() => {
    setDrill(settings.reviewDrillEnabled);
    setRoleplay(settings.roleplayEnabled);
    setMaxTurns(String(settings.roleplayMaxTurns));
    setDailyTurns(String(settings.roleplayDailyTurns));
    setClassInsights(settings.classInsightsEnabled);
    setDailyFive(settings.dailyFiveEnabled);
    setPhonemeDrill(settings.phonemeDrillEnabled);
    setDrillAttempts(String(settings.phonemeDrillDailyAttempts));
    setPayments(settings.paymentsEnabled);
  }, [
    settings.reviewDrillEnabled,
    settings.roleplayEnabled,
    settings.roleplayMaxTurns,
    settings.roleplayDailyTurns,
    settings.classInsightsEnabled,
    settings.dailyFiveEnabled,
    settings.phonemeDrillEnabled,
    settings.phonemeDrillDailyAttempts,
    settings.paymentsEnabled,
  ]);

  /** A failed save's sentence: the connection, or the server said no. Never the raw
   * `detail`, which is an English developer string. */
  const failure = (e: unknown) =>
    isNetworkError(e) ? t("auth.errors.network") : t("admin.saveFailed");

  const saveAi = async () => {
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const patch: AdminSettingsPatch = {};
      // Models are trimmed before comparing AND before sending: a trailing space typed
      // into a free-text model id is invisible here and a 404 at the vendor. Emptying
      // one is a real, reachable edit — `""` clears the override back to the env
      // default, which is how an admin undoes a model they should not have pinned.
      const trimmed = (next: string, stored: string) => {
        const value = next.trim();
        return value === stored.trim() ? null : value;
      };
      const geminiEdit = trimmed(model, settings.geminiModel);
      if (geminiEdit !== null) patch.geminiModel = geminiEdit;
      const claudeEdit = trimmed(claudeModel, settings.anthropicModel);
      if (claudeEdit !== null) patch.anthropicModel = claudeEdit;
      const openaiEdit = trimmed(openaiModel, settings.openaiGraderModel);
      if (openaiEdit !== null) patch.openaiGraderModel = openaiEdit;
      const whisperEdit = trimmed(whisperModel, settings.whisperModel);
      if (whisperEdit !== null) patch.whisperModel = whisperEdit;
      // Compare against the PARSED server value: the wire form may carry spaces or a
      // duplicate, and an untouched chain must not look edited.
      const graderOrder = graderChain.join(",");
      const sttOrder = sttChain.join(",");
      if (graderOrder !== parseChain(settings.graderChain).join(","))
        patch.graderChain = graderOrder;
      if (sttOrder !== parseChain(settings.sttChain).join(",")) patch.sttChain = sttOrder;
      if (orthoepy !== settings.orthoepyEnabled) patch.orthoepyEnabled = String(orthoepy);
      if (region !== settings.azureSpeechRegion) patch.azureSpeechRegion = region;
      const endpointEdit = trimmed(azureEndpoint, settings.azureOpenaiEndpoint);
      if (endpointEdit !== null) patch.azureOpenaiEndpoint = endpointEdit;
      const deploymentEdit = trimmed(azureDeployment, settings.azureOpenaiDeployment);
      if (deploymentEdit !== null) patch.azureOpenaiDeployment = deploymentEdit;
      const apiVersionEdit = trimmed(azureApiVersion, settings.azureOpenaiApiVersion);
      if (apiVersionEdit !== null) patch.azureOpenaiApiVersion = apiVersionEdit;
      // A blank key field means "unchanged", never "clear" — see the class doc.
      if (geminiKey.trim()) patch.geminiApiKey = geminiKey.trim();
      if (claudeKey.trim()) patch.anthropicApiKey = claudeKey.trim();
      if (openaiKey.trim()) patch.openaiApiKey = openaiKey.trim();
      if (azureOpenaiKey.trim()) patch.azureOpenaiApiKey = azureOpenaiKey.trim();
      if (speechKey.trim()) patch.azureSpeechKey = speechKey.trim();

      if (Object.keys(patch).length === 0) {
        setFeedback({ section: "ai", tone: "muted", text: t("admin.nothingToSave") });
        return;
      }
      await onSaveAi?.(patch);
      // Only now, and only on success. A key field is emptied by the save that
      // SENT it — not by a prop change, which is what used to clear it and could
      // fire for a reason that had nothing to do with keys. On a failure the typed
      // key stays in the box, because retyping a production secret you just lost
      // to an error message is not a reasonable thing to ask of anyone.
      setGeminiKey("");
      setClaudeKey("");
      setOpenaiKey("");
      setAzureOpenaiKey("");
      setSpeechKey("");
      // The keys just changed, so any probe round on screen describes the old ones.
      setProbes({});
      setProbeFailed(null);
      setFeedback({ section: "ai", tone: "success", text: t("admin.saved") });
    } catch (e) {
      setFeedback({ section: "ai", tone: "danger", text: failure(e) });
    } finally {
      setBusy(false);
    }
  };

  const testAi = async (source: "grader" | "stt") => {
    if (probing || busy) return;
    setProbing(true);
    setProbeFailed(null);
    setProbes({});
    try {
      const results = await onTestAi?.();
      setProbes(Object.fromEntries((results ?? []).map((r) => [`${r.kind}:${r.name}`, r])));
    } catch {
      // The transport failed, which says nothing about any vendor. Reported on its own
      // line rather than painting every card red for a problem none of them had.
      setProbeFailed(source);
    } finally {
      setProbing(false);
    }
  };

  const saveFeatures = async () => {
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      // Booleans go over as strings because the server's tri-state needs three states and a
      // `boolean` carries two; the numbers are sent verbatim so the server can reject an
      // out-of-range value with a message instead of silently clamping it.
      await onSaveFeatures?.({
        reviewDrillEnabled: String(drill),
        roleplayEnabled: String(roleplay),
        roleplayMaxTurns: maxTurns.trim(),
        roleplayDailyTurns: dailyTurns.trim(),
        classInsightsEnabled: String(classInsights),
        dailyFiveEnabled: String(dailyFive),
        phonemeDrillEnabled: String(phonemeDrill),
        phonemeDrillDailyAttempts: drillAttempts,
        paymentsEnabled: String(payments),
      });
      setFeedback({ section: "features", tone: "success", text: t("admin.saved") });
    } catch (e) {
      setFeedback({ section: "features", tone: "danger", text: failure(e) });
    } finally {
      setBusy(false);
    }
  };

  const saveLinks = async () => {
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    setLinkErrors({});
    try {
      await onSaveLinks?.({ tgSupportUrl: support.trim(), tgChannelUrl: channel.trim() });
      setFeedback({ section: "links", tone: "success", text: t("admin.saved") });
    } catch (e) {
      const body = adminErrorBody(e);
      if (body?.code === "invalid_link") {
        // The server names the refused field; the message goes on that input. If it
        // names neither (an older build), both inputs are suspects and the line under
        // the button says so, with the accepted format.
        const field = body.field ?? "";
        const message = t("admin.errInvalidLink");
        if (/support/i.test(field)) setLinkErrors({ support: message });
        else if (/channel/i.test(field)) setLinkErrors({ channel: message });
        else setFeedback({ section: "links", tone: "danger", text: message });
      } else {
        setFeedback({ section: "links", tone: "danger", text: failure(e) });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell
      brand={<Brand />}
      nav={{
        items: adminNavItems(t),
        activeKey: activeNavKey,
        onNavigate,
        label: t("nav.landmark"),
      }}
      headerStart={
        <Text as="h1" variant="title-m">
          {t("nav.adminSettings")}
        </Text>
      }
      headerEnd={
        <>
          <NotificationsBell />
          <AdminAccountButton />
        </>
      }
    >
      <div className={styles.page} data-density="compact">
        {/* ---- AI budget: first, because it is the switch an operator reaches for in a hurry ---- */}
        {aiBudget && <AiBudgetCard budget={aiBudget} onSave={onSaveAiBudget} />}

        {/* ---- AI grader ---- */}
        <section className={styles.section} aria-label={t("admin.aiGrader")}>
          <div className={styles.sectionHead}>
            <Text as="h2" variant="label" color="muted" className={styles.legend}>
              {t("admin.aiGrader")}
            </Text>
            <Badge variant={graderServing ? "success" : "danger"} size="sm">
              {t("admin.activeNow", { provider: graderServing ?? t("admin.noneReady") })}
            </Badge>
          </div>

          <ProbeBar
            probing={probing}
            disabled={busy}
            failed={probeFailed === "grader"}
            onTest={() => void testAi("grader")}
          />

          <Card variant="outline" padding="md" className={styles.card}>
            <ChainEditor
              label={t("admin.graderChain")}
              chain={graderChain}
              backends={settings.graderBackends}
              ready={settings.readyGraderBackends}
              onChange={setGraderChain}
            />
            {/* No "Orfoepiya tekshiruvi" switch here, on purpose. `orthoepy_enabled` is stored
                and read back, but grading never consults it — the orthoepy pass is not built
                (AssessmentService writes `orthoepy_errors: []`). A switch that changes nothing
                tells an admin a check is running when none is. Restore the row in the same
                change that makes the grader read the flag. */}
          </Card>

          {/* The probe key is `kind:name` and `name` is the server's own backend id —
              `anthropic`, not `Claude`. The card's heading is the product name because
              that is what the vendor's console calls it, so the two never coincide and
              the id is the half that has to match. */}
          <div className={styles.backends}>
            <BackendCard
              title="Claude"
              subtitle={t("admin.backendClaude")}
              ready={graderReady("anthropic")}
              probe={probes["grader:anthropic"]}
              probing={probing}
            >
              <ModelField
                label={t("admin.anthropicModel")}
                value={claudeModel}
                known={settings.knownAnthropicModels}
                onChange={setClaudeModel}
              />
              <SecretField
                label={t("admin.anthropicKey")}
                state={settings.anthropicApiKey}
                value={claudeKey}
                onChange={setClaudeKey}
              />
            </BackendCard>

            <BackendCard
              title="Gemini"
              subtitle={t("admin.backendGemini")}
              ready={graderReady("gemini")}
              probe={probes["grader:gemini"]}
              probing={probing}
            >
              <ModelField
                label={t("admin.geminiModel")}
                value={model}
                known={settings.knownGeminiModels}
                onChange={setModel}
              />
              <SecretField
                label={t("admin.geminiKey")}
                state={settings.geminiApiKey}
                value={geminiKey}
                onChange={setGeminiKey}
              />
            </BackendCard>

            {/* Readiness here is this card's OWN key, not `ready_grader_backends` — that
                list marks `openai` ready when Azure alone is configured, and a card
                showing "sozlangan" over an empty key field would be a lie about which
                credential is doing the work. */}
            <BackendCard
              title="OpenAI"
              subtitle={t("admin.backendOpenai")}
              ready={settings.openaiApiKey.set}
              probe={probes["grader:openai"]}
              probing={probing}
            >
              <ModelField
                label={t("admin.openaiModel")}
                value={openaiModel}
                known={settings.knownOpenaiModels}
                onChange={setOpenaiModel}
              />
              <SecretField
                label={t("admin.openaiKey")}
                state={settings.openaiApiKey}
                value={openaiKey}
                onChange={setOpenaiKey}
              />
              {settings.azureReady && (
                <Text as="p" variant="body-s" color="warn">
                  {t("admin.openaiAzureWins")}
                </Text>
              )}
            </BackendCard>

            {/* Not a chain row: the server has no `azure` grader backend. This is the
                `openai` backend's other route, and it wins whenever it is complete.
                For the same reason it gets no probe line: there is no `grader:azure`
                result to show, because the call the probe makes when this card is
                complete IS the `openai` one — reported on the OpenAI card, which says
                out loud that Azure is the route it took. Two cards carrying one
                result would read as two calls. */}
            <BackendCard
              title="Azure OpenAI"
              subtitle={t("admin.backendAzureOpenai")}
              ready={settings.azureReady}
            >
              <Input
                label={t("admin.azureOpenaiEndpoint")}
                value={azureEndpoint}
                onChange={(e) => setAzureEndpoint(e.currentTarget.value)}
                placeholder="https://NOM.openai.azure.com"
              />
              <Input
                label={t("admin.azureOpenaiDeployment")}
                value={azureDeployment}
                onChange={(e) => setAzureDeployment(e.currentTarget.value)}
                hint={t("admin.azureOpenaiDeploymentHint")}
              />
              <Input
                label={t("admin.azureOpenaiApiVersion")}
                value={azureApiVersion}
                onChange={(e) => setAzureApiVersion(e.currentTarget.value)}
                placeholder="2024-08-01-preview"
              />
              <SecretField
                label={t("admin.azureOpenaiKey")}
                state={settings.azureOpenaiApiKey}
                value={azureOpenaiKey}
                onChange={setAzureOpenaiKey}
              />
              <Text as="p" variant="body-s" color="muted">
                {t("admin.azureOpenaiRole")}
              </Text>
            </BackendCard>
          </div>
        </section>

        {/* ---- STT ---- */}
        <section className={styles.section} aria-label={t("admin.stt")}>
          <div className={styles.sectionHead}>
            <Text as="h2" variant="label" color="muted" className={styles.legend}>
              {t("admin.stt")}
            </Text>
            <Badge variant={sttServing ? "success" : "danger"} size="sm">
              {t("admin.activeNow", { provider: sttServing ?? t("admin.noneReady") })}
            </Badge>
          </div>

          {/* The second button buys the SAME round as the first — the endpoint takes no
              scope argument, so there is one price and one set of results however it is
              started. It is here anyway because an admin who has just pasted a Speech
              key is looking at this section, and a control that lives only under the
              other heading is a control they will not find. */}
          <ProbeBar
            probing={probing}
            disabled={busy}
            failed={probeFailed === "stt"}
            onTest={() => void testAi("stt")}
          />

          <Card variant="outline" padding="md" className={styles.card}>
            <ChainEditor
              label={t("admin.sttChain")}
              chain={sttChain}
              backends={settings.sttBackends}
              ready={settings.readySttBackends}
              onChange={setSttChain}
            />
          </Card>

          <div className={styles.backends}>
            <BackendCard
              title="Azure Speech"
              subtitle={t("admin.backendAzureSpeech")}
              ready={sttReady("azure")}
              probe={probes["stt:azure"]}
              probing={probing}
            >
              <Input
                label={t("admin.azureRegion")}
                value={region}
                onChange={(e) => setRegion(e.currentTarget.value)}
                placeholder="westeurope"
              />
              <SecretField
                label={t("admin.azureSpeechKey")}
                state={settings.azureSpeechKey}
                value={speechKey}
                onChange={setSpeechKey}
              />
            </BackendCard>

            {/* No key field on purpose: Whisper is an OpenAI endpoint and reads the same
                `openai_api_key`. A second box writing one value is how an admin ends up
                certain they cleared a key they did not. */}
            <BackendCard
              title="Whisper"
              subtitle={t("admin.backendWhisper")}
              ready={sttReady("whisper")}
              probe={probes["stt:whisper"]}
              probing={probing}
            >
              <ModelField
                label={t("admin.whisperModel")}
                value={whisperModel}
                known={settings.knownWhisperModels}
                onChange={setWhisperModel}
              />
              <Text as="p" variant="body-s" color="muted">
                {t("admin.whisperSharesKey")}
              </Text>
            </BackendCard>
          </div>

          <div className={styles.actions}>
            <SaveResult feedback={feedback} section="ai" />
            <Button variant="primary" disabled={busy} onClick={() => void saveAi()}>
              {t("admin.saveAi")}
            </Button>
          </div>
        </section>

        {/* ---- Faza 6 feature switches ---- */}
        {/* Their own section, not a row inside the AI card: these decide whether a SURFACE
            exists at all, and a switch of that weight buried under "AI sozlamalari" is a
            switch nobody finds. Both ship OFF — docs/08 is explicit that cutover must not
            wait on Faza 6. */}
        <section className={styles.section} aria-label={t("admin.features")}>
          <Text as="h2" variant="label" color="muted" className={styles.legend}>
            {t("admin.features")}
          </Text>
          <Card variant="outline" padding="md" className={styles.card}>
            <div className={styles.switchRow}>
              <span className={styles.switchText}>
                <Text as="span" variant="body" weight="semibold">
                  {t("admin.reviewDrill")}
                </Text>
                <Text as="span" variant="body-s" color="muted">
                  {t("admin.reviewDrillHint")}
                </Text>
              </span>
              <Switch checked={drill} onChange={setDrill} aria-label={t("admin.reviewDrill")} />
            </div>
            <div className={styles.switchRow}>
              <span className={styles.switchText}>
                <Text as="span" variant="body" weight="semibold">
                  {t("admin.roleplay")}
                </Text>
                <Text as="span" variant="body-s" color="muted">
                  {t("admin.roleplayHint")}
                </Text>
              </span>
              <Switch checked={roleplay} onChange={setRoleplay} aria-label={t("admin.roleplay")} />
            </div>
            <div className={styles.switchRow}>
              <span className={styles.switchText}>
                <Text as="span" variant="body" weight="semibold">
                  {t("admin.classInsights")}
                </Text>
                <Text as="span" variant="body-s" color="muted">
                  {t("admin.classInsightsHint")}
                </Text>
              </span>
              <Switch
                checked={classInsights}
                onChange={setClassInsights}
                aria-label={t("admin.classInsights")}
              />
            </div>
            <div className={styles.switchRow}>
              <span className={styles.switchText}>
                <Text as="span" variant="body" weight="semibold">
                  {t("admin.dailyFive")}
                </Text>
                <Text as="span" variant="body-s" color="muted">
                  {t("admin.dailyFiveHint")}
                </Text>
              </span>
              <Switch
                checked={dailyFive}
                onChange={setDailyFive}
                aria-label={t("admin.dailyFive")}
              />
            </div>
            <div className={styles.switchRow}>
              <span className={styles.switchText}>
                <Text as="span" variant="body" weight="semibold">
                  {t("admin.payments")}
                </Text>
                {/* The hint says the part that is easy to get wrong: this switch alone does
                    not make anything purchasable. Without it an admin turns payments "on",
                    sees nothing change, and reasonably concludes the panel is broken. */}
                <Text as="span" variant="body-s" color="muted">
                  {t("admin.paymentsHint")}
                </Text>
              </span>
              <Switch
                checked={payments}
                onChange={setPayments}
                aria-label={t("admin.payments")}
              />
            </div>
            <div className={styles.switchRow}>
              <span className={styles.switchText}>
                <Text as="span" variant="body" weight="semibold">
                  {t("admin.phonemeDrill")}
                </Text>
                {/* The hint names the cost, because this is the switch whose bill
                    scales with use: every attempt is a speech-vendor call, and two
                    when the learner missed. */}
                <Text as="span" variant="body-s" color="muted">
                  {t("admin.phonemeDrillHint")}
                </Text>
              </span>
              <Switch
                checked={phonemeDrill}
                onChange={setPhonemeDrill}
                aria-label={t("admin.phonemeDrill")}
              />
            </div>
            <Input
              label={t("admin.phonemeDrillDailyAttempts")}
              type="number"
              min={1}
              max={500}
              value={drillAttempts}
              onChange={(e) => setDrillAttempts(e.currentTarget.value)}
            />
            <Input
              label={t("admin.roleplayMaxTurns")}
              type="number"
              min={1}
              max={20}
              value={maxTurns}
              onChange={(e) => setMaxTurns(e.currentTarget.value)}
            />
            <Input
              label={t("admin.roleplayDailyTurns")}
              type="number"
              min={1}
              max={500}
              value={dailyTurns}
              onChange={(e) => setDailyTurns(e.currentTarget.value)}
            />
            <Text as="p" variant="body-s" color="muted">
              {t("admin.roleplayCostHint")}
            </Text>
            <div className={styles.actions}>
              <SaveResult feedback={feedback} section="features" />
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => void saveFeatures()}>
                {t("admin.saveFeatures")}
              </Button>
            </div>
          </Card>
        </section>

        {/* ---- Outbound links ---- */}
        <section className={styles.section} aria-label={t("admin.links")}>
          <Text as="h2" variant="label" color="muted" className={styles.legend}>
            {t("admin.links")}
          </Text>
          <Card variant="outline" padding="md" className={styles.card}>
            {/* The accepted format is stated up front, not only after a refusal: the
                server takes a full https link, and normalises a bare `t.me/…` or
                `@name` into one. */}
            <Input
              label={t("admin.tgSupport")}
              value={support}
              onChange={(e) => {
                setSupport(e.currentTarget.value);
                setLinkErrors((prev) => ({ ...prev, support: undefined }));
              }}
              placeholder="https://t.me/…"
              hint={t("admin.linkFormatHint")}
              error={linkErrors.support}
            />
            <Input
              label={t("admin.tgChannel")}
              value={channel}
              onChange={(e) => {
                setChannel(e.currentTarget.value);
                setLinkErrors((prev) => ({ ...prev, channel: undefined }));
              }}
              placeholder="https://t.me/…"
              hint={t("admin.linkFormatHint")}
              error={linkErrors.channel}
            />
            <div className={styles.actions}>
              <SaveResult feedback={feedback} section="links" />
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => void saveLinks()}>
                {t("admin.saveLinks")}
              </Button>
            </div>
          </Card>
        </section>
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Parts                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The last save's outcome, printed beside the button that produced it and nowhere
 * else. A success is a quiet status; a failure is an alert — both in the viewport the
 * admin is already looking at, because that is where their eyes are when they press.
 */
function SaveResult({ feedback, section }: { feedback: SaveFeedback | null; section: SaveSection }) {
  if (!feedback || feedback.section !== section) return null;
  return (
    <Text
      as="span"
      variant="body-s"
      color={feedback.tone}
      role={feedback.tone === "danger" ? "alert" : "status"}
      className={styles.saveResult}
    >
      {feedback.text}
    </Text>
  );
}

/**
 * ChainEditor — the ordered fallback chain for one seam (grading, or STT).
 *
 * Position carries the entire meaning: the first backend that is configured *and*
 * answers serves the request, so row 1 is what normally runs and the rows under it
 * are insurance. Every row therefore says whether it holds a key at all — a chain
 * that lists three backends with one key between them is a chain of one, and this
 * screen must not let that read as three.
 *
 * "Not configured" is deliberately worded as skipped rather than broken. The runtime
 * passes over a keyless backend silently and bills nothing for it, so an admin who
 * leaves Claude in the chain without a key has made a plan, not a mistake.
 *
 * Emptying the list is a legal state, not a trap: it clears the override, and the
 * server drops back to its own default order.
 */
function ChainEditor({
  label,
  chain,
  backends,
  ready,
  onChange,
}: {
  label: string;
  chain: string[];
  backends: string[];
  ready: string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useTranslation();
  const available = backends.filter((b) => !chain.includes(b));

  const move = (from: number, to: number) => {
    if (to < 0 || to >= chain.length) return;
    const next = chain.filter((_, i) => i !== from);
    next.splice(to, 0, chain[from]);
    onChange(next);
  };

  return (
    <div className={styles.field}>
      <Text as="span" variant="body-s" weight="semibold">
        {label}
      </Text>
      <Text as="span" variant="body-s" color="muted">
        {t("admin.chainHint")}
      </Text>

      {chain.length === 0 ? (
        <Text as="p" variant="body-s" color="warn">
          {t("admin.chainEmpty")}
        </Text>
      ) : (
        <ol className={styles.chain} aria-label={label}>
          {chain.map((name, i) => {
            const configured = ready.includes(name);
            return (
              <li key={name} className={styles.chainRow}>
                <span className={styles.chainPos}>{i + 1}</span>
                <span className={styles.chainMain}>
                  <span className={styles.chainName}>
                    <Text as="span" variant="body" weight="semibold">
                      {name}
                    </Text>
                    <Badge variant={configured ? "success" : "neutral"} size="sm" dot>
                      {configured ? t("admin.chainConfigured") : t("admin.chainNotConfigured")}
                    </Badge>
                  </span>
                  <Text as="span" variant="body-s" color="muted">
                    {configured
                      ? t("admin.chainConfiguredHint")
                      : t("admin.chainNotConfiguredHint")}
                  </Text>
                </span>
                <span className={styles.chainBtns}>
                  <button
                    type="button"
                    className={styles.chainBtn}
                    disabled={i === 0}
                    aria-label={t("admin.chainMoveUp", { backend: name })}
                    onClick={() => move(i, i - 1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={styles.chainBtn}
                    disabled={i === chain.length - 1}
                    aria-label={t("admin.chainMoveDown", { backend: name })}
                    onClick={() => move(i, i + 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className={styles.chainBtn}
                    aria-label={t("admin.chainRemove", { backend: name })}
                    onClick={() => onChange(chain.filter((b) => b !== name))}
                  >
                    ✕
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {available.length > 0 && (
        <div className={styles.chainAdd}>
          <Text as="span" variant="body-s" color="muted">
            {t("admin.chainAdd")}
          </Text>
          <div className={styles.chips}>
            {available.map((name) => (
              <button
                key={name}
                type="button"
                className={styles.chip}
                aria-label={t("admin.chainAddOne", { backend: name })}
                onClick={() => onChange([...chain, name])}
              >
                + {name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * ProbeBar — the button that answers "does this key actually work", and its price.
 *
 * The price is printed beside the control rather than in the section's prose, because
 * this is the one control on the screen that SPENDS: every press makes a real, billable
 * call to every backend that holds a key. Nothing else here costs anything, so nothing
 * else on the screen has taught the admin to expect it.
 *
 * Two of these exist and both buy the same round of calls — the endpoint has no scope
 * argument. The press is therefore blocked while a round is in flight (`loading` both
 * disables the button and marks it `aria-busy`), so a double click cannot buy the round
 * twice. It is blocked during a save as well: probing keys mid-write would report the
 * ones the server has not stored yet.
 *
 * A transport failure lands here and not on the cards. If the request never reached the
 * server, no vendor was asked anything, and marking five backends red for a problem none
 * of them had is how an admin ends up re-issuing working keys.
 */
function ProbeBar({
  probing,
  disabled,
  failed,
  onTest,
}: {
  probing: boolean;
  disabled: boolean;
  failed: boolean;
  onTest: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.probeBar}>
      <Button variant="secondary" size="sm" loading={probing} disabled={disabled} onClick={onTest}>
        {t("admin.testAi")}
      </Button>
      <Text as="span" variant="body-s" color="muted">
        {t("admin.testAiHint")}
      </Text>
      {failed && (
        <Text as="span" variant="body-s" color="danger" role="alert">
          {t("admin.probeRequestFailed")}
        </Text>
      )}
    </div>
  );
}

/**
 * BackendCard — one AI backend, everything it needs, and whether it will actually run.
 *
 * The heading is the product's own name, unlocalised: `Claude`, `Azure OpenAI`. That is
 * what the vendor's console, docs and invoice call it, and translating a product name
 * only makes the panel harder to match against the thing it configures. The `subtitle`
 * is the localised half — whose service it is, and what it actually buys you.
 *
 * The status badge carries the chain's language on purpose: a backend without a
 * credential is *skipped*, not broken. It costs nothing and it is a legitimate way to
 * leave a fallback parked.
 */
function BackendCard({
  title,
  subtitle,
  ready,
  probe,
  probing = false,
  children,
}: {
  title: string;
  subtitle: string;
  ready: boolean;
  probe?: AdminProbe;
  probing?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    // A named group, because six of these sit on one page and every one of them holds a
    // field called "API kaliti": without the product name attached, a screen reader
    // walking the form cannot tell whose key it is about to overwrite.
    <Card variant="outline" padding="md" className={styles.card} role="group" aria-label={title}>
      <div className={styles.backendHead}>
        <span className={styles.backendName}>
          <Text as="h3" variant="title-s">
            {title}
          </Text>
          <Text as="span" variant="body-s" color="muted">
            {subtitle}
          </Text>
        </span>
        <Badge variant={ready ? "success" : "neutral"} size="sm" dot>
          {ready ? t("admin.chainConfigured") : t("admin.chainNotConfigured")}
        </Badge>
      </div>
      <Text as="p" variant="body-s" color="muted">
        {ready ? t("admin.chainConfiguredHint") : t("admin.chainNotConfiguredHint")}
      </Text>
      <ProbeLine probe={probe} probing={probing} />
      {children}
    </Card>
  );
}

/**
 * What the vendor said last time it was actually called — or nothing at all, which is the
 * state this screen is in until someone spends a call.
 *
 * Three outcomes, three registers. A **skipped** backend is muted and worded as the chain
 * words it: no key, no call, no cost. Claude ships without a key on purpose, and a red
 * badge on a deliberate state is how an admin learns to stop reading the badges. A
 * **success** names the model the vendor said it served, which is the only way to find out
 * a typed model id resolved to something else. A **failure** prints the vendor's own
 * sentence rather than a house-styled paraphrase — "API key not valid" is actionable and
 * "tekshirish muvaffaqiyatsiz" is not.
 *
 * Pending is per card, not a page-wide freeze: a real vendor round trip runs into seconds
 * and a page that stops responding for four of them reads as broken.
 *
 * Every state is a `role="status"` region, so the answer reaches a screen reader without
 * the reader having to go looking for it — the whole point of the button is that you
 * cannot see whether a pasted key works. `status` and not `alert`: up to five of these
 * resolve out of one press, and five interruptions is a barrage, not information.
 */
function ProbeLine({ probe, probing }: { probe?: AdminProbe; probing: boolean }) {
  const { t } = useTranslation();

  if (probing) {
    return (
      <span className={styles.probe} role="status">
        <Spinner size="sm" label="" />
        <Text as="span" variant="body-s" color="muted">
          {t("admin.probePending")}
        </Text>
      </span>
    );
  }
  if (!probe) return null;
  if (!probe.configured) {
    return (
      <Text as="p" variant="body-s" color="muted" role="status">
        {t("admin.probeSkipped")}
      </Text>
    );
  }
  if (probe.ok) {
    return (
      <Text as="p" variant="body-s" color="success" role="status">
        {t("admin.probeOk", { model: probe.model ?? "—", ms: probe.elapsedMs })}
      </Text>
    );
  }
  return (
    <span className={styles.probe} role="status">
      {/* The badge repeats in words what the red already says, because colour is never
          the only carrier of a state (docs/03 §3.3). */}
      <Badge variant="danger" size="sm" dot>
        {t("admin.probeFailedBadge")}
      </Badge>
      <Text as="span" variant="body-s" color="danger">
        {probe.error || t("admin.probeFailedUnknown")}
      </Text>
    </span>
  );
}

/**
 * ModelField — a free-text model id with the server's curated list as SUGGESTIONS.
 *
 * The chip strip this replaced could only offer what was hard-coded at deploy time, so
 * "switch us to the model that came out this week" was a code change. Here a chip fills
 * the box and anything typed is accepted; the server takes any id and the vendor is the
 * one that decides whether it exists.
 *
 * Each suggestion shows its `note` because that is the sentence the choice is actually
 * made on — free-tier limits, price per million, whether it returns word timings. A bare
 * list of ids makes the reader guess.
 *
 * The chips are `aria-pressed` buttons rather than radios: a radiogroup claims the value
 * is one of these, and the whole point is that it need not be.
 */
function ModelField({
  label,
  value,
  known,
  onChange,
}: {
  label: string;
  value: string;
  known: KnownModel[];
  onChange: (next: string) => void;
}) {
  const { t } = useTranslation();
  const current = value.trim();
  const custom = current !== "" && !known.some((m) => m.id === current);

  return (
    <div className={styles.field}>
      <Input
        label={label}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        placeholder={t("admin.modelPlaceholder")}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />
      {current === "" && (
        <Text as="span" variant="body-s" color="muted">
          {t("admin.choiceUnset")}
        </Text>
      )}
      {custom && (
        <Text as="span" variant="body-s" color="muted">
          {t("admin.modelCustom")}
        </Text>
      )}
      {/* An empty list is normal, not an error: an API image that predates the curated
          list still serves every other field, and the box works without suggestions. */}
      {known.length > 0 && (
        <div className={styles.suggestions} role="group" aria-label={t("admin.modelSuggestions")}>
          <Text as="span" variant="body-s" color="muted">
            {t("admin.modelSuggestions")}
          </Text>
          <div className={styles.chips}>
            {known.map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={m.id === current}
                className={m.id === current ? styles.chipOn : styles.chip}
                onClick={() => onChange(m.id)}
              >
                <span className={styles.chipLabel}>{modelLabel(m.label, t)}</span>
                {m.note && <span className={styles.chipNote}>{modelNote(m.id, m.note, t)}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** A stored secret: its state, and a field to REPLACE it. Never its value.
 * Blank means unchanged — the hint below the field says so, because an empty box
 * next to a "Save" button otherwise reads as "this will be cleared". */
function SecretField({
  label,
  state,
  value,
  onChange,
}: {
  label: string;
  state: AdminSecret;
  value: string;
  onChange: (next: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.field}>
      <span className={styles.secretHead}>
        <Text as="span" variant="body-s" weight="semibold">
          {label}
        </Text>
        <Badge variant={state.set ? "success" : "neutral"} size="sm">
          {state.set ? t("admin.secretSet", { hint: state.hint }) : t("admin.secretUnset")}
        </Badge>
      </span>
      <Input
        type="password"
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        placeholder={t("admin.secretPlaceholder")}
        aria-label={label}
      />
      <Text as="span" variant="body-s" color="muted">
        {t("admin.secretBlankHint")}
      </Text>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Default export — a self-wired demo.                                        */
/* -------------------------------------------------------------------------- */

export default function AdminSettingsDemo() {
  return <AdminSettingsScreen settings={mockAdminSettings} />;
}
