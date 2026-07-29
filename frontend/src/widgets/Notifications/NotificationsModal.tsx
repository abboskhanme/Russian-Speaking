import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  Button,
  Modal,
  Skeleton,
  Text,
  VisuallyHidden,
  cx,
} from "../../shared/ui";
import { endpoints } from "../../shared/api";
import type { NotificationResponse } from "../../shared/api";
import styles from "./NotificationsModal.module.css";

export interface NotificationsModalProps {
  open: boolean;
  onClose: () => void;
  /** Fired after every successful mutation so the bell can re-read its badge. */
  onChanged?: () => void;
}

/** Which destructive action is awaiting its in-modal confirmation. */
type Pending = "deleteSelected" | "clearAll" | null;

/** How many rows the list asks for — the server's own default is 50. */
const LIST_LIMIT = 50;

/**
 * NotificationsModal — the full-window notification centre.
 *
 * Owns all of its state: the list, the selection, the confirm step and the
 * busy flag. Two rules shape the interaction model:
 *
 *  • Destructive actions confirm INSIDE the dialog. `window.confirm` is a
 *    hard no — it can't be styled and it freezes the automation harness.
 *  • There is no bulk-delete route, so deleting a selection fires one DELETE
 *    per id concurrently and then re-reads the list. Partial failure is
 *    therefore honest: whatever the server still has is what you see.
 */
