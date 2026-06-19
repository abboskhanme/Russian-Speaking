// Uzbek phone helpers. We keep the 9 national digits in state and format them for
// display as "+998 90 123 45 67". The backend stores the canonical "+998XXXXXXXXX".

/** Extract up to 9 national digits from arbitrary input (drops +998 / 998 / 8). */
export function uzPhoneDigits(raw: string): string {
  let d = (raw || "").replace(/\D/g, "");
  if (d.startsWith("998")) d = d.slice(3);
  return d.slice(0, 9);
}

/** Pretty display, e.g. "+998 90 123 45 67". Always starts with the +998 prefix. */
export function formatUzPhone(raw: string): string {
  const d = uzPhoneDigits(raw);
  const parts = [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)].filter(Boolean);
  return "+998" + (parts.length ? " " + parts.join(" ") : "");
}

/** Canonical form for the API: "+998XXXXXXXXX" (or "" if incomplete). */
export function canonicalUzPhone(raw: string): string {
  const d = uzPhoneDigits(raw);
  return d.length === 9 ? "+998" + d : "";
}

export function isValidUzPhone(raw: string): boolean {
  return uzPhoneDigits(raw).length === 9;
}
