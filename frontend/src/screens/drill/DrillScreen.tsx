/**
 * DrillScreen — «Tovushlar mashqi», the F2 minimal-pair drill (docs/01 F2,
 * behind the `phoneme_drill_enabled` flag).
 *
 * **What this screen is NOT.** The original plan was a per-sound scoreboard:
 * "your ы scored 62". That screen cannot be built truthfully — Azure returns no
 * phoneme NAMES for Russian (measured: every name comes back empty, in scripted
 * mode too, where the same request against en-US returns full IPA). Building it
 * anyway would have meant inventing labels for numbers, which is the one thing
 * a pronunciation tool must never do.
 *
 * So the screen shows a CONSEQUENCE instead of a score. The learner is asked for
 * `мышка`; if the recogniser heard `мишка`, it says so — with both meanings, in
 * Uzbek, side by side: you asked for a mouse and said bear. That sentence needs
 * no phoneme inventory, a learner can act on it immediately, and it stays true
 * whether or not the vendor ever adds Russian.
 *
 * The per-sound row underneath is DECORATION and is built to be missing. The
 * server drops it whenever Azure returned nothing, when the vendor failed, or
 * when our own IPA spelling disagrees with Azure's segmentation — so this screen
 * renders a complete result from `phonemes: []` and never treats its absence as
 * an error.
 *
 * Presentational + prop-driven: it fetches nothing and owns no server state. The
 * only state it owns is which twin is being drilled right now. Full-width per
 * docs/04 §4.10; every colour / space / radius value is a token and all copy
 * resolves through `drill.*`.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card, Recorder, Text } from "../../shared/ui";
import { AppShell, Brand, NotificationsBell, studentNavItems } from "../../widgets";
// The browser's own voice, not the billed TTS provider — the same call the daily
// warm-up makes, for the same reason: hearing the word is half the exercise, and
// it must not open a new spending path for a step that exists to be free.
import { useRussianVoice } from "../daily/useRussianVoice";
import { mockDrillPairs } from "./drill.mock";
import styles from "./DrillScreen.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

/** Why the drill cannot run — mirrors the server's `DrillState`. Each one gets
 * its own sentence: "not shipped here", "no key wired" and "you are out of
 * attempts for today" send a person in three different directions. */
export type DrillState = "ready" | "disabled" | "unconfigured" | "budget_spent";

/** What the learner did. `twin` is the teachable failure — the only outcome that
 * can name the sound that went wrong. */
export type DrillOutcome = "correct" | "twin" | "other" | "silent";

/** One authored minimal pair. */
export interface DrillPair {
  slug: string;
  /** The contrast as the card shows it — «ы / и». Russian letters, not IPA: the
   * learner is here to read Russian, and IPA would be a second notation to learn
   * before the first has landed. */
  contrastRu: string;
  /** Why an Uzbek speaker gets this wrong. The teaching. */
  whyUz: string;
  level: string;
  wordA: string;
  wordB: string;
  /** What each twin MEANS. Load-bearing, not decorative — the meaning is what
   * turns a mispronunciation into a consequence. */
  glossAUz: string;
  glossBUz: string;
  ipaA: string[];
  ipaB: string[];
  focusIndexA: number;
  focusIndexB: number;
  attempts: number;
  correct: number;
}

/** One sound of the target word. `score` is null when Azure said nothing about
 * that position. */
export interface DrillPhoneme {
  ipa: string;
  score: number | null;
  focus: boolean;
}

/** The result of one attempt. */
export interface DrillResult {
  outcome: DrillOutcome;
  targetWord: string;
  /** Verbatim, from the UNSCRIPTED pass — the evidence behind the verdict. */
  heardText: string | null;
  /** The twin they said instead, when `outcome === "twin"`. */
  heardWord: string | null;
  accuracy: number | null;
  /** EMPTY is normal and must render fine. */
  phonemes: DrillPhoneme[];
}

export interface DrillScreenProps {
  state: DrillState;
  pairs: DrillPair[];
  dailyLeft: number;
  /** The pair being drilled, or null for the hub grid. */
  activePair: DrillPair | null;
  /** Which twin was asked for. */
  targetWord: string | null;
  result: DrillResult | null;
  busy?: boolean;
  error?: string | null;
  onPick: (pair: DrillPair, word: string) => void;
  onSubmit: (audio: Blob) => void;
  /** Try the same word again — clears the result without leaving the pair. */
  onRetry: () => void;
  /** Back to the pair grid. */
  onBack: () => void;
  activeNavKey?: string;
  onNavigate?: (key: string) => void;
}

