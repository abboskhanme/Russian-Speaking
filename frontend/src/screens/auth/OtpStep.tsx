/**
 * OtpStep — the shared "enter the code" view for EVERY flow that mints an OTP:
 * both auth screens (mockup frame A5, retargeted from SMS to the Telegram bot)
 * and the Profile "Ma'lumot" tab's phone-change dialog. Shows a back chevron +
 * title, where the code was sent, the delivery affordance, the segmented code
 * boxes, a resend link, and the verify button. The user ALWAYS types the code
 * and presses Tasdiqlash — there is no auto-login.
 *
 * The `telegram_bot` delivery comes in two modes:
 *  - `direct`    — the code was DM'd straight to an already-bound Telegram
 *                  account. Nothing to wait on, so this step does NOT poll: it
 *                  just says the code was sent, offers a button to open the chat,
 *                  and shows the code boxes.
 *  - `deep_link` — no binding yet. The user opens the deep link, presses START
 *                  and shares their contact; that ownership verdict happens
 *                  inside Telegram, out of the browser's sight, so this step
 *                  polls `GET /api/auth/otp/status` every few seconds until the
 *                  request reaches a terminal state. On `mismatch` /
 *                  `not_own_contact` the server has already BURNED the code — we
 *                  say so in a danger panel, disable the boxes, and point back at
 *                  phone entry, because no code the user could type would work.
 *
 * `children` renders above the code boxes — the login screen slots its name
 * field there when the phone turns out to be new (needs_registration).
 */
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button, Text } from "../../shared/ui";
import {
  endpoints,
  isTerminalOtpState,
  type OtpDeliveryInfo,
  type OtpState,
} from "../../shared/api";
import { OtpInput } from "./OtpInput";
import { BackIcon, TelegramIcon, WarnIcon } from "./icons";
import { AuthNote } from "./AuthNote";
import styles from "./Auth.module.css";

/**
 * How often the Telegram delivery state is polled. 3 s rather than 2 s so a whole
 * class signing up behind one NAT stays inside the server's per-IP `otp_status`
 * budget — at 20 calls/min each, ~60 concurrent pollers share one address before
 * anyone is throttled. Still fast enough that a mismatch warning feels immediate.
 */
const POLL_INTERVAL_MS = 3000;

export interface OtpStepProps {
  phoneDisplay: string;
  /** Typed as the shared {@link OtpDeliveryInfo} rather than one flow's
   *  response, so sign-in, registration AND the profile's phone-change dialog
   *  all get this exact view — mode branching, status polling and the
   *  burned-code warning included. Widening only: every OTP response satisfies
   *  it. */
  delivery: OtpDeliveryInfo;
  code: string;
  onCodeChange: (code: string) => void;
  onVerify: () => void;
  onBack: () => void;
  onResend: () => void;
  submitLabel: string;
  busy: boolean;
  resendBusy?: boolean;
  error?: string | null;
  info?: string | null;
  /** Optional content rendered right under the header (register shows the stepper). */
  topSlot?: ReactNode;
  children?: ReactNode;
}

