/**
 * Pure helpers behind DateField: the `dd.MM.yyyy` / `HH:mm` typing masks and the
 * conversions to and from the ISO-ish strings native inputs (and our callers) use:
 * `yyyy-MM-dd` for a date, `yyyy-MM-ddTHH:mm` for a local date-time.
 */

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Digits typed so far → `21.10.2026` progressively ("2110" → "21.10"). The dot is
 * only inserted once a digit follows it, so backspace never gets stuck on it. */
export function maskDate(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}.${d.slice(2)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 4)}.${d.slice(4)}`;
}

/** Digits typed so far → `14:30` progressively. */
export function maskTime(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 4);
  return d.length <= 2 ? d : `${d.slice(0, 2)}:${d.slice(2)}`;
}

/** `21.10.2026` → `2026-10-21`; null unless it is a complete, real calendar date. */
export function parseDisplayDate(text: string): string | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (year < 1900 || month < 1 || month > 12 || day < 1) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCDate() !== day || probe.getUTCMonth() !== month - 1) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** `2026-10-21` → `21.10.2026`; "" for anything else. */
export function isoDateToDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "";
}

/** `14:30` → `14:30`, `9:05` → `09:05`; null unless a valid 24-hour time. */
export function parseTime(text: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const [h, mi] = [Number(m[1]), Number(m[2])];
  if (h > 23 || mi > 59) return null;
  return `${pad2(h)}:${pad2(mi)}`;
}