/* -------------------------------------------------------------------------- */
/* Score → token. Shared by the phoneme chips and the accuracy read.          */
/* -------------------------------------------------------------------------- */

/** The design system already carries `--pron-good/mid/low/neutral`; this is the
 * only place the thresholds are decided so the chips and the summary cannot
 * disagree about what "good" means. */
function bandOf(score: number | null): "good" | "mid" | "low" | "neutral" {
  if (score === null) return "neutral";
  if (score >= 80) return "good";
  if (score >= 50) return "mid";
  return "low";
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

export function DrillScreen({
  state,
  pairs,
  dailyLeft,
  activePair,
  targetWord,
  result,
  busy = false,
  error = null,
  onPick,
  onSubmit,
  onRetry,
  onBack,
  activeNavKey = "practice",
  onNavigate,
}: DrillScreenProps) {
  const { t } = useTranslation();

  return (
    <AppShell
      brand={<Brand />}
      nav={{
        items: studentNavItems(t),
        activeKey: activeNavKey,
        onNavigate,
        label: t("nav.landmark"),
      }}
      headerStart={
        <Text as="h1" variant="title-m">
          {t("drill.title")}
        </Text>
      }
      headerEnd={<NotificationsBell />}
    >
      <div className={styles.page}>
        {state !== "ready" && state !== "budget_spent" ? (
          <Blocked state={state} />
        ) : activePair ? (
          <DrillCard
            key={`${activePair.slug}:${targetWord ?? ""}`}
            pair={activePair}
            targetWord={targetWord ?? activePair.wordA}
            result={result}
            busy={busy}
            error={error}
            exhausted={state === "budget_spent"}
            onSubmit={onSubmit}
            onRetry={onRetry}
            onBack={onBack}
          />
        ) : (
          <PairGrid
            pairs={pairs}
            dailyLeft={dailyLeft}
            exhausted={state === "budget_spent"}
            onPick={onPick}
          />
        )}
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Hub — the pair grid                                                        */
/* -------------------------------------------------------------------------- */

interface PairGridProps {
  pairs: DrillPair[];
  dailyLeft: number;
  exhausted: boolean;
  onPick: (pair: DrillPair, word: string) => void;
}

function PairGrid({ pairs, dailyLeft, exhausted, onPick }: PairGridProps) {
  const { t } = useTranslation();

  return (
    <>
      <div className={styles.hubHead}>
        <Text variant="body" color="ink-soft" className={styles.lede}>
          {t("drill.lede")}
        </Text>
        {exhausted ? (
          <Badge variant="warn">{t("drill.budgetSpentShort")}</Badge>
        ) : (
          <Text variant="body-s" color="muted">
            {t("drill.dailyLeft", { count: dailyLeft })}
          </Text>
        )}
      </div>

      {pairs.length === 0 ? (
        <Card variant="outline" padding="lg">
          <Text variant="body" color="muted">
            {t("drill.noPairs")}
          </Text>
        </Card>
      ) : (
        <ul className={styles.grid}>
          {pairs.map((pair) => (
            <li key={pair.slug}>
              <PairTile pair={pair} disabled={exhausted} onPick={onPick} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function PairTile({
  pair,
  disabled,
  onPick,
}: {
  pair: DrillPair;
  disabled: boolean;
  onPick: (pair: DrillPair, word: string) => void;
}) {
  const { t } = useTranslation();
  const voice = useRussianVoice();

  return (
    <Card variant="raised" padding="lg" className={styles.tile}>
      <div className={styles.tileHead}>
        <Text variant="title-m" className={styles.contrast}>
          {pair.contrastRu}
        </Text>
        <Badge variant="neutral" size="sm">
          {pair.level}
        </Badge>
      </div>

      <Text variant="body-s" color="ink-soft" className={styles.why}>
        {pair.whyUz}
      </Text>

      {/* Both twins, each its own button: picking a word IS starting the drill,
       * so there is no separate "start" step to get lost between. */}
      <div className={styles.twins}>
        {(
          [
            [pair.wordA, pair.glossAUz],
            [pair.wordB, pair.glossBUz],
          ] as const
        ).map(([word, gloss]) => (
          <button
            key={word}
            type="button"
            className={styles.twin}
            disabled={disabled}
            onClick={() => onPick(pair, word)}
          >
            <span className={styles.twinWord}>{word}</span>
            <span className={styles.twinGloss}>{gloss}</span>
          </button>
        ))}
      </div>

      <div className={styles.tileFoot}>
        {pair.attempts > 0 ? (
          <Text variant="body-s" color="muted">
            {t("drill.tileProgress", {
              correct: pair.correct,
              total: pair.attempts,
            })}
          </Text>
        ) : (
          <Text variant="body-s" color="muted">
            {t("drill.tileFresh")}
          </Text>
        )}
        {voice.available && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => voice.speak(`${pair.wordA}. ${pair.wordB}.`)}
          >
            {t("drill.listenBoth")}
          </Button>
        )}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* One drill: hear it → say it → the consequence                              */
/* -------------------------------------------------------------------------- */

interface DrillCardProps {
  pair: DrillPair;
  targetWord: string;
  result: DrillResult | null;
  busy: boolean;
  error: string | null;
  exhausted: boolean;
  onSubmit: (audio: Blob) => void;
  onRetry: () => void;
  onBack: () => void;
}

function DrillCard({
  pair,
  targetWord,
  result,
  busy,
  error,
  exhausted,
  onSubmit,
  onRetry,
  onBack,
}: DrillCardProps) {
  const { t } = useTranslation();
  const voice = useRussianVoice();

  const isA = targetWord === pair.wordA;
  const twinWord = isA ? pair.wordB : pair.wordA;
  const targetGloss = isA ? pair.glossAUz : pair.glossBUz;
  const twinGloss = isA ? pair.glossBUz : pair.glossAUz;

  // Stop the voice when the card changes, so a word never keeps talking over the
  // next one.
  useEffect(() => voice.cancel, [voice, targetWord]);

  return (
    <Card variant="raised" padding="lg" className={styles.card}>
      <div className={styles.col}>
        <div className={styles.cardHead}>
          <Button variant="ghost" size="sm" onClick={onBack}>
            {t("drill.back")}
          </Button>
          <Badge variant="neutral" size="sm">
            {pair.contrastRu}
          </Badge>
        </div>

        <Text variant="label" color="muted">
          {t("drill.sayThis")}
        </Text>

        <p className={styles.target} lang="ru">
          {targetWord}
        </p>
        <Text variant="body" color="ink-soft">
          {targetGloss}
        </Text>

        {voice.available && (
          <Button
            variant="secondary"
            size="sm"
            className={styles.listen}
            onClick={() => voice.speak(targetWord)}
          >
            {t("drill.listen")}
          </Button>
        )}

        {/* The trap, stated up front. Naming the twin BEFORE they speak is the
         * teaching: it tells them what to avoid, rather than only telling them
         * afterwards that they fell into it. */}
        <div className={styles.trap}>
          <Text variant="body-s" color="muted">
            {t("drill.notThis")}
          </Text>
          <Text variant="body" weight="semibold" className={styles.trapWord}>
            <span lang="ru">{twinWord}</span>{" "}
            <span className={styles.trapGloss}>· {twinGloss}</span>
          </Text>
        </div>

        <Text variant="body-s" color="ink-soft" className={styles.why}>
          {pair.whyUz}
        </Text>
      </div>

      <div className={styles.col}>
        {result ? (
          <Verdict
            result={result}
            targetGloss={targetGloss}
            twinGloss={twinGloss}
            exhausted={exhausted}
            onRetry={onRetry}
            onBack={onBack}
          />
        ) : (
          <div className={styles.speak}>
            {/* Five seconds is the cap because the task is ONE WORD. A long
              * window invites a sentence, and a sentence is a different exercise
              * that this screen cannot score. */}
            <Recorder
              maxDurationMs={5000}
              onComplete={onSubmit}
              labels={{ idleHint: t("drill.recordHint") }}
            />
            {busy && (
              <Text variant="body-s" color="muted">
                {t("drill.checking")}
              </Text>
            )}
            {error && (
              <Text variant="body-s" color="danger" role="alert">
                {error}
              </Text>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* The verdict — the whole point of the feature                               */
/* -------------------------------------------------------------------------- */

function Verdict({
  result,
  targetGloss,
  twinGloss,
  exhausted,
  onRetry,
  onBack,
}: {
  result: DrillResult;
  targetGloss: string;
  twinGloss: string;
  exhausted: boolean;
  onRetry: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();

  const tone =
    result.outcome === "correct"
      ? "good"
      : result.outcome === "twin"
        ? "low"
        : "neutral";

  return (
    <div className={styles.verdict} data-tone={tone}>
      <Text
        as="h2"
        variant="title-s"
        color={result.outcome === "correct" ? "success" : "ink"}
      >
        {t(`drill.outcome.${result.outcome}.title`)}
      </Text>

      {/* The consequence, side by side. This is the sentence the whole feature
       * exists to be able to say. */}
      {result.outcome === "twin" && result.heardWord && (
        <div className={styles.swap}>
          <div className={styles.swapRow} data-side="said">
            <Text variant="label" color="muted">
              {t("drill.youSaid")}
            </Text>
            <Text variant="title-m" className={styles.swapWord}>
              <span lang="ru">{result.heardWord}</span>
            </Text>
            <Text variant="body-s" color="ink-soft">
              {twinGloss}
            </Text>
          </div>
          <div className={styles.swapRow} data-side="meant">
            <Text variant="label" color="muted">
              {t("drill.youMeant")}
            </Text>
            <Text variant="title-m" className={styles.swapWord}>
              <span lang="ru">{result.targetWord}</span>
            </Text>
            <Text variant="body-s" color="ink-soft">
              {targetGloss}
            </Text>
          </div>
        </div>
      )}

      {/* An unrelated word or silence: say what was heard rather than pretending
       * it was a phoneme error. Guessing would teach the wrong lesson. */}
      {(result.outcome === "other" || result.outcome === "silent") && (
        <Text variant="body" color="ink-soft">
          {result.outcome === "other" && result.heardText
            ? t("drill.heardInstead", { text: result.heardText })
            : t("drill.outcome.silent.hint")}
        </Text>
      )}

      {/* Decoration. Absent whenever the server could not vouch for it. */}
      {result.phonemes.length > 0 && (
        <div className={styles.sounds}>
          <Text variant="label" color="muted">
            {t("drill.soundsLabel")}
          </Text>
          <ul className={styles.chips}>
            {result.phonemes.map((p, i) => (
              <li
                // IPA symbols repeat within a word, so the index is the identity
                // here — the list is fixed-length and never reordered.
                key={`${p.ipa}-${i}`}
                className={styles.chip}
                data-band={bandOf(p.score)}
                data-focus={p.focus ? "true" : undefined}
              >
                <span className={styles.chipIpa}>{p.ipa}</span>
                <span className={styles.chipScore}>
                  {p.score === null ? "—" : Math.round(p.score)}
                </span>
              </li>
            ))}
          </ul>
          <Text variant="body-s" color="muted">
            {t("drill.soundsHint")}
          </Text>
        </div>
      )}

      <div className={styles.verdictActions}>
        {exhausted ? (
          <Text variant="body-s" color="warn">
            {t("drill.budgetSpentShort")}
          </Text>
        ) : (
          <Button variant="primary" onClick={onRetry}>
            {t("drill.again")}
          </Button>
        )}
        <Button variant="ghost" onClick={onBack}>
          {t("drill.pickAnother")}
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Blocked states                                                             */
/* -------------------------------------------------------------------------- */

function Blocked({ state }: { state: DrillState }) {
  const { t } = useTranslation();

  return (
    <Card variant="outline" padding="lg" className={styles.blocked}>
      <Text as="h2" variant="title-s">
        {t(`drill.blocked.${state}.title`)}
      </Text>
      <Text variant="body" color="ink-soft">
        {t(`drill.blocked.${state}.hint`)}
      </Text>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Demo — the screen wired to mock data, renderable standalone                */
/* -------------------------------------------------------------------------- */

export default function DrillScreenDemo() {
  const [activePair, setActivePair] = useState<DrillPair | null>(null);
  const [targetWord, setTargetWord] = useState<string | null>(null);
  const [result, setResult] = useState<DrillResult | null>(null);

  const pick = useCallback((pair: DrillPair, word: string) => {
    setActivePair(pair);
    setTargetWord(word);
    setResult(null);
  }, []);

  const submit = useCallback(() => {
    if (!activePair || !targetWord) return;
    const isA = targetWord === activePair.wordA;
    setResult({
      outcome: "twin",
      targetWord,
      heardText: isA ? activePair.wordB : activePair.wordA,
      heardWord: isA ? activePair.wordB : activePair.wordA,
      accuracy: 49,
      phonemes: (isA ? activePair.ipaA : activePair.ipaB).map((ipa, i) => ({
        ipa,
        score: i <= 2 ? 0 : 100,
        focus: i === (isA ? activePair.focusIndexA : activePair.focusIndexB),
      })),
    });
  }, [activePair, targetWord]);

  return (
    <DrillScreen
      state="ready"
      pairs={mockDrillPairs}
      dailyLeft={38}
      activePair={activePair}
      targetWord={targetWord}
      result={result}
      onPick={pick}
      onSubmit={submit}
      onRetry={() => setResult(null)}
      onBack={() => {
        setActivePair(null);
        setResult(null);
      }}
    />
  );
}
