/**
 * Feature switches → what a student is offered.
 *
 * The flags arrive on `/me` (`features`). A switched-off feature must leave no
 * entry point (the AI Suhbat nav item) and its route must hand the student to a
 * sensible page instead of an operator's explanation.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "../shared/i18n";
import { featuresOf, NO_FEATURES } from "../shared/auth";
import type { Features } from "../shared/auth";
import { Nav } from "../widgets";
import { RequireFeature, hiddenNavKeys, navItemsFor } from "./features";

const t = i18n.getFixedT("uz", "common");

let features: Features = NO_FEATURES;
let role = "student";

vi.mock("../shared/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../shared/auth")>();
  return {
    ...actual,
    useAuth: () => ({ user: { role } }),
    useFeatures: () => features,
  };
});

describe("featuresOf", () => {
  it("treats a /me without the block as everything off (and AI not reported down)", () => {
    expect(featuresOf(null)).toEqual(NO_FEATURES);
    expect(featuresOf({ features: undefined })).toEqual(NO_FEATURES);
    expect(NO_FEATURES.roleplay).toBe(false);
    expect(NO_FEATURES.ai_available).toBe(true);
  });

  it("reads each switch from the server's answer", () => {
    const f = featuresOf({
      features: {
        roleplay: true,
        daily_five: false,
        review_drill: true,
        phoneme_drill: false,
        payments: false,
        ai_available: false,
      },
    });
    expect(f.roleplay).toBe(true);
    expect(f.review_drill).toBe(true);
    expect(f.daily_five).toBe(false);
    expect(f.ai_available).toBe(false);
  });
});

describe("the AI Suhbat nav item", () => {
  const renderNav = (variant: "sidebar" | "bottom") =>
    render(
      <Nav items={navItemsFor("student", t, { features })} variant={variant} />,
    );

  it("is gone from both bars while roleplay is off", () => {
    features = NO_FEATURES;
    role = "student";
    const { unmount } = renderNav("sidebar");
    expect(screen.queryByText(t("nav.chat"))).toBeNull();
    expect(screen.getByText(t("nav.practice"))).toBeInTheDocument();
    unmount();
    renderNav("bottom");
    expect(screen.queryByText(t("nav.chat"))).toBeNull();
  });

  it("is back once roleplay is on", () => {
    features = { ...NO_FEATURES, roleplay: true };
    role = "student";
    renderNav("sidebar");
    expect(screen.getByText(t("nav.chat"))).toBeInTheDocument();
  });

  it("hides nothing for teachers and admins", () => {
    expect(hiddenNavKeys({ roleplay: false }, "teacher").size).toBe(0);
    expect(hiddenNavKeys({ roleplay: false }, "admin").size).toBe(0);
    expect([...hiddenNavKeys({ roleplay: false }, "student")]).toEqual(["chat"]);
  });
});

describe("a switched-off route", () => {
  const renderAt = (path: string) =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<RequireFeature feature="review_drill" fallback="/practice" />}>
            <Route path="/review" element={<p>review screen</p>} />
          </Route>
          <Route path="/practice" element={<p>practice hub</p>} />
        </Routes>
      </MemoryRouter>,
    );

  it("sends the student to the sensible page, never an admin-facing note", () => {
    features = NO_FEATURES;
    renderAt("/review");
    expect(screen.getByText("practice hub")).toBeInTheDocument();
    expect(screen.queryByText("review screen")).toBeNull();
  });

  it("renders normally while its flag is on", () => {
    features = { ...NO_FEATURES, review_drill: true };
    renderAt("/review");
    expect(screen.getByText("review screen")).toBeInTheDocument();
  });
});
