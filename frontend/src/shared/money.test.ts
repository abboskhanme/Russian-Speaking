import { describe, expect, it } from "vitest";
import { formatMinor, parseMajorToMinor } from "./money";

const NNBSP = "\u202F";   // the narrow no-break space formatMinor groups with

/**
 * Price formatting, pinned. These look like formatting trivia and are not: the number these
 * functions produce is the number a person is asked to pay, and every case below is one where a
 * plausible shortcut charges the wrong amount or shows a price that reads as a different one.
 */
describe("formatMinor", () => {
  it("divides minor units by 100 and groups thousands with a narrow no-break space", () => {
    // A period or a comma here would be read as a DECIMAL separator by an Uzbek or Russian
    // speaker, i.e. "49.900 so'm" looks like forty-nine so'm.
    expect(formatMinor(4_990_000, "UZS")).toBe(`49${NNBSP}900 so'm`);
    expect(formatMinor(100_000_000, "UZS")).toBe(`1${NNBSP}000${NNBSP}000 so'm`);
  });

  it("shows no decimals for a whole price, and keeps them when there really are tiyin", () => {
    expect(formatMinor(50_000, "UZS")).toBe("500 so'm");
    // Dropping these would understate what the person is charged.
    expect(formatMinor(50_050, "UZS")).toBe("500,50 so'm");
  });

  it("handles zero and small amounts without inventing groups", () => {
    expect(formatMinor(0, "UZS")).toBe("0 so'm");
    expect(formatMinor(99, "UZS")).toBe("0,99 so'm");
  });

  it("falls back to the ISO code for a currency it has no name for", () => {
    // Better a reader sees the code than a bare number with no unit.
    expect(formatMinor(1_200_000, "KZT")).toBe(`12${NNBSP}000 KZT`);
  });
});

describe("parseMajorToMinor", () => {
  it("round-trips a value copied off the screen, exotic spaces and all", () => {
    expect(parseMajorToMinor(`49${NNBSP}900`)).toBe(4_990_000);
    expect(parseMajorToMinor("49 900")).toBe(4_990_000);
  });

  it("accepts both decimal separators and rounds the multiplication", () => {
    expect(parseMajorToMinor("499,99")).toBe(49_999);
    // 499.99 * 100 is 49998.999… in binary floating point; truncating would charge a tiyin less
    // than the price that was typed.
    expect(parseMajorToMinor("499.99")).toBe(49_999);
  });

  it("refuses anything that is not a plain positive amount", () => {
    // Returning null rather than NaN is what lets the form refuse instead of POSTing a broken price.
    for (const bad of ["", "abc", "-100", "1.234", "1e5", "12,", "so'm"]) {
      expect(parseMajorToMinor(bad)).toBeNull();
    }
  });
});
