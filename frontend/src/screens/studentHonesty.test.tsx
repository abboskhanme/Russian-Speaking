/**
 * Student screens that used to say something untrue — each pinned to what the
 * data actually backs.
 *
 *   • /results hid failed attempts (Profile counted 24, the list showed 22).
 *   • Module detail labelled a premium lock "Yopiq", the same as a sequential one.
 *   • Module completion promised a certificate that does not exist.
 *   • The Pro card advertised a price no plan has.
 *   • The Recorder spoke Uzbek to every student, whatever their language.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import i18n from "../shared/i18n";
import { Recorder } from "../shared/ui";
import { AllResultsScreen } from "./results";
import { ModuleCompleteScreen, ModuleDetailScreen } from "./module-detail";
import { SettingsTab } from "./profile/tabs/SettingsTab";

vi.mock("../shared/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../shared/api")>();
  return { ...actual, endpoints: { ...actual.endpoints, unreadCount: () => Promise.resolve({ count: 0 }) } };
});

const t = i18n.getFixedT("uz", "common");

afterEach(async () => {
  await i18n.changeLanguage("uz");
});

describe("the results history", () => {
  it("lists a failed attempt with its reason instead of hiding it", () => {
    render(
      <AllResultsScreen
        results={[
          { id: "a", title: "Do'konda", status: "graded", band: 74, createdAt: new Date().toISOString(), trend: "up" },
          {
            id: "b",
            title: "Oila haqida",
            status: "failed",
            band: null,
            createdAt: new Date().toISOString(),
            reason: t("results.failure.stt_failed"),
          },
        ]}
        onOpenResult={() => undefined}
        onBack={() => undefined}
      />,
    );
    expect(screen.getByText("Oila haqida")).toBeInTheDocument();
    expect(
      screen.getByText(t("results.notGradedReason", { reason: t("results.failure.stt_failed") })),
    ).toBeInTheDocument();
    expect(screen.getByText(t("results.count", { count: 2 }))).toBeInTheDocument();
  });
});

describe("module detail", () => {
  it("tells a premium lock (Pro) apart from a sequential one (Yopiq)", () => {
    render(
      <ModuleDetailScreen
        name="Kundalik"
        total={3}
        doneCount={0}
        tasks={[
          { id: "1", index: 1, title: "Birinchi", state: "current", band: null },
          { id: "2", index: 2, title: "Ikkinchi", state: "locked", band: null },
          { id: "3", index: 3, title: "Uchinchi", state: "premium", band: null },
        ]}
        onStartTask={() => undefined}
        onBack={() => undefined}
      />,
    );
    expect(screen.getByText(t("mashq.detail.locked"))).toBeInTheDocument();
    expect(screen.getByText(t("mashq.detail.premium"))).toBeInTheDocument();
  });

  it("promises no certificate when there is none to download", () => {
    render(
      <ModuleCompleteScreen
        name="Kundalik"
        done={3}
        total={3}
        averageBand={70}
        spentSec={600}
        next={null}
        onNextModule={() => undefined}
        onBack={() => undefined}
      />,
    );
    expect(screen.queryByText(t("mashq.complete.certTitle"))).not.toBeInTheDocument();
  });
});

describe("the Pro card", () => {
  const base = {
    language: "uz" as const,
    theme: "light" as const,
    notifications: true,
    links: null,
  };

  it("shows a real plan's price, and no invented one", () => {
    const { rerender } = render(<SettingsTab {...base} isPremium={false} proPriceFrom="49 900 so'm" />);
    expect(screen.getByText(t("profile.pro.priceFrom", { price: "49 900 so'm" }))).toBeInTheDocument();
    expect(screen.queryByText(/35 000/)).not.toBeInTheDocument();

    rerender(<SettingsTab {...base} isPremium={false} proPriceFrom={null} />);
    expect(screen.getByText(t("profile.pro.body"))).toBeInTheDocument();
    expect(screen.queryByText(/so'm/)).not.toBeInTheDocument();
  });

  it("is not shown to a premium student", () => {
    render(<SettingsTab {...base} isPremium proPriceFrom="49 900 so'm" />);
    expect(screen.queryByText(t("profile.pro.body"))).not.toBeInTheDocument();
  });
});

describe("the recorder", () => {
  it("speaks the student's language, not always Uzbek", async () => {
    await i18n.changeLanguage("ru");
    render(<Recorder onComplete={() => undefined} />);
    expect(screen.getByRole("region", { name: "Запись голоса" })).toBeInTheDocument();
  });
});
