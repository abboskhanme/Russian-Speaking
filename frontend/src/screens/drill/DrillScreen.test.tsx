/**
 * DrillScreen — the verdict must survive without the decoration.
 *
 * The server drops the per-sound array in three ordinary situations: Azure
 * returned no phoneme entries (which it does whenever the recording does not
 * resemble the reference), the vendor call failed, or our own IPA spelling
 * disagreed with Azure's segmentation and the alignment was refused rather than
 * risk labelling one sound's score with another sound's name.
 *
 * All three arrive at this screen as `phonemes: []`. If the screen ever came to
 * depend on that array — for the outcome, for the words, for anything — the
 * feature would look fine in every demo (the mock always has phonemes) and go
 * blank precisely when a real learner got a word badly wrong. That is the failure
 * these tests exist to make impossible.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "../../shared/i18n";
import { DrillScreen } from "./DrillScreen";
import type { DrillPair, DrillResult } from "./DrillScreen";
import { mockDrillPairs } from "./drill.mock";

const PAIR: DrillPair = mockDrillPairs[0];   // мышка / мишка

function renderScreen(overrides: Partial<Parameters<typeof DrillScreen>[0]> = {}) {
  return render(
    <MemoryRouter>
      <DrillScreen
        state="ready"
        pairs={mockDrillPairs}
        dailyLeft={38}
        activePair={null}
        targetWord={null}
        result={null}
        onPick={vi.fn()}
        onSubmit={vi.fn()}
        onRetry={vi.fn()}
        onBack={vi.fn()}
        {...overrides}
      />
    </MemoryRouter>,
  );
}

/** A "said the other twin" verdict, with the per-sound array controllable. */
function twinResult(phonemes: DrillResult["phonemes"]): DrillResult {
  return {
    outcome: "twin",
    targetWord: PAIR.wordA,
    heardText: PAIR.wordB,
    heardWord: PAIR.wordB,
    accuracy: 49,
    phonemes,
  };
}

describe("DrillScreen", () => {
  it("names both twins and their meanings on the hub", () => {
    renderScreen();

    expect(screen.getByText(PAIR.wordA)).toBeInTheDocument();
    expect(screen.getByText(PAIR.wordB)).toBeInTheDocument();
    // The glosses are the point — a pronunciation error is only a consequence if
    // the learner can see what they actually asked for.
    expect(screen.getByText(PAIR.glossAUz)).toBeInTheDocument();
    expect(screen.getByText(PAIR.glossBUz)).toBeInTheDocument();
  });

  it("renders the whole verdict when there is NO per-sound detail", () => {
    renderScreen({
      activePair: PAIR,
      targetWord: PAIR.wordA,
      result: twinResult([]),
    });

    // The consequence is still fully stated: what they said, and what they meant.
    expect(screen.getByText(i18n.t("drill.youSaid"))).toBeInTheDocument();
    expect(screen.getByText(i18n.t("drill.youMeant"))).toBeInTheDocument();
    expect(screen.getByText(i18n.t("drill.outcome.twin.title"))).toBeInTheDocument();

    // …and the decoration is simply absent, not an error or an empty shell.
    expect(screen.queryByText(i18n.t("drill.soundsLabel"))).not.toBeInTheDocument();
  });

  it("shows the per-sound row when the server did vouch for it", () => {
    renderScreen({
      activePair: PAIR,
      targetWord: PAIR.wordA,
      result: twinResult(
        PAIR.ipaA.map((ipa, i) => ({
          ipa,
          score: i <= 2 ? 0 : 100,
          focus: i === PAIR.focusIndexA,
        })),
      ),
    });

    expect(screen.getByText(i18n.t("drill.soundsLabel"))).toBeInTheDocument();
    // Our own IPA name for the contrasting sound — Azure supplies none for Russian.
    expect(screen.getByText(PAIR.ipaA[PAIR.focusIndexA])).toBeInTheDocument();
  });

  it("states a correct answer without inventing a score for it", () => {
    renderScreen({
      activePair: PAIR,
      targetWord: PAIR.wordA,
      result: {
        outcome: "correct",
        targetWord: PAIR.wordA,
        heardText: PAIR.wordA,
        heardWord: null,
        accuracy: null,
        phonemes: [],
      },
    });

    expect(screen.getByText(i18n.t("drill.outcome.correct.title"))).toBeInTheDocument();
    // No "you said / you meant" swap: nothing was substituted.
    expect(screen.queryByText(i18n.t("drill.youSaid"))).not.toBeInTheDocument();
  });

  it("gives each blocked state its own explanation", () => {
    const { unmount } = renderScreen({ state: "disabled" });
    expect(
      screen.getByText(i18n.t("drill.blocked.disabled.title")),
    ).toBeInTheDocument();
    unmount();

    // A missing key is an OPERATOR problem and must not read as "not shipped" —
    // they send whoever is looking at it to two different places.
    renderScreen({ state: "unconfigured" });
    expect(
      screen.getByText(i18n.t("drill.blocked.unconfigured.title")),
    ).toBeInTheDocument();
  });

  it("keeps the pairs visible when the daily budget is spent", () => {
    renderScreen({ state: "budget_spent" });

    // Still the grid, not a wall: the student can see what they will practise
    // tomorrow, and the tiles say why they cannot start now.
    expect(screen.getByText(PAIR.wordA)).toBeInTheDocument();
    expect(
      screen.getByText(i18n.t("drill.budgetSpentShort")),
    ).toBeInTheDocument();
  });
});
