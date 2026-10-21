/**
 * AdminSettingsScreen — where a save says how it went.
 *
 * WHY THIS IS TESTED. The screen is ~5,900px tall on a phone and used to print its one
 * result line at the very bottom, so pressing "Funksiyalarni saqlash" halfway down
 * produced a "Saqlandi" — or a "Saqlanmadi" — the admin never saw. The result now sits
 * beside the button that was pressed; these tests pin it to THAT section and no other.
 *
 * Also: a refused link (`invalid_link`) lands on the field the server named, and the
 * server's mixed-language model suffixes are re-said in the interface language.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "../../shared/i18n";
import type { ApiError } from "../../shared/api";
import { AdminSettingsScreen, modelLabel } from "./AdminSettingsScreen";
import { mockAdminSettings } from "./admin.mock";

const t = i18n.getFixedT("uz", "common");

const section = (name: string) => within(screen.getByRole("region", { name }));

function refusal(body: Record<string, unknown>): ApiError {
  const e = new Error("x") as ApiError;
  e.name = "ApiError";
  e.status = 400;
  e.detail = "tg_support_url must be an https URL";
  e.body = { detail: e.detail, ...body };
  return e;
}

describe("save feedback", () => {
  it("appears beside the section's own button and nowhere else", async () => {
    render(
      <AdminSettingsScreen settings={mockAdminSettings} tab="features" onSaveFeatures={() => Promise.resolve()} />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: t("admin.saveFeatures") }));

    expect(await section(t("admin.features")).findByText(t("admin.saved"))).toBeInTheDocument();
    expect(screen.getAllByText(t("admin.saved"))).toHaveLength(1);
  });

  it("shows a failure as an alert in the same place", async () => {
    render(
      <AdminSettingsScreen
        settings={mockAdminSettings}
        tab="features"
        onSaveFeatures={() => Promise.reject(new Error("boom"))}
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: t("admin.saveFeatures") }));

    expect(await section(t("admin.features")).findByRole("alert")).toHaveTextContent(t("admin.saveFailed"));
  });
});

describe("links", () => {
  it("puts invalid_link on the field the server named, never its English detail", async () => {
    const onSaveLinks = vi.fn(() => Promise.reject(refusal({ code: "invalid_link", field: "tg_support_url" })));
    render(<AdminSettingsScreen settings={mockAdminSettings} tab="links" onSaveLinks={onSaveLinks} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: t("admin.saveLinks") }));

    const support = screen.getByLabelText(t("admin.tgSupport"));
    expect(await screen.findByText(t("admin.errInvalidLink"))).toBeInTheDocument();
    expect(support).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(t("admin.tgChannel"))).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText(/must be an https URL/)).not.toBeInTheDocument();
  });

  it("states the accepted format before anything is refused", () => {
    render(<AdminSettingsScreen settings={mockAdminSettings} tab="links" />);
    expect(section(t("admin.links")).getAllByText(t("admin.linkFormatHint"))).toHaveLength(2);
  });
});

describe("model labels", () => {
  it.each([
    ["Gemini 3.1 Flash Lite (recommended)", `Gemini 3.1 Flash Lite (${t("admin.modelRecommended")})`],
    ["Claude Opus 5 (tavsiya etiladi)", `Claude Opus 5 (${t("admin.modelRecommended")})`],
    ["Gemini 2.5 Flash (avoid on free tier)", `Gemini 2.5 Flash (${t("admin.modelAvoidFreeTier")})`],
    ["Whisper v1", "Whisper v1"],
    ["Some Model (beta)", "Some Model (beta)"],
  ])("%s", (server, shown) => {
    expect(modelLabel(server, t)).toBe(shown);
  });
});
