/**
 * The regrade refusal → words mapping. The server's `detail` is English prose; the
 * student must read the reason in their own language, so only the `code` is used.
 */
import { describe, expect, it } from "vitest";
import i18n from "../shared/i18n";
import { canRegrade, regradeErrorCode, regradeErrorText } from "./regrade";

const t = i18n.getFixedT("uz", "common");

function apiError(status: number, body: unknown) {
  const e = new Error("x") as Error & { status: number; detail: string; body: unknown; retryAfterSec: null };
  e.name = "ApiError";
  e.status = status;
  e.detail = "English detail";
  e.body = body;
  e.retryAfterSec = null;
  return e;
}

describe("regrade errors", () => {
  it("maps each known code to its own sentence", () => {
    for (const code of ["not_failed", "audio_expired", "attempts_exhausted", "payment_required", "ai_unavailable"]) {
      const e = apiError(409, { detail: "x", code });
      expect(regradeErrorCode(e)).toBe(code);
      expect(regradeErrorText(t, e)).toBe(t(`uiDash.regrade.error.${code}`));
    }
  });

  it("never shows the English detail for an unknown failure", () => {
    expect(regradeErrorText(t, apiError(500, { detail: "boom" }))).toBe(t("uiDash.regrade.error.generic"));
    expect(regradeErrorText(t, apiError(429, null))).toBe(t("uiDash.regrade.error.rate_limited"));
    expect(regradeErrorText(t, new Error("network"))).toBe(t("uiDash.regrade.error.generic"));
  });

  it("offers a retry only for a failed attempt whose recording still exists", () => {
    expect(canRegrade("failed", false)).toBe(true);
    expect(canRegrade("failed", true)).toBe(false);
    expect(canRegrade("done", false)).toBe(false);
  });
});
