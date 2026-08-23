/**
 * The login page's DEVELOPMENT-ONLY demo-account picker.
 *
 * WHY THIS IS TESTED AT ALL. The panel is an authentication bypass with a button on
 * it. Two properties keep that acceptable, and both are invisible when they break:
 *
 *   • **A 404 draws nothing.** `GET /api/auth/dev/users` does not exist outside
 *     Development, so the panel's response to "the route is not there" is the last
 *     line of defence if this code ever reached a production bundle. An
 *     implementation that rendered an empty card, an error message, or three
 *     disabled buttons would look fine in dev and would be advertising a login
 *     bypass in prod. The assertion is therefore "nothing at all is rendered", not
 *     "no buttons are rendered".
 *   • **One row per role, and the row signs in as that role.** The whole point is
 *     walking student → teacher → admin without three phone numbers; a picker that
 *     lists them and then signs everyone in as the same account is worse than no
 *     picker, because the screens still render.
 *
 * The real `LoginScreen` is rendered (not the panel in isolation): the panel is only
 * reachable through `import.meta.env.DEV` inside that file, and it is exactly that
 * wiring — not the component in a vacuum — that has to hold.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import i18n from "../../shared/i18n";
import { AuthProvider } from "../../shared/auth";
import { tokenStore } from "../../shared/auth";
import type { DevUserResponse } from "../../shared/api";
import LoginScreen from "./LoginScreen";

const t = i18n.getFixedT("uz", "common");

const DEMO: DevUserResponse[] = [
  { id: "11111111-1111-1111-1111-111111111111", full_name: "Talaba Demo", role: "student" },
  { id: "22222222-2222-2222-2222-222222222222", full_name: "Ustoz Demo", role: "teacher" },
  { id: "33333333-3333-3333-3333-333333333333", full_name: "Admin Demo", role: "admin" },
];

interface Call {
  url: string;
  init: RequestInit;
}

/** Minimal `Response`-alike — the api client only reads `ok`, `status` and `text()`. */
const reply = (status: number, body: unknown) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response);

/**
 * Answers `/auth/dev/users` with `users` — or with a 404, standing in for the
 * production host that never registered the route. Records every request so the
 * click test can prove which id was sent.
 */
function stubFetch(users: DevUserResponse[] | "absent"): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      if (url.endsWith("/auth/dev/users")) {
        return users === "absent" ? reply(404, { detail: "Not Found" }) : reply(200, users);
      }
      if (url.endsWith("/auth/dev/login")) {
        return reply(200, {
          access_token: "access-dev",
          refresh_token: "refresh-dev",
          token_type: "bearer",
        });
      }
      if (url.endsWith("/auth/me")) {
        return reply(200, { id: DEMO[1].id, full_name: "Ustoz Demo", role: "teacher" });
      }
      return reply(200, {});
    }),
  );
  return calls;
}

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <AuthProvider>
        <LoginScreen />
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  tokenStore.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  tokenStore.clear();
});

describe("dev login panel", () => {
  it("renders nothing at all when the route does not exist (404)", async () => {
    const calls = stubFetch("absent");
    renderLogin();

    // The page itself is up — so an empty panel would be a real absence, not a
    // render that never happened.
    expect(await screen.findByLabelText(t("auth.phoneLabel"))).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/auth/dev/users"))).toBe(true));

    // Not the badge, not the heading, not a single row.
    expect(screen.queryByText(t("auth.devLogin.badge"))).not.toBeInTheDocument();
    expect(screen.queryByText(t("auth.devLogin.title"))).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Demo/ })).not.toBeInTheDocument();
  });

  it("offers one clearly-labelled button per role when the list arrives", async () => {
    stubFetch(DEMO);
    renderLogin();

    // The badge is not decoration: it is what tells anyone looking at this screen
    // (or a screenshot of it) that they are not looking at a normal way in.
    expect(await screen.findByText(t("auth.devLogin.badge"))).toBeInTheDocument();

    for (const [demo, role] of [
      [DEMO[0], "student"],
      [DEMO[1], "teacher"],
      [DEMO[2], "admin"],
    ] as const) {
      const button = screen.getByRole("button", { name: new RegExp(demo.full_name) });
      expect(button).toHaveTextContent(demo.full_name);
      expect(button).toHaveTextContent(t(`auth.devLogin.roles.${role}`));
    }
  });

  it("signs in as the account that was clicked, and stores the tokens it got back", async () => {
    const calls = stubFetch(DEMO);
    renderLogin();

    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: /Ustoz Demo/ }));

    await waitFor(() => expect(tokenStore.access).toBe("access-dev"));
    expect(tokenStore.refresh).toBe("refresh-dev");

    // The id in the body is the TEACHER's — not the first row, and not a shared one.
    const login = calls.find((c) => c.url.endsWith("/auth/dev/login"));
    expect(login).toBeDefined();
    expect(JSON.parse(String(login!.init.body))).toEqual({ user_id: DEMO[1].id });
  });
});

/**
 * The panel's strings live in `locales/{uz,ru,en}/dev.json`, NOT in `common.json`,
 * because common.json is bundled whole — a key added there ships to production even
 * though the component reading it has been compiled out, and "Faqat development"
 * turning up in a production bundle is precisely the trace this feature must not
 * leave. That split is only safe if the three files stay in step, so this checks
 * them the way a missing translation actually fails: `uz` is the fallback language,
 * so an absent `ru` key does not error — it silently renders the Uzbek string.
 */
describe("dev-login strings", () => {
  const KEYS = [
    "auth.devLogin.badge",
    "auth.devLogin.title",
    "auth.devLogin.hint",
    "auth.devLogin.failed",
    "auth.devLogin.roles.student",
    "auth.devLogin.roles.teacher",
    "auth.devLogin.roles.admin",
  ] as const;

  it.each(["uz", "ru", "en"] as const)("are all present in %s", (lang) => {
    const translate = i18n.getFixedT(lang, "common");
    for (const key of KEYS) {
      const value = translate(key);
      // i18next answers with the key itself when nothing resolves.
      expect(value).not.toBe(key);
      expect(value.trim().length).toBeGreaterThan(0);
    }
  });

  it.each(["ru", "en"] as const)("are really translated in %s, not falling back to uz", (lang) => {
    const other = i18n.getFixedT(lang, "common");
    // The role words are the one place a language could legitimately agree with
    // Uzbek, so the sentences are what is compared.
    for (const key of ["auth.devLogin.badge", "auth.devLogin.title", "auth.devLogin.hint"]) {
      expect(other(key)).not.toBe(t(key));
    }
  });
});
