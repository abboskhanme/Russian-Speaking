/**
 * RoleLayout — one frame per role, drawn once by the route, not by each screen.
 *
 * What a screenshot cannot prove and these do: the page's title lands in the top
 * bar exactly once (no second copy in the body); the right-hand cluster is the
 * same bell + avatar everywhere and the avatar opens the role's own account page;
 * the active item follows the URL, including pages that are not nav destinations;
 * and a route declared outside the layout gets no frame at all.
 */
import { describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import i18n from "../../shared/i18n";
import { Page } from "../../widgets";
import { activeKeyForPath, NAV_PATH, STUDENT_NAV_ALIASES, TEACHER_NAV_PATH } from "../nav";
import RoleLayout from "./RoleLayout";

const t = i18n.getFixedT("uz", "common");

vi.mock("../../shared/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared/auth")>();
  const auth = { user: { full_name: "Admin Demo", role: "admin" } };
  return { ...actual, useAuth: () => auth, useOptionalAuth: () => auth };
});

vi.mock("../../shared/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared/api")>();
  return {
    ...actual,
    endpoints: {
      ...actual.endpoints,
      unreadCount: () => Promise.resolve({ count: 0 }),
      teacherReviewCount: () => Promise.resolve({ count: 3 }),
    },
  };
});

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<RoleLayout role="admin" />}>
          <Route path="/admin/audit" element={<Page title="Audit jurnali">body</Page>} />
          <Route path="/admin/profile" element={<Page title="Profil">me</Page>} />
        </Route>
        <Route path="/bare" element={<Page title="Yalang">bare body</Page>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
  return userEvent.setup();
}

describe("RoleLayout", () => {
  it("puts the page title in the top bar, once, beside the role's nav", async () => {
    renderAt("/admin/audit");
    const banner = screen.getByRole("banner");
    expect(await within(banner).findByRole("heading", { level: 1 })).toHaveTextContent("Audit jurnali");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    // The admin's nav, not the teacher's: Tariflar is there, the grading queue is not.
    expect(screen.getAllByRole("button", { name: t("nav.adminBilling") }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: t("nav.queue") })).not.toBeInTheDocument();
    // Jurnal is the current page in the sidebar.
    expect(screen.getAllByRole("button", { name: t("nav.adminAudit") })[0]).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("ends the top bar with the bell and the avatar, and the avatar opens the account", async () => {
    const user = renderAt("/admin/audit");
    const banner = screen.getByRole("banner");
    const avatar = within(banner).getByRole("button", { name: t("nav.account") });
    expect(avatar).toHaveTextContent("AD");
    await user.click(avatar);
    expect(screen.getByTestId("where")).toHaveTextContent("/admin/profile");
  });

  it("redraws the nav when the language changes after it mounted", async () => {
    // The live case: the frame is up before `/me` arrives, and the server's
    // preferred_language switches the UI under it. The nav stayed Uzbek around an
    // English page until the next navigation.
    renderAt("/admin/audit");
    expect(screen.getAllByRole("button", { name: t("nav.adminBilling") }).length).toBeGreaterThan(0);
    try {
      await act(() => i18n.changeLanguage("en"));
      const en = i18n.getFixedT("en", "common");
      expect(screen.getAllByRole("button", { name: en("nav.adminBilling") }).length).toBeGreaterThan(0);
      expect(document.documentElement.lang).toBe("en");
    } finally {
      await act(() => i18n.changeLanguage("uz"));
    }
  });

  it("frames nothing for a route declared outside it", () => {
    renderAt("/bare");
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    // The title still reads as the page's heading, inline.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Yalang");
  });
});

describe("activeKeyForPath", () => {
  it("matches destinations, their drill-downs and aliases", () => {
    expect(activeKeyForPath("/", NAV_PATH, STUDENT_NAV_ALIASES)).toBe("home");
    expect(activeKeyForPath("/practice/module/x", NAV_PATH, STUDENT_NAV_ALIASES)).toBe("practice");
    expect(activeKeyForPath("/results/42", NAV_PATH, STUDENT_NAV_ALIASES)).toBe("profile");
    expect(activeKeyForPath("/daily", NAV_PATH, STUDENT_NAV_ALIASES)).toBe("home");
  });

  it("highlights nothing for a page reached from the avatar", () => {
    expect(activeKeyForPath("/teacher/profile", TEACHER_NAV_PATH)).toBeUndefined();
    expect(activeKeyForPath("/teacher/queue/7", TEACHER_NAV_PATH)).toBe("queue");
  });
});
