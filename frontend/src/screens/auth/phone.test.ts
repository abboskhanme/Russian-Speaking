/**
 * screens/auth/phone — the number the OTP is actually sent to.
 *
 * The UI holds 9 national digits and the API wants E.164. Every failure mode here
 * is silent: a stray space or a pasted `+998` prefix produces a number that is
 * merely *wrong*, not invalid, so the OTP goes to a stranger and the user just
 * sees "code never arrived".
 */
import { describe, expect, it } from "vitest";
import { formatDisplay, groupNational, isValidUz, nationalDigits, toE164 } from "./phone";

describe("nationalDigits", () => {
  it("strips everything that is not a digit", () => {
    expect(nationalDigits("90 123 45 67")).toBe("901234567");
    expect(nationalDigits("(90) 123-45-67")).toBe("901234567");
  });

  it("drops a pasted country code", () => {
    // Pasting from a contact card is the normal way this input gets filled.
    expect(nationalDigits("+998 90 123 45 67")).toBe("901234567");
    expect(nationalDigits("998901234567")).toBe("901234567");
  });

  it("caps at 9 digits so overtyping cannot corrupt the number", () => {
    expect(nationalDigits("9012345678999")).toBe("901234567");
  });

  it("passes an empty value through", () => {
    expect(nationalDigits("")).toBe("");
    expect(nationalDigits("abc")).toBe("");
  });
});

describe("groupNational / formatDisplay", () => {
  it("groups as 90 123 45 67", () => {
    expect(groupNational("901234567")).toBe("90 123 45 67");
    expect(formatDisplay("901234567")).toBe("+998 90 123 45 67");
  });

  it("groups partial input without a trailing separator", () => {
    expect(groupNational("9")).toBe("9");
    expect(groupNational("901")).toBe("90 1");
    expect(groupNational("90123")).toBe("90 123");
    expect(groupNational("9012345")).toBe("90 123 45");
  });

  it("shows the bare prefix while the field is empty", () => {
    expect(formatDisplay("")).toBe("+998 ");
  });
});

describe("toE164", () => {
  it("emits the API form with no spaces and exactly one country code", () => {
    expect(toE164("90 123 45 67")).toBe("+998901234567");
    expect(toE164("+998901234567")).toBe("+998901234567");
  });
});

describe("isValidUz", () => {
  it("requires all 9 national digits", () => {
    expect(isValidUz("901234567")).toBe(true);
    expect(isValidUz("+998 90 123 45 67")).toBe(true);
    expect(isValidUz("90123456")).toBe(false);
    expect(isValidUz("")).toBe(false);
  });
});
