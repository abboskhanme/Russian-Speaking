import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { cx } from "../utils/cx";
import { Text } from "../Text/Text";
import styles from "./Modal.module.css";

export interface ModalProps {
  /** Controlled visibility. Nothing is mounted while `false`. */
  open: boolean;
  /** Fired by Escape, the scrim, and the close button. */
  onClose: () => void;
  /** Dialog heading — also the dialog's accessible name (`aria-labelledby`). */
  title: ReactNode;
  children?: ReactNode;
  /** Accessible name for the ✕ button. */
  closeLabel?: string;
  /**
   * Panel footprint.
   *  - `"md"` (default) — the centred 480px card, bottom sheet under 560px.
   *  - `"full"` — fills the viewport: no max-width, full height, the header
   *    pinned while the body scrolls in its own region, safe-area insets
   *    respected. For list surfaces that own the whole screen.
   *
   * Behaviour (portal, focus trap, Escape, scrim, scroll lock, a11y wiring) is
   * identical in both — only the box changes.
   */
  size?: "md" | "full";
  /** Class for the panel (the scrim is not stylable from outside). */
  className?: string;
}

/** Tabbable descendants, in DOM order. Excludes anything disabled or hidden. */
const FOCUSABLE = [
  "a[href]",
  "button:not(:disabled)",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el.getClientRects().length > 0,
  );
}

function CloseIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

/**
 * Modal — centred dialog, bottom sheet on narrow screens (docs/03 §3.6
 * Containment). Used for the Yordam markazi / Maxfiylik siyosati sheets.
 *
 * Rendered in a portal on `document.body` so no ancestor `overflow`/`transform`
 * can clip it. While open it: traps Tab inside the panel, moves focus in and
 * restores it to the trigger on close, closes on Escape and on scrim click
 * (never on a click inside the panel), and locks background scroll.
 *
 * `size="full"` swaps the card for a full-window surface (the notifications
 * centre) without changing any of that behaviour — see {@link ModalProps.size}.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  closeLabel = "Yopish",
  size = "md",
  className,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Keep the latest onClose without re-running the open effect (which would
  // re-steal focus and re-run the scroll lock on every parent render).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;

    const restoreTo = document.activeElement as HTMLElement | null;
    const { body } = document;
    const prevOverflow = body.style.overflow;
    body.style.overflow = "hidden";

    const panel = panelRef.current;
    if (panel) (focusable(panel)[0] ?? panel).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const el = panelRef.current;
      if (!el) return;
      const items = focusable(el);
      const active = document.activeElement;

      // Nothing tabbable inside: keep focus parked on the panel itself.
      if (items.length === 0) {
        event.preventDefault();
        el.focus();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const outside = !el.contains(active);

      if (event.shiftKey) {
        if (outside || active === first || active === el) {
          event.preventDefault();
          last.focus();
        }
      } else if (outside || active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      body.style.overflow = prevOverflow;
      if (restoreTo?.isConnected) restoreTo.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className={cx(styles.root, size === "full" && styles.full)}>
      {/* Own element rather than a target check, so a click that starts inside
          the panel and ends on the scrim cannot close the dialog. */}
      <div className={styles.scrim} onClick={onClose} aria-hidden />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx(styles.panel, className)}
      >
        <div className={styles.header}>
          <Text as="h2" id={titleId} variant="title-m" className={styles.title}>
            {title}
          </Text>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label={closeLabel}
          >
            <CloseIcon />
          </button>
        </div>

        <div className={styles.body}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
