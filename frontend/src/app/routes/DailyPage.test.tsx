/**
 * F3 · «Kunlik 5 daqiqa» — the three properties the feature is defined by, and the
 * three that are easiest to lose in a refactor.
 *
 *   (a) **Flag off means gone.** `GET /api/daily` answers 404 while
 *       `daily_five_enabled` is off, and BOTH visible halves have to read that the
 *       same way: `/daily` leaves for Home, and Home draws the card exactly as it
 *       did before F3 existed. A half-hidden feature — a route that still renders,
 *       or a Home card that counts steps nobody can reach — is the failure mode a
 *       flag exists to prevent.
 *
 *   (b) **An empty SRS queue removes the step, it does not empty it.** The server
 *       omits the drill step entirely; the screen must therefore never manufacture
 *       a third row. A step reporting "0 ta element" turns a two-minute session
 *       into a screen mostly describing its own emptiness.
 *
 *   (c) **The session is stable.** Re-rendering (a refresh, a return from Mashq)
 *       shows the same warm-up phrases, because the server picks them from a seed
 *       over (student, day). If this ever reshuffles, the one screen built to take
 *       the choice away becomes a chooser.
 *
 * Both pages are driven for real — the seam that would break is the one between the
 * page's 404 handling and what the screen ends up rendering, so stubbing the screen
 * would prove nothing.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import i18n from "../../shared/i18n";
import type { DailySessionResponse } from "../../shared/api";
import DailyPage from "./DailyPage";
import HomePage from "./HomePage";

const t = i18n.getFixedT("uz", "common");

/** The three-step session: warm-up + task + drill. */
const FULL: DailySessionResponse = {
  day: "2026-08-23",
  streak: 12,
  completed: false,
  steps: [
    {
      kind: "warmup",
      done: false,
      est_seconds: 30,
      phrases: [
        { id: "p1", text: "Сегодня хорошая погода.", level: "A1–A2" },
        { id: "p2", text: "Я люблю читать книги.", level: "A1–A2" },
        { id: "p3", text: "Где находится библиотека?", level: "A1–A2" },
      ],
      task_id: null,
      task_title: null,
      module_name: null,
      level: null,
      due_count: null,
    },
    {
      kind: "task",
      done: false,
      est_seconds: 180,
      phrases: [],
      task_id: "task-1",
      task_title: "Do'konda",
      module_name: "Kundalik muloqot",
      level: "A2",
      due_count: null,
    },
    {
      kind: "drill",
      done: false,
      est_seconds: 90,
      phrases: [],
      task_id: null,
      task_title: null,
      module_name: null,
      level: null,
      due_count: 3,
    },
  ],
};

/** The same day with an EMPTY SRS queue — the server sends two steps, not three. */
const NO_DRILL: DailySessionResponse = { ...FULL, steps: FULL.steps.slice(0, 2) };

/** What `/api/daily` answers this test. `null` ⇒ the flag-off 404. */
let session: DailySessionResponse | null = FULL;

class NotFound extends Error {
  status = 404;
  constructor() {
    super("Daily session is not enabled");
  }
}

vi.mock("../../shared/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared/api")>();
  return {
    ...actual,
    // The page decides on the STATUS, so the rejection has to be a real ApiError
    // shape rather than a bare Error — `isApiError` is what tells "not shipped
    // here" apart from "the network is down", and the two must not converge.
    isApiError: (e: unknown): e is { status: number } =>
      typeof e === "object" && e !== null && "status" in e,
    endpoints: {
      ...actual.endpoints,
      dailySession: () => (session ? Promise.resolve(session) : Promise.reject(new NotFound())),
      // Home's other sections. They are not what these tests are about, so they
      // answer empty rather than failing — a failing sibling would change what the
      // card renders for reasons unrelated to the flag.
      profileStats: () =>
        Promise.resolve({
          level: "A2",
          current_streak: 12,
          week_practice_sec: 600,
          today_practice_sec: 0,
        }),
      myGroups: () => Promise.resolve([]),
      assignmentsMine: () => Promise.resolve([]),
      myJoinRequests: () => Promise.resolve([]),
    },
  };
});

vi.mock("../../shared/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared/auth")>();
  return {
    ...actual,
    useAuth: () => ({ user: { full_name: "Aziz Karimov" } }),
  };
});

/** Renders the student app at `path` with just the two routes under test, so a
 * redirect lands somewhere observable instead of vanishing. */
function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/daily" element={<DailyPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  session = FULL;
  try {
    localStorage.clear();
  } catch {
    /* storage-less environment — the warm-up simply starts unread */
  }
});

