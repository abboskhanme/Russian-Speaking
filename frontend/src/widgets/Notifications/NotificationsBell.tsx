import { useCallback, useEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, SVGProps } from "react";
import { useTranslation } from "react-i18next";
import { cx } from "../../shared/ui";
import { endpoints } from "../../shared/api";
import { tokenStore } from "../../shared/auth";
import { NotificationsModal } from "./NotificationsModal";
import styles from "./NotificationsBell.module.css";

export interface NotificationsBellProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {}

/** Above this the badge stops counting and reads "9+". */
const BADGE_MAX = 9;

/**
 * NotificationsBell — the app-shell `headerEnd` button (replaces ThemeToggle,
 * which now lives in Profil → Sozlamalar).
 *
 * Self-managing and connected: it fetches its own unread count and owns the
 * modal, exactly as `ThemeToggle` self-manages its localStorage theme — so no
 * screen has to thread notification props through. Sized/shaped like the toggle
 * it replaces so the top bar keeps its rhythm.
 *
 * Fails silent by design: a header widget must never take a page down, so any
 * failed or 401'd fetch simply leaves the plain bell with no badge.
 */
export function NotificationsBell({ className, ...props }: NotificationsBellProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  // Guards a setState after unmount when a slow count resolves late.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const refreshCount = useCallback(async () => {
    // No session → no notifications. Skipping avoids a pointless 401 (which the
    // API client answers by bouncing to /login) on a page that renders the
    // shell before auth has settled.
    if (!tokenStore.access) {
      setUnread(0);
      return;
    }
    try {
      const res = await endpoints.unreadCount();
      if (!aliveRef.current) return;
      setUnread(typeof res?.count === "number" && res.count > 0 ? res.count : 0);
    } catch {
      // 401 / offline / malformed — degrade to a plain bell, never throw.
      if (aliveRef.current) setUnread(0);
    }
  }, []);

  useEffect(() => {
    void refreshCount();
  }, [refreshCount]);

  const hasUnread = unread > 0;
  // The count is in the accessible name, so the badge never carries meaning by
  // colour (or by sight) alone. One plural-aware key covers all three cases —
  // the locale files define `_zero` so a count of 0 reads "nothing unread"
  // rather than "0 unread".
  const label = t("notifications.bellAria", { count: unread });

  return (
    <>
      <button
        type="button"
        className={cx(styles.bell, className)}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        title={label}
        {...props}
      >
        <span className={styles.icon} aria-hidden>
          <BellIcon />
        </span>
        {hasUnread && (
          <span className={styles.badge} aria-hidden>
            {unread > BADGE_MAX ? `${BADGE_MAX}+` : unread}
          </span>
        )}
      </button>

      <NotificationsModal
        open={open}
        onClose={() => {
          setOpen(false);
          // Reading/deleting inside the modal changes the count.
          void refreshCount();
        }}
        onChanged={refreshCount}
      />
    </>
  );
}

function BellIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" {...props}>
      <path
        d="M6 16V10a6 6 0 0 1 12 0v6l1.5 2.5H4.5z"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <path
        d="M10 19.5a2 2 0 0 0 4 0"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </svg>
  );
}
