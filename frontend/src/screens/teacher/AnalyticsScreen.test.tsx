/**
 * AnalyticsScreen — **F6 "Mashq ber"** (docs/01 F6, docs/08 Faza 6.7).
 *
 * WHY THIS ONE CONTROL IS TESTED AND THE REST OF THE SCREEN IS NOT. Everything
 * else here draws a number. This button WRITES, to many people at once, and there
 * is no unassign — a wrong press is permanent for a whole class. The three ways
 * that goes wrong are all invisible in review, because each of them still renders
 * a perfectly ordinary-looking button:
 *
 *   • **It fires without a confirm.** The only thing between one tap and thirty
 *     irreversible rows is the dialog. A refactor that wires `onClick` straight to
 *     the handler looks identical on screen and passes every visual check.
 *   • **It sends to the wrong people.** The promise is "the students who made THIS
 *     error", not the class. Handing the callback anything other than the server's
 *     own plan quietly widens the blast radius.
 *   • **It is live when there is nothing to send.** A drill that does not exist, a
 *     class that already has it, an error too rare to be a class pattern — three
 *     different dead ends that must read as three different sentences, because
 *     "no drill for this" and "they all already have it" send a teacher in
 *     opposite directions.
 *
 * Assertions go through the real i18n instance so rewording a string does not break
 * a test. `t()` returns the key itself when a key is MISSING, which would make every
 * render assertion here pass vacuously — the locale test at the bottom is the guard
 * on that guard, reading all three files directly rather than through the uz fallback.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n, { SUPPORTED_LANGS, resources } from "../../shared/i18n";
import { AnalyticsScreen } from "./AnalyticsScreen";
import type { AnalyticsErrorRow, AnalyticsInsights } from "./AnalyticsScreen";

const t = i18n.getFixedT("uz", "common");

const LIVE: AnalyticsErrorRow = {
  type: "word_order",
  label: "So'z tartibi",
  count: 24,
  studentCount: 3,
  share: 0.4,
  remediation: {
    questionId: "q-1",
    questionTitle: "Мой обычный день",
    questionTopic: "Kundalik hayot",
    questionLevel: "A2",
    students: [
      { id: "s1", fullName: "Anvar A." },
      { id: "s2", fullName: "Bobur B." },
      { id: "s3", fullName: "Charos C." },
    ],
  },
};

function insights(errors: AnalyticsErrorRow[], minStudents = 3): AnalyticsInsights {
  return {
    classAvg: 72,
    classLevel: "B1",
    trendDelta: null,
    trend: [],
    activeStudents: 3,
    totalStudents: 4,
    assignmentsDone: 0,
    assignmentsTotal: 0,
    practiceMinutes: 0,
    reviewedWeek: 0,
    skills: [],
    week: [],
    errors,
    remediationMinStudents: minStudents,
  };
}

function renderScreen(
  errors: AnalyticsErrorRow[],
  onAssign?: (row: AnalyticsErrorRow, plan: NonNullable<AnalyticsErrorRow["remediation"]>) => Promise<number>,
  minStudents = 3,
) {
  return render(
    <AnalyticsScreen
      insights={insights(errors, minStudents)}
      gradebook={[]}
      onAssignRemediation={onAssign}
    />,
  );
}

/** The row's action button, scoped to its own card so a second row cannot answer
 * for it. The share bar carries the row's label as its accessible name, and its
 * parent is the card. */
function errorCard(label: string): HTMLElement {
  return screen.getByRole("progressbar", { name: label }).parentElement as HTMLElement;
}

function drillButton(label: string) {
  return within(errorCard(label)).getByRole("button", {
    name: t("teacher.analytics.assignDrill"),
  });
}

