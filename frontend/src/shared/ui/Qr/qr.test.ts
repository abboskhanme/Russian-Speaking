/**
 * The in-house QR encoder. A real decoder round-trip (jsQR over v1–v9 incl. UTF-8)
 * was run when it was written; these pin the structure so a refactor that breaks
 * it fails here: the version grows with the data, the three finder patterns are
 * where scanners look for them, and the format bits say level M.
 */
import { describe, expect, it } from "vitest";
import { qrMatrix, qrPath } from "./qr";

const finderAt = (m: boolean[][], x0: number, y0: number) => {
  for (let y = 0; y < 7; y++)
    for (let x = 0; x < 7; x++) {
      const d = Math.max(Math.abs(x - 3), Math.abs(y - 3));
      if (m[y0 + y][x0 + x] !== (d !== 2)) return false;
    }
  return true;
};

describe("qrMatrix", () => {
  it("picks the smallest version that fits (level M, byte mode)", () => {
    expect(qrMatrix("x").length).toBe(21); // v1
    expect(qrMatrix("http://govori-web/j/PFDHMP").length).toBe(25); // 26 bytes → v2
    expect(qrMatrix("https://govorim.uz/j/SMPLA1").length).toBe(29); // 27 bytes → v3
    expect(qrMatrix("a".repeat(150)).length).toBe(49); // v8 — carries version info
    expect(qrMatrix("a".repeat(170)).length).toBe(53); // v9
  });

  it("draws the three finder patterns", () => {
    const m = qrMatrix("https://govorim.uz/j/SMPLA1");
    const n = m.length;
    expect(finderAt(m, 0, 0)).toBe(true);
    expect(finderAt(m, n - 7, 0)).toBe(true);
    expect(finderAt(m, 0, n - 7)).toBe(true);
  });

  it("writes format bits for error-correction level M", () => {
    const m = qrMatrix("hello");
    // Format bits 14..9 sit at (x 0..5, y 8); unmask with 0x5412 and read the level.
    let f = 0;
    for (let i = 0; i <= 5; i++) f |= (m[i][8] ? 1 : 0) << i;
    f |= (m[7][8] ? 1 : 0) << 6;
    f |= (m[8][8] ? 1 : 0) << 7;
    f |= (m[8][7] ? 1 : 0) << 8;
    for (let i = 9; i < 15; i++) f |= (m[8][14 - i] ? 1 : 0) << i;
    const level = ((f ^ 0x5412) >>> 13) & 0b11;
    expect(level).toBe(0b00); // M
  });

  it("refuses text beyond version 10", () => {
    expect(() => qrMatrix("z".repeat(300))).toThrow();
  });

  it("emits one path with a 4-module quiet zone", () => {
    const { size, d } = qrPath(qrMatrix("x"));
    expect(size).toBe(29);
    expect(d.startsWith("M4 4")).toBe(true);
  });
});
