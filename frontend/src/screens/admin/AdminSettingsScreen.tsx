import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card, Input, Switch, Text } from "../../shared/ui";
import { AppShell, Brand, NotificationsBell, adminNavItems } from "../../widgets";
import type { NavItem } from "../../widgets";
import { mockAdminSettings } from "./admin.mock";
import styles from "./AdminSettingsScreen.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

/** A stored secret as the server is willing to describe it: whether it is set, and
 * a hint. The value itself only ever arrives through an explicit reveal. */
export interface AdminSecret {
  set: boolean;
  hint: string;
}

export interface AdminSettings {
  llmProvider: string;
  geminiModel: string;
  knownGeminiModels: Array<{ id: string; label: string; note: string }>;
  anthropicModel: string;
  knownAnthropicModels: Array<{ id: string; label: string; note: string }>;
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
  azureSpeechKey?: string;
  openaiApiKey?: string;
  /** Comma-joined order. `""` is a real, reachable value here: an emptied chain
   * clears the override and the server falls back to its own default order. */
  graderChain?: string;
  sttChain?: string;
  anthropicApiKey?: string;
  anthropicModel?: string;
}

export interface AdminSettingsProps {
  settings: AdminSettings;
  activeNavKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
  onSaveAi?: (patch: AdminSettingsPatch) => Promise<void>;
  onSaveLinks?: (patch: { tgSupportUrl?: string; tgChannelUrl?: string }) => Promise<void>;
}

const LLM_PROVIDERS = ["auto", "gemini", "azure"];
const STT_PROVIDERS = ["auto", "azure", "whisper"];

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
 */
