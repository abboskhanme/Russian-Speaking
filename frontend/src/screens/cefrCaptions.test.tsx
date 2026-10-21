/**
 * CEFR captions on every screen that shows a level — Progress (SkillsTab), Profile (InfoTab) and
 * teacher Analytics (hero card) — follow the UI language.
 *
 * The server sends one caption per level and it is always Uzbek (`level_label`,
 * `class_level_label`). These screens printed it raw, so a Russian or English UI showed
 * "o'rta-yuqori" next to an otherwise translated page. Each screen is rendered here in Russian
 * with the server's Uzbek caption still in its props: the Russian caption must appear and the
 * Uzbek one must not. Placement is covered in PlacementScreen.test.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import i18n from "../shared/i18n";
import { SkillsTab } from "./progress/tabs/SkillsTab";
import { mockSkills } from "./progress/progress.mock";
import { InfoTab } from "./profile/tabs/InfoTab";
import { mockProfileUser } from "./profile/profile.mock";
import { AnalyticsScreen } from "./teacher/AnalyticsScreen";

const SERVER_UZ = "o'rta-yuqori";

beforeEach(async () => {
  await i18n.changeLanguage("ru");
});

afterEach(async () => {
  await i18n.changeLanguage("uz");
});

describe("CEFR captions follow the UI language", () => {
  it("Progress · SkillsTab", () => {
    render(<SkillsTab {...mockSkills} level="B2" levelLabel={SERVER_UZ} />);
    expect(screen.getByText("выше среднего")).toBeInTheDocument();
    expect(screen.queryByText(SERVER_UZ)).toBeNull();
  });

  it("Profile · InfoTab", () => {
    render(<InfoTab user={{ ...mockProfileUser, level: "B2", levelLabel: SERVER_UZ }} group={null} />);
    expect(screen.getByText("B2 · выше среднего")).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(SERVER_UZ))).toBeNull();
  });

  it("Analytics · hero card", () => {
    render(
      <AnalyticsScreen
        insights={{
          classAvg: 80,
          classLevel: "B2",
          classLevelLabel: SERVER_UZ,
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
          errors: [],
          remediationMinStudents: 3,
        }}
        gradebook={[]}
      />,
    );
    expect(screen.getByText(/^выше среднего · /)).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(SERVER_UZ))).toBeNull();
  });

  it("an unknown level still shows the server's caption rather than nothing", () => {
    render(<SkillsTab {...mockSkills} level="C2" levelLabel="mukammal" />);
    expect(screen.getByText("mukammal")).toBeInTheDocument();
  });
});
