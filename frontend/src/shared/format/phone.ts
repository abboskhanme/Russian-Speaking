/**
 * `+998901234567` → `+998 90 123 45 67` — the grouping the login screen shows while
 * the number is typed, so the number a person reads anywhere in the app looks like
 * the one they type to sign in. Accepts the E.164 form the API returns (spaces,
 * dashes and brackets are tolerated). Anything that is not a complete Uzbek number
 * (a legacy row, a foreign number) is returned trimmed rather than forced into the
 * mask. "" for null/undefined.
 */
export function formatPhone(phone: string | null | undefined): string {
  const trimmed = (phone ?? "").trim();
  const compact = trimmed.replace(/[\s\-()]/g, "");
  const m = /^\+?998(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(compact);
  if (!m) return trimmed;
  return `+998 ${m[1]} ${m[2]} ${m[3]} ${m[4]}`;
}
