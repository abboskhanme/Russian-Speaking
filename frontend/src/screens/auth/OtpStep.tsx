/**
 * OtpStep — the shared "enter the code" view for both auth screens (mockup frame
 * A5, retargeted from SMS to the Telegram bot). Shows a back chevron + title,
 * where the code was sent, the delivery affordance (a "Telegram'da oching"
 * deep-link button for `telegram_bot`, or the literal `dev_hint` code inline for
 * `dev`), the segmented code boxes, a resend link, and the verify button.
 *
 * `children` renders above the code boxes — the login screen slots its
 * name field there when the phone turns out to be new (needs_registration).
 */
import type { FormEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button, Text } from "../../shared/ui";
import type { OtpRequestResponse } from "../../shared/api";
import { OtpInput } from "./OtpInput";
import { BackIcon, TelegramIcon } from "./icons";
import { AuthNote } from "./AuthNote";
import styles from "./Auth.module.css";

export interface OtpStepProps {
  phoneDisplay: string;
  delivery: OtpRequestResponse;
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
  children,
}: OtpStepProps) {
  const { t } = useTranslation();
  const isTelegram = delivery.delivery === "telegram_bot" && !!delivery.telegram_link;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!busy) onVerify();
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

      <Text as="p" variant="body-s" color="muted">
        {t("auth.otp.sentTo")} <b>{phoneDisplay}</b>
      </Text>

      {isTelegram ? (
        <Button asChild variant="secondary" size="lg" fullWidth>
          <a href={delivery.telegram_link ?? "#"} target="_blank" rel="noopener noreferrer">
            <TelegramIcon />
            {t("auth.otp.openTelegram")}
          </a>
        </Button>
      ) : (
        delivery.dev_hint && (
          <div className={styles.devHint}>
            <span className={styles.devHintLabel}>{t("auth.otp.devHint")}</span>
            <span className={styles.devHintCode}>{delivery.dev_hint}</span>
          </div>
        )
      )}

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
          disabled={busy}
          autoFocus
          aria-label={t("auth.otp.codeLabel")}
        />
      </div>

      <button type="button" className={styles.resend} onClick={onResend} disabled={busy || resendBusy}>
        {t("auth.otp.resend")}
      </button>

      <Button type="submit" variant="primary" size="lg" fullWidth loading={busy} disabled={code.length < 6}>
        {submitLabel}
      </Button>
    </form>
  );
}
