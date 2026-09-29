/**
 * AdminProfilePage + the header avatar — the admin's way to their own account.
 *
 * WHY THIS IS TESTED. Before this page an admin could not sign out, change their
 * language or their phone: the admin nav has no Profil item, and nothing else led
 * anywhere. The two things worth pinning are the ones a screenshot cannot prove:
 *
 *   • the avatar in every admin header actually opens `/admin/profile` (and renders
 *     nothing outside the admin layout, so screens stay renderable on their own);
 *   • "Chiqish" really signs out and lands on /login, and a language choice is written
 *     to the ACCOUNT (`preferred_language`), not only to this browser.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import i18n from "../../shared/i18n";
import type { MeResponse, UpdateProfileArgs } from "../../shared/api";
import { AdminAccountButton, AdminChromeContext } from "../../screens/admin/AdminChrome";
import AdminProfilePage from "./AdminProfilePage";

const t = i18n.getFixedT("uz", "common");

const ME: MeResponse = {
  id: "a-1",
  email: "998901112235@govori.uz",
  full_name: "Admin Demo",
  role: "admin",
  is_active: true,
  is_premium: false,
  region: null,
  district: null,
  address: null,
  phone: "+998901112235",
  created_at: "2026-07-01T00:00:00Z",
  level: null,
  level_label: null,
  avatar_url: null,
  notifications_enabled: true,
  preferred_language: "uz",
};

const logout = vi.fn();
const loadMe = vi.fn(() => Promise.resolve(ME));
const profileUpdates = vi.fn();

vi.mock("../../shared/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared/auth")>();
  return {
    ...actual,
    useAuth: () => ({ user: ME, logout, loadMe, hydrateUser: vi.fn() }),
  };
});

vi.mock("../../shared/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared/api")>();
  return {
    ...actual,
    endpoints: {
      ...actual.endpoints,
      settingsLinks: () => Promise.resolve({ tg_support_url: "", tg_channel_url: "" }),
      updateProfile: (args: UpdateProfileArgs) => {
        profileUpdates(args);
        return Promise.resolve(ME);
      },
    },
  };
});

afterEach(async () => {
  logout.mockClear();
  profileUpdates.mockClear();
  await i18n.changeLanguage("uz");
});

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

function renderProfile() {
  render(
    <MemoryRouter initialEntries={["/admin/profile"]}>
      <Routes>
        <Route path="/admin/profile" element={<AdminProfilePage />} />
        <Route path="*" element={null} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
  return userEvent.setup();
}

describe("/admin/profile", () => {
  it("shows the account and signs out to /login", async () => {
    const user = renderProfile();

    expect(screen.getAllByText("Admin Demo").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("tab", { name: t("profile.tabs.settings") }));
    await user.click(screen.getByRole("button", { name: new RegExp(t("profile.logout")) }));

    expect(logout).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/login"));
  });

  it("writes a language choice to the account, not only to this device", async () => {
    const user = renderProfile();

    await user.click(screen.getByRole("tab", { name: t("profile.tabs.settings") }));
    await user.click(screen.getByRole("button", { name: new RegExp(t("profile.settingsRows.language")) }));
    await user.click(within(screen.getByRole("dialog")).getByRole("radio", { name: "Русский" }));

    expect(profileUpdates).toHaveBeenCalledWith({ preferred_language: "ru" });
  });

  it("offers no learner upsell — an admin has no subscription to buy", async () => {
    const user = renderProfile();
    await user.click(screen.getByRole("tab", { name: t("profile.tabs.settings") }));
    expect(screen.queryByRole("button", { name: /premium/i })).not.toBeInTheDocument();
  });
});

describe("the header avatar", () => {
  it("opens the profile from inside the admin layout", async () => {
    const onOpenProfile = vi.fn();
    render(
      <AdminChromeContext.Provider value={{ fullName: "Admin Demo", onOpenProfile }}>
        <AdminAccountButton />
      </AdminChromeContext.Provider>,
    );

    const avatar = screen.getByRole("button", { name: t("admin.avatarAria") });
    expect(avatar).toHaveTextContent("AD");
    await userEvent.setup().click(avatar);
    expect(onOpenProfile).toHaveBeenCalledTimes(1);
  });

  it("renders nothing outside it, so a screen stays renderable on its own", () => {
    const { container } = render(<AdminAccountButton />);
    expect(container).toBeEmptyDOMElement();
  });
});
