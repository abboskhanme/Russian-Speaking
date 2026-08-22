/**
 * ErrorBoundary — the contract of the screen a person meets when a render throws.
 *
 * WHAT IS WORTH TESTING HERE. Not that a fallback appears — that is one line of
 * React. What is worth pinning is everything a well-meaning edit could quietly take
 * away, because none of it is visible in review and all of it only shows up on
 * somebody's phone:
 *
 *   • **Production must not print the error.** A stack tells a student nothing and
 *     tells a stranger our file layout. `showDetails` is the seam that lets this be
 *     asserted from both sides without a production build.
 *   • **The crash must not follow the person.** A boundary that keeps its fallback
 *     across a navigation is barely better than the white screen it replaced. The
 *     `resetKey` pair below is the difference between "this page broke" and "the
 *     app is dead", and the composition test at the bottom proves it end to end,
 *     the way `App` actually wires it.
 *   • **Nothing is sent anywhere.** Crash reporting is the owner's decision. A
 *     later "helpful" `fetch` in here would ship user data off-device silently, so
 *     the absence of one is asserted rather than assumed.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Link, Route, Routes, useLocation } from "react-router-dom";
import i18n, { SUPPORTED_LANGS, resources } from "../../i18n";
import { ErrorBoundary } from "./ErrorBoundary";

const t = i18n.getFixedT("uz", "common");

/** React prints the caught error itself; that noise is not the test's output. */
function silenceReact() {
  return vi.spyOn(console, "error").mockImplementation(() => {});
}

const BOOM = "task_list_was_null";

function Boom({ crash = true }: { crash?: boolean }) {
  if (crash) throw new Error(BOOM);
  return <p>tirik</p>;
}

describe("catching", () => {
  it("renders its children untouched while nothing throws", () => {
    render(
      <ErrorBoundary>
        <p>bosh sahifa</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("bosh sahifa")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("replaces a crashed subtree with a way out, not a blank page", () => {
    silenceReact();
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(t("errors.crashTitle"));
    // Two escapes, and the home one is a real link so it works as a full document
    // load even when this boundary's own state is not what is broken.
    expect(screen.getByRole("button", { name: t("common.retry") })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: t("errors.crashHome") })).toHaveAttribute("href", "/");
  });

  it("re-renders the children on Qayta urinish", async () => {
    silenceReact();
    // The cause is a variable the TEST flips, not a counter the component keeps:
    // React replays a failed render in development to build its stack, so anything
    // that counts its own renders heals itself before the boundary ever commits.
    let broken = true;
    function Flaky() {
      if (broken) throw new Error(BOOM);
      return <p>tirik</p>;
    }

    render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();

    // Whatever it was has passed — which is the only case retry is honest about.
    broken = false;
    await userEvent.setup().click(screen.getByRole("button", { name: t("common.retry") }));
    expect(screen.getByText("tirik")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("what the fallback is allowed to say", () => {
  it("prints NO error text in production", () => {
    silenceReact();
    render(
      <ErrorBoundary showDetails={false}>
        <Boom />
      </ErrorBoundary>,
    );
    // The message is the leak: it carries whatever the throwing code interpolated.
    expect(screen.queryByText(new RegExp(BOOM))).toBeNull();
    expect(screen.queryByText(t("errors.crashDetails"))).toBeNull();
    // ...and the person still gets a sentence they can act on.
    expect(screen.getByRole("alert")).toHaveTextContent(t("errors.crashBody"));
  });

  it("shows the message behind a disclosure in development", () => {
    silenceReact();
    render(
      <ErrorBoundary showDetails>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText(t("errors.crashDetails"))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(BOOM))).toBeInTheDocument();
  });
});

describe("reporting", () => {
  it("logs the error and hands it to onError", () => {
    const logged = silenceReact();
    const onError = vi.fn();
    render(
      <ErrorBoundary onError={onError}>
        <Boom />
      </ErrorBoundary>,
    );

    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0][0] as Error).message).toBe(BOOM);
    expect(logged.mock.calls.some((args) => String(args[0]).includes("[ErrorBoundary]"))).toBe(true);
  });

  it("sends nothing off the device", () => {
    // Deliberate, not incidental: where crashes get reported is the owner's call,
    // and a boundary is exactly where a well-meant `fetch` would appear.
    silenceReact();
    const fetchSpy = vi.fn();
    const beaconSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("navigator", { ...navigator, sendBeacon: beaconSpy });
    try {
      render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      );
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(beaconSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("resetKey — a crashed page must not follow the person", () => {
  it("keeps the fallback while the key is unchanged, and clears it when it changes", () => {
    silenceReact();
    const { rerender } = render(
      <ErrorBoundary resetKey="/task">
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();

    // Same page, healthy children: the boundary must NOT quietly retry on its own.
    // An error that clears itself on the next parent render is an error that flickers.
    rerender(
      <ErrorBoundary resetKey="/task">
        <Boom crash={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();

    // A navigation, though, is a new page and deserves a clean one.
    rerender(
      <ErrorBoundary resetKey="/progress">
        <Boom crash={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("tirik")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("the two-level composition App uses", () => {
  it("costs one screen its render, and leaves the rest of the app reachable", async () => {
    silenceReact();
    // The same shape as App.tsx: an outer boundary as the last line of defence, and
    // an inner one around the route content keyed on the path. What this proves is
    // the reason there are two: navigation survives a crashed page.
    function Fixture() {
      return (
        <MemoryRouter initialEntries={["/task"]}>
          <ErrorBoundary showDetails={false}>
            <nav>
              <Link to="/progress">Natijalar</Link>
            </nav>
            <RoutedContent />
          </ErrorBoundary>
        </MemoryRouter>
      );
    }
    function RoutedContent() {
      const { pathname } = useLocation();
      return (
        <ErrorBoundary resetKey={pathname} showDetails={false}>
          <Routes>
            <Route path="/task" element={<Boom />} />
            <Route path="/progress" element={<p>Natijalar sahifasi</p>} />
          </Routes>
        </ErrorBoundary>
      );
    }

    render(<Fixture />);
    expect(screen.getByRole("alert")).toHaveTextContent(t("errors.crashTitle"));
    // The nav sits ABOVE the inner boundary, so the crash never reached it.
    const link = screen.getByRole("link", { name: "Natijalar" });

    await userEvent.setup().click(link);
    expect(screen.getByText("Natijalar sahifasi")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("locale coverage", () => {
  const KEYS = ["errors.crashTitle", "errors.crashBody", "errors.crashHome", "errors.crashDetails"];

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

  // Read the files, NOT `t()`: uz answers for a missing ru key, so every assertion
  // above would still pass with two of the three locales empty.
  it.each(SUPPORTED_LANGS)("defines every crash string in %s", (lang) => {
    const strings = flatten(resources[lang].common);
    expect(KEYS.filter((key) => !strings[key]?.trim())).toEqual([]);
  });
});