export function OtpStep({
  phoneDisplay,
  delivery,
  code,
  onCodeChange,
  onVerify,
  onBack,
  onResend,
  submitLabel,
  busy,
  resendBusy = false,
  error,
  info,
  topSlot,
  children,
}: OtpStepProps) {
  const { t } = useTranslation();
  const isTelegram = delivery.delivery === "telegram_bot" && !!delivery.telegram_link;
  // A `direct` send DM'd the code to a bound account — no contact-share verdict
  // to wait on. Anything else telegram (incl. an old backend that omits the mode)
  // stays on the safe deep-link path with its polling + burn protection.
  const isDirect = isTelegram && delivery.telegram_mode === "direct";

  const [state, setState] = useState<OtpState | null>(null);

  // Only deep-link Telegram delivery has a verdict to wait for. Dev prints the
  // code inline (never poll); direct has already delivered. `request_id` is also
  // the guard against an older backend that doesn't return one yet.
  const requestId = delivery.request_id;
  const shouldPoll = isTelegram && !isDirect && !!requestId;

  useEffect(() => {
    // A resend hands us a fresh request_id — the previous verdict is void.
    setState(null);
    if (!shouldPoll) return;

    let cancelled = false; // set by cleanup → no setState after unmount
    let inFlight = false; // a slow poll must not be overlapped by the next tick
    const controller = new AbortController();
    let timer: ReturnType<typeof setInterval> | undefined = undefined;

    const stop = () => {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    };

    const tick = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const res = await endpoints.otpStatus(requestId, controller.signal);
        if (cancelled) return;
        setState(res.state);
        if (isTerminalOtpState(res.state)) stop();
      } catch {
        // Transient (offline, abort, rate-limit) — keep polling until terminal.
      } finally {
        inFlight = false;
      }
    };

    timer = setInterval(() => void tick(), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      stop();
      controller.abort();
    };
  }, [requestId, shouldPoll]);

  // The code is gone server-side; typing one can only ever fail from here. Only
  // reachable in deep-link mode (direct never polls, so `state` stays null).
  const burned = state === "mismatch" || state === "not_own_contact";

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!busy && !burned) onVerify();
  }

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <div className={styles.codeHead}>
        <button type="button" className={styles.backBtn} onClick={onBack} aria-label={t("common.back")}>
          <BackIcon />
        </button>
        <Text as="h2" variant="title-m">
          {t("auth.otp.title")}
        </Text>
      </div>

      {topSlot}

      <Text as="p" variant="body-s" color="muted">
        {t("auth.otp.sentTo")} <b>{phoneDisplay}</b>
      </Text>

      {isTelegram ? (
        <>
          <Text as="p" variant="body-s" color="muted">
            {isDirect ? t("auth.otp.sentDirect") : t("auth.otp.openTelegramHint")}
          </Text>
          <Button asChild variant="secondary" size="lg" fullWidth>
            <a href={delivery.telegram_link ?? "#"} target="_blank" rel="noopener noreferrer">
              <TelegramIcon />
              {t("auth.otp.openTelegram")}
            </a>
          </Button>
        </>
      ) : (
        delivery.dev_hint && (
          <div className={styles.devHint}>
            <span className={styles.devHintLabel}>{t("auth.otp.devHint")}</span>
            <span className={styles.devHintCode}>{delivery.dev_hint}</span>
          </div>
        )
      )}

      {burned && (
        <div className={styles.otpAlert} role="alert">
          <span className={styles.otpAlertIcon} aria-hidden>
            <WarnIcon />
          </span>
          <div className={styles.otpAlertBody}>
            <span className={styles.otpAlertTitle}>
              {state === "mismatch"
                ? t("auth.otpStatus.mismatch.title")
                : t("auth.otpStatus.notOwnContact.title")}
            </span>
            <span className={styles.otpAlertText}>
              {state === "mismatch"
                ? t("auth.otpStatus.mismatch.text")
                : t("auth.otpStatus.notOwnContact.text")}
            </span>
            <button type="button" className={styles.otpAlertAction} onClick={onBack}>
              {t("auth.otpStatus.startOver")}
            </button>
          </div>
        </div>
      )}

      {state === "sent" && <AuthNote tone="success">{t("auth.otpStatus.sent")}</AuthNote>}

      {state === "expired" && <AuthNote tone="info">{t("auth.otpStatus.expired")}</AuthNote>}

      {info && <AuthNote tone="info">{info}</AuthNote>}

      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}

      {children}

      <div className={styles.field}>
        <span className={styles.fieldLabel}>{t("auth.otp.codeLabel")}</span>
        <OtpInput
          value={code}
          onChange={onCodeChange}
          disabled={busy || burned}
          autoFocus
          aria-label={t("auth.otp.codeLabel")}
        />
      </div>

      <button
        type="button"
        className={styles.resend}
        onClick={onResend}
        disabled={busy || resendBusy}
      >
        {t("auth.otp.resend")}
      </button>

      <Button
        type="submit"
        variant="primary"
        size="lg"
        fullWidth
        loading={busy}
        disabled={code.length < 6 || burned}
      >
        {submitLabel}
      </Button>
    </form>
  );
}
