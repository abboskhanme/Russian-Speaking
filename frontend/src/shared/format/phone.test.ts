import { describe, expect, it } from "vitest";
import { formatPhone } from "./phone";

describe("formatPhone", () => {
  it("groups a complete Uzbek E.164 number", () => {
    expect(formatPhone("+998901234567")).toBe("+998 90 123 45 67");
  });
  it("tolerates spacing and a missing plus", () => {
    expect(formatPhone(" 998 (90) 123-45-67 ")).toBe("+998 90 123 45 67");
  });
  it("leaves foreign / partial numbers as typed", () => {
    expect(formatPhone("+79161234567")).toBe("+79161234567");
    expect(formatPhone("+99890123")).toBe("+99890123");
  });
  it("returns empty for null", () => {
    expect(formatPhone(null)).toBe("");
    expect(formatPhone(undefined)).toBe("");
  });
});
