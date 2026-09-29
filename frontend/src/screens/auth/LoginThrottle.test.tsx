/**
 * The OTP 429s, said with HOW LONG.
 *
 * The server answers 429 + `Retry-After` for a resend inside the per-phone 60 s
 * cooldown, and for any verify during the lockout after ten wrong codes (the RIGHT
 * code is refused too). Both used to read "Xatolik yuz berdi" — an invitation to
 * try again at exactly the moment trying again cannot work.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "../../shared/i18n";
import type { OtpRequestResponse } from "../../shared/api";
import LoginScreen from "./LoginScreen";

const t = i18n.getFixedT("uz", "common");

const SENT: OtpRequestResponse = {
  ok: true,
  delivery: "dev",
  expires_in: 300,
  telegram_link: null,
  telegram_mode: "deep_link",
  dev_hint: "123456",
  request_id: "r1",
};

function tooMany(retryAfterSec: number): Error {
  return Object.assign(new Error("http_429"), {
    name: "ApiError",
    status: 429,
    detail: "Too Many Requests",
    body: null,
    retryAfterSec,
  });
}

const requestOtp = vi.fn();
const verifyOtp = vi.fn();

vi.mock("../../shared/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared/auth")>();
  return {
    ...actual,
    useAuth: () => ({ requestOtp, verifyOtp, hydrateUser: vi.fn() }),
  };
});

vi.mock("../../shared/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared/api")>();
  return {
    ...actual,
    // The dev one-tap panel is not under test; "no dev routes" renders nothing.
    endpoints: { ...actual.endpoints, devUsers: () => Promise.reject(new Error("404")) },
  };
});

async function toCodeStep() {
  render(
    <MemoryRouter>
      <LoginScreen />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText(t("auth.phoneLabel")), {
    target: { value: "901234567" },
  });
  fireEvent.click(screen.getByRole("button", { name: t("auth.otp.getCode") }));
  await screen.findByRole("button", { name: t("auth.otp.resend") });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  requestOtp.mockReset();
  verifyOtp.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("resend inside the cooldown", () => {
  it("says how long to wait, and the resend button counts down", async () => {
    requestOtp.mockResolvedValueOnce(SENT).mockRejectedValueOnce(tooMany(42));
    await toCodeStep();

    fireEvent.click(screen.getByRole("button", { name: t("auth.otp.resend") }));

    expect(await screen.findByText(t("auth.errors.cooldown", { seconds: 42 }))).toBeInTheDocument();
    const resend = screen.getByRole("button", { name: t("auth.otp.resendIn", { seconds: 42 }) });
    expect(resend).toBeDisabled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByRole("button", { name: t("auth.otp.resendIn", { seconds: 40 }) })).toBeDisabled();

    // At zero the wait is over: the message goes and the button comes back.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(41_000);
    });
    expect(screen.queryByText(/soniya kuting/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("auth.otp.resend") })).toBeEnabled();
  });
});

describe("the verify lockout", () => {
  it("says it in minutes and does not let the code be sent again", async () => {
    requestOtp.mockResolvedValueOnce(SENT);
    verifyOtp.mockRejectedValue(tooMany(600));
    await toCodeStep();

    const firstBox = screen.getByLabelText("1");
    fireEvent.paste(firstBox, { clipboardData: { getData: () => "123456" } });
    fireEvent.click(screen.getByRole("button", { name: t("auth.otp.verify") }));

    expect(await screen.findByText(t("auth.errors.lockout", { minutes: 10 }))).toBeInTheDocument();
    expect(screen.queryByText(t("auth.errors.generic"))).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("auth.otp.verify") })).toBeDisabled();
  });
});
