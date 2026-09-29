import { formatDisplay, nationalDigits } from "../auth/phone";

/**
 * `+998901234567` → `+998 90 123 45 67`, the grouping the login screen shows while it
 * is typed — so the number an admin reads in a row looks like the one the person
 * types to sign in. Anything that is not a complete Uzbek number (a legacy row, a
 * foreign number) is returned untouched rather than being forced into the mask.
 */
export function formatPhone(phone: string): string {
  const trimmed = phone.trim();
  if (!/^\+998\d{9}$/.test(trimmed)) return trimmed;
  return formatDisplay(nationalDigits(trimmed));
}