describe("the flag being off", () => {
  it("leaves neither a route nor an entry point", async () => {
    session = null;

    renderAt("/daily");

    // The route is gone: /daily hands the student to Home rather than rendering a
    // screen for a feature this deployment never switched on.
    await screen.findByText(t("home.todayLabel"));
    expect(screen.queryByText(t("daily.steps.warmup.title"))).not.toBeInTheDocument();

    // And Home shows no trace of it — no step count, no "done" line. The card is
    // the one that shipped before F3.
    expect(
      screen.queryByText(t("home.stepsValueText", { done: 0, total: 3 })),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(t("home.dailyDone"))).not.toBeInTheDocument();
    // The pre-F3 card — minus the one promise that was never true without F3:
    // with no session there is no "fix yesterday's mistake" step to speak of.
    expect(screen.getByText(t("home.todayTaglineNoDrill"))).toBeInTheDocument();
    expect(screen.queryByText(t("home.todayTagline"))).not.toBeInTheDocument();
  });
});

describe("the Home tagline", () => {
  it("promises yesterday's correction only when today has a drill step", async () => {
    renderAt("/");
    expect(await screen.findByText(t("home.todayTagline"))).toBeInTheDocument();
  });

  it("drops the promise on a day with nothing due", async () => {
    session = NO_DRILL;
    renderAt("/");
    expect(await screen.findByText(t("home.todayTaglineNoDrill"))).toBeInTheDocument();
    expect(screen.queryByText(t("home.todayTagline"))).not.toBeInTheDocument();
  });
});

describe("the session's name", () => {
  it("is the same on /daily as on Home, whatever the steps add up to", async () => {
    // FULL adds up to 5 min; NO_DRILL to ~3.5 — the name must not follow the sum.
    session = NO_DRILL;
    renderAt("/daily");
    await screen.findByText(t("daily.steps.warmup.title"));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(t("daily.name"));
    expect(t("daily.name")).toBe(t("home.todayTitle", { min: 5 }));
  });
});

describe("the task step", () => {
  it("opens the task with from=daily, so its result offers the way back", async () => {
    localStorage.setItem("govori-daily-warmup", FULL.day); // warm-up already read
    render(
      <MemoryRouter initialEntries={["/daily"]}>
        <Routes>
          <Route path="/daily" element={<DailyPage />} />
          <Route path="/task" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );
    const cta = await screen.findByRole("button", { name: new RegExp(t("daily.steps.task.cta")) });
    fireEvent.click(cta);
    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/task?task=task-1&from=daily",
    );
  });
});

/** Renders where the router ended up, so a navigation can be asserted. */
function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname + location.search}</p>;
}

describe("the flag being on", () => {
  it("puts the session's step count on the Home card", async () => {
    renderAt("/");

    await waitFor(() =>
      expect(
        screen.getByText(t("home.stepsValueText", { done: 0, total: 3 })),
      ).toBeInTheDocument(),
    );
  });
});

describe("an empty SRS queue", () => {
  it("removes the drill step instead of showing an empty one", async () => {
    session = NO_DRILL;

    renderAt("/daily");

    await screen.findByText(t("daily.steps.warmup.title"));

    // Two rails, not three — and crucially no drill row claiming zero items.
    expect(screen.getByText(t("daily.steps.warmup.label"))).toBeInTheDocument();
    expect(screen.getByText(t("daily.steps.task.label"))).toBeInTheDocument();
    expect(screen.queryByText(t("daily.steps.drill.label"))).not.toBeInTheDocument();
    expect(screen.getByText(t("daily.progress", { done: 0, total: 2 }))).toBeInTheDocument();
  });
});

describe("today's session", () => {
  it("renders the server's session verbatim, in its order", async () => {
    // The DAY's stability is the server's promise and is pinned there
    // (DailyEndpointsTests). What has to hold here is that the client adds no
    // instability of its own: no shuffle, no "pick 3 of these", no re-sort. Those
    // are exactly the helpers a later refactor reaches for, and any of them would
    // make the same session look different on every render while the server's
    // answer never changed.
    renderAt("/daily");
    await screen.findByText(t("daily.steps.warmup.title"));

    const expected = FULL.steps[0].phrases.map((p) => p.text);
    const rendered = screen
      .getAllByText(/^[А-ЯЁ]/u)
      .map((el) => el.textContent)
      .filter((text): text is string => expected.includes(text ?? ""));

    expect(rendered).toEqual(expected);
  });
});
