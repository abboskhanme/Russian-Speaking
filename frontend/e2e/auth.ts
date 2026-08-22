/**
 * e2e/auth — signing in without a phone.
 *
 * Production auth is phone + OTP over Telegram, and the `000000` dev bypass is
 * OFF wherever a real `TELEGRAM_BOT_TOKEN` is configured (it is, locally), so
 * there is no way to drive the login form from a test. The API's own token scheme
 * is plain HS256 over `SECRET_KEY` with three claims — `sub`, `type`, `exp` — so
 * the suite mints exactly what `/auth/otp/verify` would have returned and writes
 * it to the same two localStorage keys the app reads.
 *
 * The secret is read from the repo `.env` and never printed; only the JWT leaves
 * this module.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Where the API's `SECRET_KEY` lives when it is not already in the environment. */
const ENV_FILE = process.env.GOVORI_ENV_FILE ?? resolve(process.cwd(), "..", ".env");

function secretKey(): string {
  if (process.env.SECRET_KEY) return process.env.SECRET_KEY;
  let file: string;
  try {
    file = readFileSync(ENV_FILE, "utf8");
  } catch {
    throw new Error(
      `Cannot read SECRET_KEY: no such file ${ENV_FILE}.\n` +
        "Set SECRET_KEY directly, or point GOVORI_ENV_FILE at the repo .env " +
        "(mount it read-only when running inside a container).",
    );
  }
  const match = file.match(/^\s*SECRET_KEY\s*=\s*(.*)$/m);
  if (!match) throw new Error(`No SECRET_KEY entry in ${ENV_FILE}.`);
  return match[1].trim().replace(/^["']|["']$/g, "");
}

/**
 * The users the journeys sign in as.
 *
 * Deliberately NOT hard-coded: `deploy/seed/20-dev-users.sql` inserts with
 * `gen_random_uuid()`, so the ids differ per database. Resolve them with
 *   docker compose exec -T db psql -U russpeak -d russpeak -tAc \
 *     "select role, email, id from users where email in
 *        ('student@govori.uz','admin@govori.uz') order by role"
 *
 * There is no `E2E_TEACHER_ID` in that list on purpose: which teacher can drive
 * the Navbat journey depends on who actually has a queue, and that changes as
 * the demo data is graded. `people.ts` picks one through the admin API instead
 * of asking the operator to keep a fourth variable correct.
 */
function requireEnvId(name: string): string {
  const id = process.env[name];
  if (!id) {
    throw new Error(`${name} is not set — see e2e/auth.ts for the psql one-liner that resolves it.`);
  }
  return id;
}

export const studentId = () => requireEnvId("E2E_STUDENT_ID");
export const adminId = () => requireEnvId("E2E_ADMIN_ID");

/** An explicit teacher override; `null` means "let people.ts choose one". */
export function teacherIdOverride(): string | null {
  return process.env.E2E_TEACHER_ID ?? null;
}

const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

export interface MintOptions {
  /** `access` for API calls, `refresh` for `/auth/refresh` — the API checks the
   * claim and rejects an access token offered as a refresh one. */
  type?: "access" | "refresh";
  /** Seconds from now until `exp`. NEGATIVE mints an already-expired token,
   * which is how the auth-edge journey reaches the refresh path on purpose. */
  ttlSeconds?: number;
}

/** A token the API will accept for `sub`. Defaults to a one-hour access token. */
export function mintAccessToken(sub: string, options: MintOptions = {}): string {
  const { type = "access", ttlSeconds = 3600 } = options;
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: "HS256", typ: "JWT" });
  const payload = b64({ sub, type, iat: now, exp: now + ttlSeconds });
  const signature = createHmac("sha256", secretKey())
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

/** The 7-day counterpart the client stores alongside the access token. Without a
 * `type: "refresh"` claim `/auth/refresh` returns 401, so the silent-refresh
 * journey would test the logout path instead of the one it names. */
export function mintRefreshToken(sub: string, options: MintOptions = {}): string {
  return mintAccessToken(sub, { ttlSeconds: 7 * 24 * 3600, ...options, type: "refresh" });
}

/** A structurally valid token whose signature does not match `SECRET_KEY`. */
export function mintForgedToken(sub: string): string {
  return `${mintAccessToken(sub).slice(0, -6)}AAAAAA`;
}
