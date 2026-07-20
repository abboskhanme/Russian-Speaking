/**
 * placed — the "placement already done" flag (MVP persistence).
 *
 * The backend keeps NO per-user placement state (no schema change), so the client remembers that a
 * user has taken the one-time placement test in localStorage. Both the "Keyinroq" skip and the final
 * "Boshlash" set it; the placement route reads it to send an already-placed user straight to Home.
 */
const PLACED_KEY = "govori_placed";

/** True when this user has already completed (or skipped) the one-time placement. */
export function hasPlaced(): boolean {
  try {
    return localStorage.getItem(PLACED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Mark placement as done so it is never asked again on this device. */
export function markPlaced(): void {
  try {
    localStorage.setItem(PLACED_KEY, "1");
  } catch {
    /* private mode / storage disabled — non-fatal, placement just re-prompts. */
  }
}
