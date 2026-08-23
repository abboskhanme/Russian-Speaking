/**
 * shared/money — formatting a price the API sends in MINOR units.
 *
 * The server stores and transmits `price_minor`: a whole number of tiyin, never so'm and never a
 * float. Both Uzbek payment providers speak minor units on the wire, and money is the one number
 * where a rounding error is not acceptable — so the division by 100 happens HERE, once, at the
 * moment of display, and the value never becomes a float before it has to.
 *
 * Grouping uses a NARROW NO-BREAK SPACE (U+202F) rather than a comma or a period. In Uzbek, Russian
 * and most of Europe a period is the decimal separator, so "49.900" reads as forty-nine so'm to a
 * meaningful share of this app's users. A space cannot be misread that way, and the narrow no-break
 * variety keeps "49 900" from wrapping across two lines mid-number.
 *
 * Pair every rendered price with `tabular-nums` (`<Text numeric>`), so a column of prices lines up
 * digit under digit instead of drifting.
 */

/** The narrow no-break space used between thousands groups. Written as an escape, not as the
 * literal character, so it survives an editor that normalises exotic whitespace. */
const GROUP_SEPARATOR = "\u202F";

/** Currency symbols/short names, keyed by ISO-4217. Anything unknown falls back to the code
 * itself — better a reader sees "12 000 KZT" than a number with no unit at all. */
const SYMBOLS: Record<string, string> = {
  UZS: "so'm",
};

/**
 * `4990000, "UZS"` → `"49 900 so'm"`.
 *
 * A non-zero fractional part is kept (`"49 900,50 so'm"`) rather than rounded away: a price with
 * tiyin in it is unusual here, and silently dropping them would understate what someone is charged.
 * A whole so'm price shows no decimals at all, because "49 900,00 so'm" is noise nobody reads.
 */
export function formatMinor(amountMinor: number, currency: string): string {
  const sign = amountMinor < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(amountMinor));
  const major = Math.floor(abs / 100);
  const minor = abs % 100;

  const grouped = String(major).replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEPARATOR);
  const decimals = minor === 0 ? "" : `,${String(minor).padStart(2, "0")}`;
  const unit = SYMBOLS[currency] ?? currency;

  return `${sign}${grouped}${decimals} ${unit}`;
}

/** The inverse, for an admin form that types a price in so'm. Returns `null` for anything that is
 * not a plain positive number, so the caller can refuse rather than send a NaN to the server. */
export function parseMajorToMinor(raw: string): number | null {
  // Strip every flavour of space a pasted price can carry — including the narrow no-break one
  // formatMinor itself emits, so a value copied off the screen round-trips.
  const cleaned = raw.replace(/[\s\u00A0\u202F]/g, "").replace(",", ".");
  if (cleaned.length === 0 || !/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  // Round rather than truncate the ×100: 499.99 in binary floating point is 49998.999…, and a
  // truncation there would quietly charge a tiyin less than the price that was typed.
  return Math.round(Number(cleaned) * 100);
}