export function AdminSettingsScreen({
  settings,
  activeNavKey = "settings",
  onNavigate,
  onSaveAi,
  onSaveLinks,
}: AdminSettingsProps) {
  const { t } = useTranslation();

  const [llm, setLlm] = useState(settings.llmProvider);
  const [model, setModel] = useState(settings.geminiModel);
  const [claudeModel, setClaudeModel] = useState(settings.anthropicModel);
  const [graderChain, setGraderChain] = useState(() => parseChain(settings.graderChain));
  const [sttChain, setSttChain] = useState(() => parseChain(settings.sttChain));
  const [orthoepy, setOrthoepy] = useState(settings.orthoepyEnabled);
  const [stt, setStt] = useState(settings.sttProvider);
  const [region, setRegion] = useState(settings.azureSpeechRegion);
  const [geminiKey, setGeminiKey] = useState("");
  const [claudeKey, setClaudeKey] = useState("");
  const [speechKey, setSpeechKey] = useState("");
  const [support, setSupport] = useState(settings.tgSupportUrl);
  const [channel, setChannel] = useState(settings.tgChannelUrl);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-seed from a fresh fetch (after any save).
  useEffect(() => {
    setLlm(settings.llmProvider);
    setModel(settings.geminiModel);
    setClaudeModel(settings.anthropicModel);
    setGraderChain(parseChain(settings.graderChain));
    setSttChain(parseChain(settings.sttChain));
    setOrthoepy(settings.orthoepyEnabled);
    setStt(settings.sttProvider);
    setRegion(settings.azureSpeechRegion);
    setSupport(settings.tgSupportUrl);
    setChannel(settings.tgChannelUrl);
    setGeminiKey("");
    setClaudeKey("");
    setSpeechKey("");
  }, [settings]);

  const saveAi = async () => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    setError(null);
    try {
      const patch: AdminSettingsPatch = {};
      if (llm !== settings.llmProvider) patch.llmProvider = llm;
      if (model !== settings.geminiModel) patch.geminiModel = model;
      if (claudeModel !== settings.anthropicModel) patch.anthropicModel = claudeModel;
      // Compare against the PARSED server value: the wire form may carry spaces or a
      // duplicate, and an untouched chain must not look edited.
      const graderOrder = graderChain.join(",");
      const sttOrder = sttChain.join(",");
      if (graderOrder !== parseChain(settings.graderChain).join(","))
        patch.graderChain = graderOrder;
      if (sttOrder !== parseChain(settings.sttChain).join(",")) patch.sttChain = sttOrder;
      if (orthoepy !== settings.orthoepyEnabled) patch.orthoepyEnabled = String(orthoepy);
      if (stt !== settings.sttProvider) patch.sttProvider = stt;
      if (region !== settings.azureSpeechRegion) patch.azureSpeechRegion = region;
      // A blank key field means "unchanged", never "clear" — see the class doc.
      if (geminiKey.trim()) patch.geminiApiKey = geminiKey.trim();
      if (claudeKey.trim()) patch.anthropicApiKey = claudeKey.trim();
      if (speechKey.trim()) patch.azureSpeechKey = speechKey.trim();

      if (Object.keys(patch).length === 0) {
        setNote(t("admin.nothingToSave"));
        return;
      }
      await onSaveAi?.(patch);
      setNote(t("admin.saved"));
    } catch {
      setError(t("admin.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const saveLinks = async () => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    setError(null);
    try {
      await onSaveLinks?.({ tgSupportUrl: support.trim(), tgChannelUrl: channel.trim() });
      setNote(t("admin.saved"));
    } catch {
      setError(t("admin.saveFailed"));
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
      headerEnd={<NotificationsBell />}
    >
      <div className={styles.page} data-density="compact">
        {/* ---- AI grader ---- */}
        <section className={styles.section} aria-label={t("admin.aiGrader")}>
          <div className={styles.sectionHead}>
            <Text as="h2" variant="label" color="faint" className={styles.legend}>
              {t("admin.aiGrader")}
            </Text>
            <Badge variant={settings.activeProvider === "none" ? "danger" : "success"} size="sm">
              {t("admin.activeNow", { provider: settings.activeProvider })}
            </Badge>
          </div>

          <Card variant="outline" padding="md" className={styles.card}>
            <ChainEditor
              label={t("admin.graderChain")}
              chain={graderChain}
              backends={settings.graderBackends}
              ready={settings.readyGraderBackends}
              onChange={setGraderChain}
            />
            <Choice
              label={t("admin.provider")}
              value={llm}
              options={LLM_PROVIDERS}
              onChange={setLlm}
            />
            <Choice
              label={t("admin.geminiModel")}
              value={model}
              options={settings.knownGeminiModels.map((m) => m.id)}
              labels={Object.fromEntries(settings.knownGeminiModels.map((m) => [m.id, m.label]))}
              variant="chips"
              onChange={setModel}
            />
            <SecretField
              label={t("admin.geminiKey")}
              state={settings.geminiApiKey}
              value={geminiKey}
              onChange={setGeminiKey}
            />
            <Choice
              label={t("admin.anthropicModel")}
              value={claudeModel}
              options={settings.knownAnthropicModels.map((m) => m.id)}
              labels={Object.fromEntries(settings.knownAnthropicModels.map((m) => [m.id, m.label]))}
              variant="chips"
              onChange={setClaudeModel}
            />
            <SecretField
              label={t("admin.anthropicKey")}
              state={settings.anthropicApiKey}
              value={claudeKey}
              onChange={setClaudeKey}
            />
            <div className={styles.switchRow}>
              <span className={styles.switchText}>
                <Text as="span" variant="body" weight="semibold">
                  {t("admin.orthoepy")}
                </Text>
                <Text as="span" variant="body-s" color="muted">
                  {t("admin.orthoepyHint")}
                </Text>
              </span>
              <Switch checked={orthoepy} onChange={setOrthoepy} aria-label={t("admin.orthoepy")} />
            </div>
            {/* Read-only status: Azure is only usable once its endpoint, deployment
                and key are all present, which is a server-side judgement. */}
            <Text as="p" variant="body-s" color={settings.azureReady ? "success" : "muted"}>
              {settings.azureReady ? t("admin.azureReady") : t("admin.azureNotReady")}
            </Text>
          </Card>
        </section>

        {/* ---- STT ---- */}
        <section className={styles.section} aria-label={t("admin.stt")}>
          <div className={styles.sectionHead}>
            <Text as="h2" variant="label" color="faint" className={styles.legend}>
              {t("admin.stt")}
            </Text>
            <Badge variant={settings.sttActiveProvider === "none" ? "danger" : "success"} size="sm">
              {t("admin.activeNow", { provider: settings.sttActiveProvider })}
            </Badge>
          </div>

          <Card variant="outline" padding="md" className={styles.card}>
            <ChainEditor
              label={t("admin.sttChain")}
              chain={sttChain}
              backends={settings.sttBackends}
              ready={settings.readySttBackends}
              onChange={setSttChain}
            />
            <Choice
              label={t("admin.provider")}
              value={stt}
              options={STT_PROVIDERS}
              onChange={setStt}
            />
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
            <Text as="p" variant="body-s" color={settings.azureSpeechReady ? "success" : "muted"}>
              {settings.azureSpeechReady ? t("admin.azureReady") : t("admin.azureNotReady")}
            </Text>
          </Card>

          <div className={styles.actions}>
            <Button variant="primary" disabled={busy} onClick={() => void saveAi()}>
              {t("admin.saveAi")}
            </Button>
          </div>
        </section>

        {/* ---- Outbound links ---- */}
        <section className={styles.section} aria-label={t("admin.links")}>
          <Text as="h2" variant="label" color="faint" className={styles.legend}>
            {t("admin.links")}
          </Text>
          <Card variant="outline" padding="md" className={styles.card}>
            <Input
              label={t("admin.tgSupport")}
              value={support}
              onChange={(e) => setSupport(e.currentTarget.value)}
              placeholder="https://t.me/…"
            />
            <Input
              label={t("admin.tgChannel")}
              value={channel}
              onChange={(e) => setChannel(e.currentTarget.value)}
              placeholder="https://t.me/…"
            />
            <div className={styles.actions}>
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => void saveLinks()}>
                {t("admin.saveLinks")}
              </Button>
            </div>
          </Card>
        </section>

        {note && (
          <Text as="p" variant="body-s" color="success" role="status">
            {note}
          </Text>
        )}
        {error && (
          <Text as="p" variant="body-s" color="danger" role="alert">
            {error}
          </Text>
        )}
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Parts                                                                      */
/* -------------------------------------------------------------------------- */

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
 * A radiogroup rather than a `<select>` so every option is visible — which grader
 * runs is worth seeing at a glance rather than opening a menu to discover.
 *
 * Two layouts, because one does not fit both cases. `segmented` is the pill strip
 * for two or three short words (`auto · gemini · azure`). `chips` gives each option
 * its own bordered chip, for the model list: five entries with labels like
 * "Gemini 2.5 Flash (avoid on free tier)" wrapped inside a single pill read as a
 * paragraph, and the selected one was impossible to pick out.
 *
 * When nothing is selected — `gemini_model` is genuinely `""` until an admin picks
 * one — the group says so. Without that line, a control with no highlighted option
 * looks like a rendering bug rather than an unset setting.
 */
function Choice({
  label,
  value,
  options,
  labels,
  variant = "segmented",
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  labels?: Record<string, string>;
  variant?: "segmented" | "chips";
  onChange: (next: string) => void;
}) {
  const { t } = useTranslation();
  const chips = variant === "chips";
  const selected = options.includes(value);

  return (
    <div className={styles.field}>
      <Text as="span" variant="body-s" weight="semibold">
        {label}
      </Text>
      <div className={chips ? styles.chips : styles.choices} role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={o === value}
            className={
              chips
                ? o === value
                  ? styles.chipOn
                  : styles.chip
                : o === value
                  ? styles.choiceOn
                  : styles.choice
            }
            onClick={() => onChange(o)}
          >
            {labels?.[o] ?? o}
          </button>
        ))}
      </div>
      {!selected && (
        <Text as="span" variant="body-s" color="faint">
          {value ? t("admin.choiceUnknown", { value }) : t("admin.choiceUnset")}
        </Text>
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
      <Text as="span" variant="body-s" color="faint">
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
