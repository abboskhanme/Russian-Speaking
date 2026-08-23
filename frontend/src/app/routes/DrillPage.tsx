/**
 * DrillPage (`/drill`) — the F2 minimal-pair drill (docs/01 F2).
 *
 *   • `GET  /api/drills/pairs`    → the curated pairs + whether speaking is on
 *   • `POST /api/drills/attempts` → one spoken word, judged against the pair
 *
 * It sits in the student subtree with `activeNavKey="practice"`: the drill is a
 * way to practise, not a sixth destination, and the 5-item bar stays 5 items.
 *
 * **Flag handling differs from the review drill on purpose.** That route answers
 * 404 while its flag is off and this page would then leave for Mashq. This one
 * answers 200 with `state`, because the drill has three distinct blocked states —
 * not enabled here, no speech key wired, today's attempts used — and each needs
 * its own sentence. Bouncing all three to Mashq would hide an operator problem
 * (a missing key) behind the same silence as a deliberate product decision.
 *
 * **The pair list is refetched after every attempt.** The per-pair progress and
 * the daily remaining count both change server-side, and a local decrement would
 * drift the moment the student drills on a second device.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { DrillScreen } from "../../screens/drill";
import type {
  DrillOutcome,
  DrillPair,
  DrillResult,
  DrillState,
} from "../../screens/drill";
import { endpoints } from "../../shared/api";
import type {
  DrillCatalogResponse,
  DrillPairResponse,
  DrillResultResponse,
  DrillStateWire,
} from "../../shared/api";
import { PageError, PageLoading } from "../PageState";
import { useNavHandler } from "../nav";

/** Wire state → the screen's state. The wire spells them PascalCase (a C# enum
 * serialized by name); the screen uses the app's own snake style. */
function toState(state: DrillStateWire): DrillState {
  switch (state) {
    case "Ready":
      return "ready";
    case "Disabled":
      return "disabled";
    case "Unconfigured":
      return "unconfigured";
    case "BudgetSpent":
      return "budget_spent";
  }
}

function toPair(p: DrillPairResponse): DrillPair {
  return {
    slug: p.slug,
    contrastRu: p.contrast_ru,
    whyUz: p.why_uz,
    level: p.level,
    wordA: p.word_a,
    wordB: p.word_b,
    glossAUz: p.gloss_a_uz,
    glossBUz: p.gloss_b_uz,
    ipaA: p.ipa_a,
    ipaB: p.ipa_b,
    focusIndexA: p.focus_index_a,
    focusIndexB: p.focus_index_b,
    attempts: p.attempts,
    correct: p.correct,
  };
}

function toResult(r: DrillResultResponse): DrillResult {
  return {
    outcome: r.outcome.toLowerCase() as DrillOutcome,
    targetWord: r.target_word,
    heardText: r.heard_text,
    heardWord: r.heard_word,
    accuracy: r.accuracy,
    // Empty is the normal case whenever the server could not vouch for the
    // alignment; the screen renders a complete verdict without it.
    phonemes: r.phonemes ?? [],
  };
}

export default function DrillPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const onNavigate = useNavHandler();

  const [state, setState] = useState<DrillState>("ready");
  const [pairs, setPairs] = useState<DrillPair[]>([]);
  const [dailyLeft, setDailyLeft] = useState(0);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [targetWord, setTargetWord] = useState<string | null>(null);
  const [result, setResult] = useState<DrillResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const apply = useCallback((catalog: DrillCatalogResponse) => {
    setState(toState(catalog.state));
    setPairs(catalog.pairs.map(toPair));
    setDailyLeft(catalog.daily_left);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);

    endpoints
      .drillPairs(controller.signal)
      .then((catalog) => {
        if (!alive.current) return;
        apply(catalog);
        setLoading(false);
      })
      .catch(() => {
        if (!alive.current || controller.signal.aborted) return;
        setFailed(true);
        setLoading(false);
      });

    return () => controller.abort();
  }, [apply, reloadKey]);

  const handlePick = useCallback((pair: DrillPair, word: string) => {
    setActiveSlug(pair.slug);
    setTargetWord(word);
    setResult(null);
    setError(null);
  }, []);

  const handleSubmit = useCallback(
    async (audio: Blob) => {
      if (!activeSlug || !targetWord || busy) return;
      setBusy(true);
      setError(null);
      try {
        const res = await endpoints.submitDrillAttempt(activeSlug, targetWord, audio);
        if (!alive.current) return;

        // A blocked state comes back on the SAME 200 body, so read it before
        // treating the payload as a verdict — otherwise a spent budget would
        // render as a silent, scoreless "result".
        const next = toState(res.state);
        setState(next);
        setDailyLeft(res.daily_left);
        if (next === "ready") setResult(toResult(res));

        // Refetch so the tile progress and the remaining count come from the
        // server's own recount rather than from this screen's optimism.
        endpoints
          .drillPairs()
          .then((catalog) => {
            if (alive.current) apply(catalog);
          })
          .catch(() => {
            /* the verdict is already shown; a stale tile count is not worth an error */
          });
      } catch {
        if (!alive.current) return;
        setError(t("drill.submitError"));
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [activeSlug, apply, busy, t, targetWord],
  );

  const handleRetry = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  const handleBack = useCallback(() => {
    setActiveSlug(null);
    setTargetWord(null);
    setResult(null);
    setError(null);
  }, []);

  if (loading) return <PageLoading />;
  if (failed) return <PageError onRetry={() => setReloadKey((k) => k + 1)} />;

  const activePair = pairs.find((p) => p.slug === activeSlug) ?? null;

  return (
    <DrillScreen
      state={state}
      pairs={pairs}
      dailyLeft={dailyLeft}
      activePair={activePair}
      targetWord={targetWord}
      result={result}
      busy={busy}
      error={error}
      onPick={handlePick}
      onSubmit={handleSubmit}
      onRetry={handleRetry}
      onBack={activePair ? handleBack : () => navigate("/practice")}
      onNavigate={onNavigate}
    />
  );
}