describe("AnalyticsScreen · F6 Mashq ber", () => {
  it("sends NOTHING until the confirm dialog's own action is pressed", async () => {
    const onAssign = vi.fn().mockResolvedValue(3);
    const user = userEvent.setup();
    renderScreen([LIVE], onAssign);

    await user.click(drillButton(LIVE.label));

    // The dialog is up and the write has NOT happened. This is the whole safety
    // property: one tap opens a question, it does not fan a task out.
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(onAssign).not.toHaveBeenCalled();

    // Backing out leaves the class untouched.
    await user.click(screen.getByRole("button", { name: t("common.cancel") }));
    expect(onAssign).not.toHaveBeenCalled();
  });

  it("shows the task, the count and every name before it will send", async () => {
    const user = userEvent.setup();
    renderScreen([LIVE], vi.fn().mockResolvedValue(3));

    await user.click(drillButton(LIVE.label));
    const dialog = screen.getByRole("dialog");

    // WHICH task…
    expect(within(dialog).getByText("Мой обычный день")).toBeTruthy();
    // …HOW MANY…
    expect(
      within(dialog).getByText(t("teacher.analytics.remediationConfirmWho", { count: 3 })),
    ).toBeTruthy();
    // …and WHO, by name. Not "+2 more": the teacher cannot inspect this list
    // afterwards, so it is all of it or it is not a confirmation.
    for (const s of LIVE.remediation!.students) {
      expect(within(dialog).getByText(s.fullName)).toBeTruthy();
    }
  });

  it("sends to exactly the students who made THIS error, never the whole class", async () => {
    const onAssign = vi.fn().mockResolvedValue(3);
    const user = userEvent.setup();
    renderScreen([LIVE], onAssign);

    await user.click(drillButton(LIVE.label));
    await user.click(
      screen.getByRole("button", { name: t("teacher.analytics.remediationConfirmCta") }),
    );

    expect(onAssign).toHaveBeenCalledTimes(1);
    const [row, plan] = onAssign.mock.calls[0]!;
    expect(row.type).toBe("word_order");
    expect(plan.questionId).toBe("q-1");
    // The server's own plan, passed through untouched — the class has 4 students
    // and exactly 3 of them made this error.
    expect(plan.students.map((s: { id: string }) => s.id)).toEqual(["s1", "s2", "s3"]);
  });

  it("stays down after a successful send, and says how many it reached", async () => {
    const onAssign = vi.fn().mockResolvedValue(3);
    const user = userEvent.setup();
    renderScreen([LIVE], onAssign);

    await user.click(drillButton(LIVE.label));
    await user.click(
      screen.getByRole("button", { name: t("teacher.analytics.remediationConfirmCta") }),
    );

    expect(
      await screen.findByText(t("teacher.analytics.remediationSent", { count: 3 })),
    ).toBeTruthy();
    // A second press cannot double the fan-out.
    expect(drillButton(LIVE.label).hasAttribute("disabled")).toBe(true);
  });

  it("keeps the dialog open with a reason when the write fails", async () => {
    const onAssign = vi.fn().mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    renderScreen([LIVE], onAssign);

    await user.click(drillButton(LIVE.label));
    await user.click(
      screen.getByRole("button", { name: t("teacher.analytics.remediationConfirmCta") }),
    );

    // Closing on failure would leave a teacher unable to tell a refusal from a send.
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  describe("dead ends read as three different sentences", () => {
    it("no assignable task → disabled, and says so", () => {
      const row: AnalyticsErrorRow = { ...LIVE, type: "case_error", studentCount: 5, remediation: null };
      renderScreen([row], vi.fn());

      expect(drillButton(row.label).hasAttribute("disabled")).toBe(true);
      expect(screen.getByText(t("teacher.analytics.remediationNoTask"))).toBeTruthy();
    });

    it("under the class floor → disabled, and names the floor", () => {
      const row: AnalyticsErrorRow = { ...LIVE, type: "style", studentCount: 2, remediation: null };
      renderScreen([row], vi.fn());

      expect(drillButton(row.label).hasAttribute("disabled")).toBe(true);
      expect(
        screen.getByText(t("teacher.analytics.remediationTooRare", { min: 3 })),
      ).toBeTruthy();
    });

    it("everyone already has it → disabled, and does NOT claim there is no drill", () => {
      const row: AnalyticsErrorRow = {
        ...LIVE,
        remediation: { ...LIVE.remediation!, students: [] },
      };
      renderScreen([row], vi.fn());

      expect(drillButton(row.label).hasAttribute("disabled")).toBe(true);
      expect(screen.getByText(t("teacher.analytics.remediationAllAssigned"))).toBeTruthy();
      expect(screen.queryByText(t("teacher.analytics.remediationNoTask"))).toBeNull();
    });
  });

  it("draws no button at all when the deployment has the feature off", () => {
    // `remediation: undefined` — not null. An absent feature must not advertise
    // itself as a broken one, so there is nothing to press and nothing to explain.
    const { remediation: _drop, ...off } = LIVE;
    renderScreen([off as AnalyticsErrorRow], vi.fn(), 0);

    expect(
      screen.queryByRole("button", { name: t("teacher.analytics.assignDrill") }),
    ).toBeNull();
    expect(screen.queryByText(t("teacher.analytics.remediationNoTask"))).toBeNull();
    // The error row itself is untouched — the class still sees what it gets wrong.
    expect(screen.getByText(LIVE.label)).toBeTruthy();
  });
});

/**
 * The guard on the guard. Every assertion above compares rendered text with
 * `t(key)`, and i18next returns the KEY for a missing key — so a screen rendering
 * nothing but raw keys would satisfy all of them. This reads the three locale files
 * directly, which is the only way to catch a key that exists in uz and nowhere else.
 */
describe("F6 locale coverage", () => {
  const KEYS = [
    "teacher.analytics.assignDrill",
    "teacher.analytics.remediationNoTask",
    "teacher.analytics.remediationTooRare",
    "teacher.analytics.remediationAllAssigned",
    "teacher.analytics.remediationConfirmTitle",
    "teacher.analytics.remediationConfirmLead",
    "teacher.analytics.remediationConfirmTask",
    "teacher.analytics.remediationConfirmWho",
    "teacher.analytics.remediationConfirmWarn",
    "teacher.analytics.remediationConfirmCta",
    "teacher.analytics.remediationSent",
    "teacher.analytics.remediationFailed",
  ];

  /** `{ a: { b: "x" } }` → `{ "a.b": "x" }`, the shape i18next keys address. */
  function flatten(obj: unknown, prefix = ""): Record<string, string> {
    const out: Record<string, string> = {};
    if (typeof obj !== "object" || obj === null) return out;
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof value === "string") out[prefix + key] = value;
      else Object.assign(out, flatten(value, `${prefix}${key}.`));
    }
    return out;
  }

  it.each(SUPPORTED_LANGS)("defines every F6 string in %s", (lang) => {
    const strings = flatten(resources[lang].common);
    // A count-bearing string lives under its plural forms (key_one/key_other…).
    expect(KEYS.filter((key) => !(strings[key] ?? strings[`${key}_other`])?.trim())).toEqual([]);
  });

  // The count and the floor are the two numbers a teacher acts on. A translator
  // dropping either placeholder still yields an ordinary-looking sentence — one
  // that no longer says how many people, or how many are needed.
  it.each(SUPPORTED_LANGS)("keeps the %s placeholders that carry the numbers", (lang) => {
    const strings = flatten(resources[lang].common);
    for (const form of ["one", "other"]) {
      expect(strings[`teacher.analytics.remediationConfirmWho_${form}`]).toContain("{{count}}");
      expect(strings[`teacher.analytics.remediationSent_${form}`]).toContain("{{count}}");
    }
    expect(strings["teacher.analytics.remediationTooRare"]).toContain("{{min}}");
    expect(strings["teacher.analytics.remediationConfirmLead"]).toContain("{{error}}");
  });
});
