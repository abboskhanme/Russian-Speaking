/**
 * app/pendingJoin — the group code carried by a teacher's invite link (`/j/:code`)
 * across the sign-in it may have to wait for.
 *
 * A teacher shares `${origin}/j/${code}`. The student who opens it may be signed
 * out, and may not even have an account yet — so the code has to outlive the
 * login (or the whole three-step registration, and the placement hop after it)
 * and then be used exactly ONCE. It lives in `sessionStorage`: scoped to the tab
 * that opened the link, gone when that tab closes, and never following the device
 * to the next person who signs in on it.
 *
 * The student Home is the one consumer ({@link takePendingJoin} reads AND removes
 * it), which is what makes the join happen once however many times Home renders.
 */

const KEY = "govori_pending_join";

/**
 * Join codes are short upper-case tokens (the server's alphabet has no lower case).
 * A malformed code is still CARRIED rather than dropped: the server is the judge
 * of what a valid code is, and its 404 is what lets Home say "this link's code is
 * wrong" instead of the link doing nothing at all. Only the length is bounded.
 */
export function normalizeJoinCode(raw: string | undefined | null): string | null {
  const code = (raw ?? "").trim().toUpperCase().slice(0, 64);
  return code.length > 0 ? code : null;
}

/** Remember the invite's code until the student is signed in. */
export function savePendingJoin(code: string): void {
  try {
    sessionStorage.setItem(KEY, code);
  } catch {
    /* storage blocked — the student can still type the code on Home */
  }
}

/** Read the remembered code and forget it in the same step — the join runs once. */
export function takePendingJoin(): string | null {
  try {
    const code = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return code;
  } catch {
    return null;
  }
}

/** Drop a remembered code without using it (a teacher/admin opened the link). */
export function clearPendingJoin(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

/** Whether an invite is waiting to be used — lets the login screen say why it opened. */
export function hasPendingJoin(): boolean {
  try {
    return sessionStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}
