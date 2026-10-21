/**
 * The learner motivation layer — each test pins a promise the screens make:
 * unknown is never drawn as zero, a 0 is never painted success-green, an empty
 * place offers one step out, and the week strip / XP bar say what the API says.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "../shared/i18n";
import { MotivationPanel } from "./home/MotivationPanel";
import { SkillsTab } from "./progress/tabs/SkillsTab";
import { AchievementsTab } from "./progress/tabs/AchievementsTab";
import { LineChart } from "./progress/LineChart";
import { ModulesTab } from "./practice-hub/tabs/ModulesTab";
import { AllResultsScreen, AttemptDetailScreen } from "./results";
import { ModuleDetailScreen } from "./module-detail";
import { scoreBand, scoreTone } from "../shared/score/scoreBand";

vi.mock("../shared/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../shared/api")>();
  return { ...actual, endpoints: { ...actual.endpoints, unreadCount: () => Promise.resolve({ count: 0 }) } };
});

const t = i18n.getFixedT("en", "common");

afterEach(async () => {
  await i18n.changeLanguage("uz");
});

const en = async () => i18n.changeLanguage("en");

describe("the Home motivation panel", () => {
  it("draws the week strip with today last and the XP stage from the API", async () => {
    await en();
    render(
      <MotivationPanel
        stats={{
          level: "A2",
          weekMinutes: 34,
          currentStreak: 3,
          activeDays: [false, false, false, false, true, true, true],
          xp: { total: 180, level: 2, levelStart: 100, nextLevelAt: 300 },
        }}
        goalMinutes={5}
        doneSeconds={120}
        // A Wednesday: the last dot is "We", the first (six days back) is "Th".
        now={new Date(2026, 9, 21, 12)}
      />,
    );

    const days = screen.getAllByTestId("week-day");
    expect(days).toHaveLength(7);
    expect(days[6].textContent).toBe(t("motivation.weekday.3"));
    expect(days[0].textContent).toBe(t("motivation.weekday.4"));
    expect(days.filter((d) => d.dataset.on)).toHaveLength(3);
    expect(screen.getByText(t("motivation.weekAria", { count: 3 }))).toBeInTheDocument();

    expect(screen.getByText(t("motivation.xpLevel", { level: 2 }))).toBeInTheDocument();
    expect(screen.getByText(t("motivation.xpToNext", { xp: 120, next: 3 }))).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "180");
    expect(screen.getByRole("img", { name: t("motivation.goalAria", { done: 2, goal: 5 }) })).toBeInTheDocument();
  });

  it("says it does not know — every slot a dash, no strip, no bar — when the figures failed", async () => {
    await en();
    render(<MotivationPanel stats={null} goalMinutes={5} doneSeconds={null} onRetry={() => undefined} />);

    expect(screen.queryAllByTestId("week-day")).toHaveLength(0);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("common.retry") })).toBeInTheDocument();
  });

  it("marks a met goal in words, not only colour", async () => {
    await en();
    render(
      <MotivationPanel
        stats={{ level: null, weekMinutes: 6, currentStreak: 0 }}
        goalMinutes={5}
        doneSeconds={360}
      />,
    );
    expect(screen.getByText(t("motivation.goalDone"))).toBeInTheDocument();
    // A zero streak invites, it does not scold.
    expect(screen.getByText(t("motivation.streakZero"))).toBeInTheDocument();
  });
});

describe("Progress", () => {
  const base = {
    levelLabel: null,
    band: 40,
    bandDelta: null,
    deltaWeeks: 0,
    trend: [{ weekIndex: 0, band: 40 }],
  };

  it("prints a dash, not 0, for a skill with no score yet", async () => {
    await en();
    render(
      <SkillsTab
        {...base}
        level="A1"
        skills={[
          { key: "fluency", score: 40, scored: true },
          { key: "pronunciation", score: 0, scored: false },
          { key: "lexical", score: 0, scored: true },
          { key: "grammar", score: 35, scored: true },
        ]}
      />,
    );
    const pron = screen.getByLabelText(`${t("progress.skills.pronunciation")}: ${t("motivation.noData")}`);
    expect(pron.textContent).toContain("—");
    // A REAL zero is still a zero.
    const lex = screen.getByLabelText(`${t("progress.skills.lexical")}: ${t("units.points", { count: 0 })}`);
    expect(lex.textContent).toContain("0");
  });

  it("shows Govo and one action instead of an empty level card when nothing is graded", async () => {
    await en();
    const onStart = vi.fn();
    render(
      <SkillsTab
        {...base}
        level={null}
        band={null}
        trend={[]}
        skills={[{ key: "fluency", score: 0, scored: false }]}
        onStartPractice={onStart}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: t("motivation.empty.startPractice") }));
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("offers the first badge's step when nothing is unlocked", async () => {
    await en();
    render(
      <AchievementsTab
        achievements={[{ key: "first_step", progress: 0, target: 1, unlocked: false }]}
        onStartPractice={() => undefined}
      />,
    );
    expect(screen.getByText(t("motivation.empty.achTitle"))).toBeInTheDocument();
  });

  it("draws the trend's end dot as a box, so a stretched chart cannot squash it", () => {
    const { container } = render(<LineChart points={[40, 50, 60]} ariaLabel="trend" />);
    expect(container.querySelector("circle")).toBeNull();
    const dot = screen.getByTestId("trend-dot");
    expect(dot.style.left).toBe("96%");
  });
});

describe("scores are coloured by their band", () => {
  it("never calls a 0 a success", () => {
    expect(scoreBand(0)).toBe("low");
    expect(scoreTone(0)).toBe("danger");
    expect(scoreTone(50)).toBe("warn");
    expect(scoreTone(85)).toBe("success");
  });

  it("paints the results list and the module path by band", async () => {
    await en();
    const { unmount } = render(
      <AllResultsScreen
        results={[{ id: "a", title: "X", status: "graded", band: 0, createdAt: new Date().toISOString(), trend: "flat" }]}
        onOpenResult={() => undefined}
        onBack={() => undefined}
      />,
    );
    expect(document.querySelector("[data-tone]")?.getAttribute("data-tone")).toBe("danger");
    unmount();

    render(
      <ModuleDetailScreen
        name="M"
        total={2}
        doneCount={1}
        tasks={[
          { id: "1", index: 1, title: "T1", state: "done", band: 0 },
          { id: "2", index: 2, title: "T2", state: "current", band: null },
        ]}
        onStartTask={() => undefined}
        onBack={() => undefined}
      />,
    );
    expect(document.querySelector("[data-tone]")?.getAttribute("data-tone")).toBe("danger");
  });
});

describe("Govo reacts to a result", () => {
  const detail = {
    id: "s1",
    status: "done",
    createdAt: new Date().toISOString(),
    questionTitle: "Q",
    questionLevel: "A2",
    questionTopic: null,
    audioUrl: null,
    audioDurationSec: null,
    audioExpired: false,
    transcript: null,
    fluency: 10,
    lexical: 10,
    grammar: 10,
    pronunciation: null,
    relevance: 10,
    feedback: null,
    corrections: [],
    modelAnswer: null,
    teacherBand: null,
    teacherComment: null,
  };

  it("encourages, kindly, on a weak score", async () => {
    await en();
    render(<AttemptDetailScreen detail={{ ...detail, band: 12 }} onBack={() => undefined} />);
    expect(screen.getByText(t("motivation.react.low"))).toBeInTheDocument();
  });

  it("cheers on a great one", async () => {
    await en();
    render(<AttemptDetailScreen detail={{ ...detail, id: "s2", band: 91 }} onBack={() => undefined} />);
    expect(screen.getByText(t("motivation.react.great"))).toBeInTheDocument();
  });
});

describe("the module list", () => {
  it("shows a play badge for a module not started and drops a missing level", async () => {
    await en();
    render(
      <ModulesTab
        modules={[{ id: "m1", name: "Ochiq", level: null, total: 4, done: 0, visibility: "public", locked: false }]}
        onOpenModule={() => undefined}
      />,
    );
    const card = screen.getByRole("button", { name: /Ochiq/ });
    expect(card.textContent).not.toContain("↑");
    expect(card.textContent).not.toMatch(/^\s*—/);
    expect(within(card).getByText(t("mashq.modules.metaNotStarted", { level: "", total: 4 }).replace(/^\s*·\s*/, ""))).toBeInTheDocument();
    expect(screen.getByTestId("module-cover")).toBeInTheDocument();
  });

  it("offers the way back to all modules when a filter is empty", async () => {
    await en();
    render(
      <ModulesTab
        modules={[{ id: "m1", name: "Ochiq", level: "A1", total: 4, done: 0, visibility: "public", locked: false }]}
        onOpenModule={() => undefined}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: t("mashq.modules.filter.done") }));
    await userEvent.click(screen.getByRole("button", { name: t("motivation.empty.modules.showAll") }));
    expect(screen.getByRole("button", { name: /Ochiq/ })).toBeInTheDocument();
  });
});
