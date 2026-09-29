import type { ReactNode } from "react";

/**
 * What the notification centre knows about each `type` — and, deliberately, what
 * it does NOT do with it.
 *
 * The server stores every notification as RENDERED text (title + body, in the
 * recipient's language) plus a `type` and an optional `link`. So the centre prints
 * the title and body exactly as given and never builds a sentence from the type:
 * a type is only allowed to choose an ICON, and to supply a destination when an
 * older row was written without a link. A type this build has never seen gets the
 * generic bell and no destination — it still renders, and the raw type string is
 * never shown to anyone.
 *
 * Destinations are real routes in `App.tsx`:
 *   • `review_added`   (student) → `/review`, the SRS drill it has always linked to
 *   • `assignment_new` (student) → `/practice?tab=assignments`
 *   • `review_done`    (student) → the server links `/results/{id}`; no generic fallback
 *   • `join_approved`  (student) → `/group`
 *   • `join_rejected`  (student) → `/group` (where another code can be entered)
 *   • `join_request`   (teacher) → `/teacher/classes?tab=requests`, the So'rovlar tab
 */
export type NotificationKind =
  | "review_added"
  | "assignment_new"
  | "review_done"
  | "join_approved"
  | "join_rejected"
  | "join_request";

interface KindInfo {
  icon: () => ReactNode;
  /** Used only when the row itself carries no `link`. */
  fallbackLink: string | null;
}

const KINDS: Record<NotificationKind, KindInfo> = {
  review_added: { icon: RepeatIcon, fallbackLink: "/review" },
  assignment_new: { icon: TaskIcon, fallbackLink: "/practice?tab=assignments" },
  review_done: { icon: CheckIcon, fallbackLink: null },
  join_approved: { icon: GroupIcon, fallbackLink: "/group" },
  join_rejected: { icon: GroupIcon, fallbackLink: "/group" },
  join_request: { icon: PersonAddIcon, fallbackLink: "/teacher/classes?tab=requests" },
};

/** True for the types this build draws a dedicated icon for. */
export function isKnownKind(type: string): type is NotificationKind {
  return Object.prototype.hasOwnProperty.call(KINDS, type);
}

/** The row's icon: the type's own, or the generic bell for anything unknown. */
export function kindIcon(type: string): ReactNode {
  return isKnownKind(type) ? KINDS[type].icon() : BellIcon();
}

/** Where the row goes: the server's `link` when it sent one, else the type's
 * fallback, else nowhere (the row is then a plain, non-navigating item). */
export function notificationLink(type: string, link: string | null): string | null {
  const own = link?.trim();
  if (own) return own;
  return isKnownKind(type) ? KINDS[type].fallbackLink : null;
}

/* ---- Glyphs (18px, stroke = currentColor; the wrapper carries aria-hidden) ---- */

function svg(children: ReactNode) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

function BellIcon() {
  return svg(
    <>
      <path d="M6 16V10a6 6 0 0 1 12 0v6l1.5 2.5H4.5z" />
      <path d="M10 19.5a2 2 0 0 0 4 0" />
    </>,
  );
}

function RepeatIcon() {
  return svg(
    <>
      <path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5" />
      <path d="M20 4v4.5h-4.5" />
      <path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.5" />
      <path d="M4 20v-4.5h4.5" />
    </>,
  );
}

function TaskIcon() {
  return svg(
    <>
      <rect x="5" y="3" width="14" height="18" rx="2.5" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </>,
  );
}

function CheckIcon() {
  return svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.5 2.8 2.8L16 10" />
    </>,
  );
}

function GroupIcon() {
  return svg(
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 19a6 6 0 0 1 12 0" />
      <path d="M16 5.2a3 3 0 0 1 0 5.6M18 19a6 6 0 0 0-2.4-4.8" />
    </>,
  );
}

function PersonAddIcon() {
  return svg(
    <>
      <circle cx="10" cy="8" r="3.4" />
      <path d="M3.5 19.5a6.5 6.5 0 0 1 13 0" />
      <path d="M19 8v6M16 11h6" />
    </>,
  );
}
