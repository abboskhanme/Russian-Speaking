import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

// Build-time fallbacks — used until the runtime config loads, or if it fails.
// Env-overridable (VITE_TG_SUPPORT / VITE_TG_CHANNEL) for a fresh install.
export const TELEGRAM_SUPPORT_URL =
  import.meta.env.VITE_TG_SUPPORT || "https://t.me/govori_support";
export const TELEGRAM_CHANNEL_URL =
  import.meta.env.VITE_TG_CHANNEL || "https://t.me/govori_channel";

export interface OutboundLinks {
  tg_support_url: string;
  tg_channel_url: string;
}

/** Admin-managed outbound links (Telegram support/channel), fetched at runtime
 * so they change without a frontend rebuild. Falls back to the build-time
 * defaults while loading or on error. */
export function useOutboundLinks(): OutboundLinks {
  const { data } = useQuery({
    queryKey: ["outbound-links"],
    queryFn: async () => (await api.get<OutboundLinks>("/settings/links")).data,
    staleTime: 5 * 60_000,
  });
  return {
    tg_support_url: data?.tg_support_url || TELEGRAM_SUPPORT_URL,
    tg_channel_url: data?.tg_channel_url || TELEGRAM_CHANNEL_URL,
  };
}
