/**
 * screens/auth/phone — Uzbek phone helpers.
 *
 * The UI stores the 9-digit national part (`operator + subscriber`, e.g.
 * "901234567"); the `+998` country code is fixed and shown as a prefix. The
 * mockup renders it grouped as `+998 90 123 45 67`. The API wants E.164
 * (`+998901234567`, no spaces), which {@link toE164} produces.
 */

/** Keep only digits; drop a leading 998 country code; cap at 9 national digits. */
export function nationalDigits(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("998")) d = d.slice(3);
  return d.slice(0, 9);
}

/** Group the national part as `90 123 45 67` (partial as the user types). */
export function groupNational(nat: string): string {
  const d = nationalDigits(nat);
  const parts = [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)].filter(Boolean);
  return parts.join(" ");
}

/** Full display value, e.g. `+998 90 123 45 67`. */
export function formatDisplay(nat: string): string {
  const g = groupNational(nat);
  return g ? `+998 ${g}` : "+998 ";
}

/** E.164 for the API: `+998901234567`. */
export function toE164(nat: string): string {
  return `+998${nationalDigits(nat)}`;
}

/** A complete Uzbek mobile number has 9 national digits. */
export function isValidUz(nat: string): boolean {
  return nationalDigits(nat).length === 9;
}
