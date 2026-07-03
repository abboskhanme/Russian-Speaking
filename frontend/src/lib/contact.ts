// Telegram contact links shown in the sidebar (support + channel), for everyone.
// Env-overridable so they can change without a code edit; replace the fallbacks
// with your real @handles (or set VITE_TG_SUPPORT / VITE_TG_CHANNEL).
export const TELEGRAM_SUPPORT_URL =
  import.meta.env.VITE_TG_SUPPORT || "https://t.me/govori_support";
export const TELEGRAM_CHANNEL_URL =
  import.meta.env.VITE_TG_CHANNEL || "https://t.me/govori_channel";
