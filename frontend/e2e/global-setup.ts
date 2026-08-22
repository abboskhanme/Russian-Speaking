/**
 * Fail FAST and legibly on a mis-configured run.
 *
 * Without this, a wrong `SECRET_KEY` or a stale `E2E_STUDENT_ID` produces a token
 * the API rejects, the app clears it, every navigation lands on `/login`, and the
 * suite reports "expected /practice, got /login" — a message that points at the
 * router rather than at the two environment variables that are actually wrong.
 */
import { request } from "@playwright/test";
import type { APIRequestContext, FullConfig } from "@playwright/test";
import { adminId, mintAccessToken, studentId } from "./auth";

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL as string;
  const context = await request.newContext({ baseURL });

  // Both ids are checked BEFORE any browser starts, and both by role: a token
  // for the wrong role does not fail at the API, it fails three screens later
  // as "expected /admin, got /" — a message about the router rather than about
  // the variable that is actually wrong.
  await expectRole(context, baseURL, studentId(), "student", "E2E_STUDENT_ID");
  await expectRole(context, baseURL, adminId(), "admin", "E2E_ADMIN_ID");

  await context.dispose();
}

async function expectRole(
  context: APIRequestContext,
  baseURL: string,
  userId: string,
  role: string,
  variable: string,
): Promise<void> {
  let me;
  try {
    me = await context.get("/api/auth/me", {
      headers: { Authorization: `Bearer ${mintAccessToken(userId)}` },
    });
  } catch (cause) {
    throw new Error(
      `Cannot reach ${baseURL}. The compose stack must be up, and from inside a ` +
        "container the host is the service name (http://govori-web), never localhost.",
      { cause },
    );
  }

  if (!me.ok()) {
    throw new Error(
      `${baseURL}/api/auth/me rejected the token minted for ${variable} (HTTP ${me.status()}).\n` +
        `Either SECRET_KEY does not match the API's, or ${variable} is not a user in this database.`,
    );
  }

  const user = (await me.json()) as { role: string };
  if (user.role !== role) {
    throw new Error(`${variable} belongs to a ${user.role}; that journey needs a ${role}.`);
  }
}
