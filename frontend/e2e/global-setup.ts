/**
 * Fail FAST and legibly on a mis-configured run.
 *
 * Without this, a wrong `SECRET_KEY` or a stale `E2E_STUDENT_ID` produces a token
 * the API rejects, the app clears it, every navigation lands on `/login`, and the
 * suite reports "expected /practice, got /login" — a message that points at the
 * router rather than at the two environment variables that are actually wrong.
 */
import { request } from "@playwright/test";
import type { FullConfig } from "@playwright/test";
import { mintAccessToken, studentId } from "./auth";

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL as string;
  const context = await request.newContext({ baseURL });

  let me;
  try {
    me = await context.get("/api/auth/me", {
      headers: { Authorization: `Bearer ${mintAccessToken(studentId())}` },
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
      `${baseURL}/api/auth/me rejected the minted token (HTTP ${me.status()}).\n` +
        "Either SECRET_KEY does not match the API's, or E2E_STUDENT_ID is not a user in this database.",
    );
  }

  const user = (await me.json()) as { role: string; full_name: string };
  if (user.role !== "student") {
    // A teacher token would be bounced to /teacher by RoleHome and every student
    // assertion below would fail for a reason that has nothing to do with the app.
    throw new Error(`E2E_STUDENT_ID belongs to a ${user.role}; the golden path needs a student.`);
  }

  await context.dispose();
}
