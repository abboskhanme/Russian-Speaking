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
 * The user the golden path signs in as.
 *
 * Deliberately NOT hard-coded: `deploy/seed/20-dev-users.sql` inserts with
 * `gen_random_uuid()`, so the id differs per database. Resolve it with
 *   docker compose exec -T db psql -U russpeak -d russpeak -tAc \
 *     "select id from users where email = 'student@govori.uz'"
 */
export function studentId(): string {
  const id = process.env.E2E_STUDENT_ID;
  if (!id) {
    throw new Error(
      "E2E_STUDENT_ID is not set — see e2e/auth.ts for the psql one-liner that resolves it.",
    );
  }
  return id;
}

const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** An access token the API will accept for `sub`, valid for one hour. */
export function mintAccessToken(sub: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: "HS256", typ: "JWT" });
  const payload = b64({ sub, type: "access", iat: now, exp: now + 3600 });
  const signature = createHmac("sha256", secretKey())
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}