export function NotificationsModal({
  open,
  onClose,
  onChanged,
}: NotificationsModalProps) {
  const { t } = useTranslation();

  const [items, setItems] = useState<NotificationResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  /** Re-read from the server. Always clears the selection — ids may be gone. */
  const refresh = useCallback(async () => {
    setLoading(true);
    setSelected(new Set());
    try {
      const list = await endpoints.listNotifications(undefined, LIST_LIMIT);
      if (!aliveRef.current) return;
      setItems(Array.isArray(list) ? list : []);
      setFailed(false);
    } catch {
      if (!aliveRef.current) return;
      setItems([]);
      setFailed(true);
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  // Fetch on open; reset everything on close so the next open starts clean.
  useEffect(() => {
    if (open) {
      setPending(null);
      void refresh();
    } else {
      setSelected(new Set());
      setPending(null);
    }
  }, [open, refresh]);

  // One "now" per open keeps every relative date in the list consistent.
  const now = useMemo(() => new Date(), [open]);

  const hasItems = items.length > 0;
  const allSelected = hasItems && selected.size === items.length;
  const someSelected = selected.size > 0 && !allSelected;

  // `indeterminate` is a DOM property with no HTML attribute — React can only
  // set it through a ref.
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected;
  }, [someSelected, items.length]);

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) =>
      prev.size === items.length ? new Set() : new Set(items.map((n) => n.id)),
    );
  }, [items]);

  /** Row body click — mark read optimistically; the anchor navigates itself. */
  const markRead = useCallback(
    async (n: NotificationResponse) => {
      if (n.is_read) return;
      setItems((prev) =>
        prev.map((i) => (i.id === n.id ? { ...i, is_read: true } : i)),
      );
      try {
        await endpoints.markNotificationRead(n.id);
        onChanged?.();
      } catch {
        // Roll the optimistic tick back so the row doesn't lie about the server.
        if (aliveRef.current) {
          setItems((prev) =>
            prev.map((i) => (i.id === n.id ? { ...i, is_read: false } : i)),
          );
        }
      }
    },
    [onChanged],
  );

  const runPending = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending === "clearAll") {
        await endpoints.clearAllNotifications();
      } else {
        // No bulk route by design — one DELETE per id, in parallel.
        // `allSettled`: one failure must not abandon the rest.
        await Promise.allSettled(
          [...selected].map((id) => endpoints.deleteNotification(id)),
        );
      }
    } catch {
      // Swallowed on purpose: the refresh below is the source of truth, so a
      // partial or total failure shows up as rows that are still there.
    } finally {
      if (aliveRef.current) {
        setBusy(false);
        setPending(null);
      }
    }
    await refresh();
    onChanged?.();
  }, [pending, selected, refresh, onChanged]);

  const confirmPrompt =
    pending === "clearAll"
      ? t("notifications.confirmClearAll")
      : t("notifications.confirmDeleteSelected", { count: selected.size });

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="full"
      title={t("notifications.title")}
      closeLabel={t("common.close")}
    >
      <div className={styles.wrap}>
        {/* The toolbar only exists to act on rows, so with an empty list it is
            all dead controls — hide it entirely rather than showing greyed-out
            "select all" / "clear all" above "there's nothing here". */}
        {hasItems && (
        <div className={styles.toolbar}>
          <label className={styles.selectAll}>
            <input
              ref={selectAllRef}
              type="checkbox"
              className={styles.checkbox}
              checked={allSelected}
              disabled={items.length === 0 || busy}
              onChange={toggleAll}
            />
            <Text as="span" variant="body-s" color="ink-soft">
              {t("notifications.selectAll")}
            </Text>
          </label>

          {selected.size > 0 && (
            <Text as="span" variant="body-s" color="muted">
              {t("notifications.selected", { count: selected.size })}
            </Text>
          )}

          <span className={styles.spacer} />

          <div className={styles.actions}>
            <Button
              variant="ghost"
              size="sm"
              disabled={selected.size === 0 || busy}
              onClick={() => setPending("deleteSelected")}
            >
              {t("notifications.deleteSelected")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={items.length === 0 || busy}
              onClick={() => setPending("clearAll")}
            >
              {t("notifications.clearAll")}
            </Button>
          </div>
        </div>
        )}

        {pending && (
          <div className={styles.confirm} role="alertdialog" aria-label={confirmPrompt}>
            <Text as="p" variant="body">
              {confirmPrompt}
            </Text>
            <div className={styles.confirmActions}>
              <Button
                variant="danger"
                size="sm"
                loading={busy}
                onClick={() => void runPending()}
              >
                {t("notifications.confirm")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => setPending(null)}
              >
                {t("notifications.cancel")}
              </Button>
            </div>
          </div>
        )}

        {loading ? (
          <LoadingRows />
        ) : failed ? (
          <div className={styles.state}>
            <Text as="p" variant="title-s">
              {t("errors.loadTitle")}
            </Text>
            <Text as="p" variant="body-s" color="muted">
              {t("errors.loadBody")}
            </Text>
          </div>
        ) : items.length === 0 ? (
          <div className={styles.state}>
            <span className={styles.stateIcon} aria-hidden>
              <EmptyBellIcon />
            </span>
            <Text as="p" variant="body" color="muted">
              {t("notifications.empty")}
            </Text>
          </div>
        ) : (
          <ul className={styles.list}>
            {items.map((n) => (
              <NotificationRow
                key={n.id}
                notification={n}
                now={now}
                checked={selected.has(n.id)}
                disabled={busy}
                onToggle={toggleOne}
                onOpen={markRead}
              />
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Row                                                                        */
/* -------------------------------------------------------------------------- */

interface NotificationRowProps {
  notification: NotificationResponse;
  now: Date;
  checked: boolean;
  disabled: boolean;
  onToggle: (id: string) => void;
  onOpen: (n: NotificationResponse) => void;
}

function NotificationRow({
  notification: n,
  now,
  checked,
  disabled,
  onToggle,
  onOpen,
}: NotificationRowProps) {
  const { t } = useTranslation();
  const when = relativeDate(t, n.created_at, now);
  const href = safeHref(n.link);
  const external = href !== undefined && !href.startsWith("/");

  const body = (
    <>
      <span className={styles.rowHead}>
        <Text as="span" variant="title-s" className={styles.rowTitle}>
          {n.title}
        </Text>
        {!n.is_read && (
          <>
            {/* The dot is decorative; this label is what carries "unread" to a
             * reader who can't see (or can't distinguish) the colour. */}
            <VisuallyHidden>{t("notifications.unread")}</VisuallyHidden>
            <span className={styles.dot} aria-hidden />
          </>
        )}
      </span>

      {n.body && (
        <Text as="span" variant="body-s" color="ink-soft">
          {n.body}
        </Text>
      )}

      {when && (
        <Text as="span" variant="body-s" color="muted" className={styles.time}>
          {when}
        </Text>
      )}
    </>
  );

  return (
    <li className={cx(styles.row, !n.is_read && styles.rowUnread)}>
      {/* The label IS the checkbox's hit area, named "select <title>" so a
       * screen reader hears what ticking it does rather than just the headline.
       * It is a SIBLING of the row body, never nested inside it, so ticking can
       * never navigate and there is no control-inside-a-control. */}
      <label className={styles.rowCheck}>
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={checked}
          disabled={disabled}
          onChange={() => onToggle(n.id)}
        />
        <VisuallyHidden>{t("notifications.selectRow", { title: n.title })}</VisuallyHidden>
      </label>

      {href ? (
        <a
          className={styles.rowBody}
          href={href}
          // rel is mandatory with target=_blank — without it the opened page
          // gets a handle on this one (tabnabbing).
          target={external ? "_blank" : undefined}
          rel={external ? "noopener noreferrer" : undefined}
          onClick={(event: MouseEvent<HTMLAnchorElement>) => {
            if (disabled) event.preventDefault();
            else onOpen(n);
          }}
        >
          {body}
        </a>
      ) : (
        <button
          type="button"
          className={styles.rowBody}
          disabled={disabled}
          onClick={() => onOpen(n)}
        >
          {body}
        </button>
      )}
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Loading                                                                    */
/* -------------------------------------------------------------------------- */

function LoadingRows() {
  return (
    <div className={styles.list}>
      {[0, 1, 2].map((i) => (
        <div key={i} className={styles.skeletonRow}>
          <Skeleton width="55%" height={18} />
          <Skeleton width="85%" height={14} />
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Local helpers                                                              */
/* -------------------------------------------------------------------------- */

/**
 * An href only if it is a real, navigable destination. `link` is server data,
 * so the scheme is checked here: a `javascript:` value reaching an anchor would
 * execute on click. In-app paths ("/practice/…") pass through; "//host" does
 * not, since it is protocol-relative and leaves the app.
 */
function safeHref(link: string | null): string | undefined {
  const trimmed = link?.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("//")) return undefined;
  if (trimmed.startsWith("/")) return trimmed;
  try {
    const { protocol } = new URL(trimmed);
    return protocol === "http:" || protocol === "https:" ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

/** Local midnight for a date — the boundary relative dates are measured from. */
function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Whole calendar days between two instants, counted by LOCAL day boundary
 * rather than by a 24h delta — so a notification from 23:00 last night is 1 day
 * ago ("Kecha") even though only two hours have passed. Rounding absorbs the
 * 23h / 25h days that DST transitions produce. (Same helper as ResultsTab.)
 */
function calendarDaysBetween(from: Date, to: Date): number {
  const MS_PER_DAY = 86_400_000;
  return Math.round((startOfLocalDay(to) - startOfLocalDay(from)) / MS_PER_DAY);
}

/**
 * "Bugun" / "Kecha" / "{{count}} kun oldin" / "{{count}} hafta oldin", reusing
 * the existing `profile.relativeDate.*` keys rather than duplicating them.
 * Returns `null` for an unparseable timestamp so the caller can omit the line.
 */
function relativeDate(t: TFunction, iso: string, now: Date): string | null {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;

  const days = calendarDaysBetween(then, now);

  // Clock skew can put a fresh notification marginally in the future — still today.
  if (days <= 0) return t("profile.relativeDate.today");
  if (days === 1) return t("profile.relativeDate.yesterday");
  if (days < 7) return t("profile.relativeDate.daysAgo", { count: days });
  return t("profile.relativeDate.weeksAgo", { count: Math.floor(days / 7) });
}

/** Decorative bell for the empty state (the wrapper carries `aria-hidden`). */
function EmptyBellIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
      <path
        d="M6 16V10a6 6 0 0 1 12 0v6l1.5 2.5H4.5z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M10 19.5a2 2 0 0 0 4 0"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
