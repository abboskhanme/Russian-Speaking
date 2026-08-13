import type { SVGProps } from "react";

/**
 * Nav icons — Ovoz DS, 24×24 grid, drawn with `currentColor` so the active /
 * inactive colour flows from the item's CSS `color` (docs/03 §3.6 Foundations).
 * Extracted faithfully from `docs/design/mockups/Govorim - Student.dc.html`
 * (the bottom-nav SVGs). No icon-library dependency.
 */

type IconProps = SVGProps<SVGSVGElement>;

function base(props: IconProps) {
  return {
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    ...props,
  } satisfies IconProps;
}

/** Bosh — home. */
export function HomeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Mashq — practice (open book). */
export function PracticeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        d="M12 6.5C10.4 5.3 8.2 4.5 6 4.5c-1 0-2 .15-3 .45v13c1-.3 2-.45 3-.45 2.2 0 4.4.8 6 2 1.6-1.2 3.8-2 6-2 1 0 2 .15 3 .45v-13c-1-.3-2-.45-3-.45-2.2 0-4.4.8-6 2z"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
      <path d="M12 6.5v12.5" stroke="currentColor" strokeWidth={1.7} />
    </svg>
  );
}

/** AI Suhbat — roleplay chat (speech bubble). */
export function ChatIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        d="M4.5 5.5h15a1 1 0 0 1 1 1v8.5a1 1 0 0 1-1 1H10l-4 3.5V16H4.5a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1z"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
      <path
        d="M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * AI Suhbat / Speak — a solid microphone for the raised centre FAB (the white
 * mic on the orange FAB in the mockup): a filled capsule body, the pickup holder
 * arc, and a stem + base. Drawn with `currentColor` so it inherits the FAB's ink.
 */
export function MicIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="9" y="2.5" width="6" height="11" rx="3" fill="currentColor" />
      <path
        d="M5.75 11a6.25 6.25 0 0 0 12.5 0"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
      />
      <path
        d="M12 17.25V20.5M8.5 20.5h7"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Guruhlar — groups / cohort (two people). */
export function GroupsIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="9" cy="8" r="3.2" stroke="currentColor" strokeWidth={1.8} />
      <path
        d="M3.5 20a5.5 5.5 0 0 1 11 0"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <path
        d="M16 5.2a3.2 3.2 0 0 1 0 5.6M17 14.6A5.5 5.5 0 0 1 20.5 20"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Topshiriqlar — assignments (clipboard with a checkmark). */
export function AssignmentsIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="5" y="4" width="14" height="17" rx="2.4" stroke="currentColor" strokeWidth={1.8} />
      <path
        d="M9 3.5h6a1 1 0 0 1 1 1V6a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
      <path
        d="m8.5 13 2 2 4-4.5"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Jurnal — gradebook (ruled ledger). */
export function GradebookIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="4" y="4" width="16" height="16" rx="2.4" stroke="currentColor" strokeWidth={1.8} />
      <path
        d="M8 4v16M11.5 9h5M11.5 12.5h5M11.5 16h3"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ── Teacher-only glyphs, traced from `Govorim - Teacher.dc.html`'s bottom bar.
 * The teacher nav is its own model (Bosh · Klasslar · Navbat · Kontent ·
 * Analitika), so these are NOT the student icons under new names. ────────── */

/**
 * Navbat — the grading queue on the raised centre FAB. A clipboard with a tick:
 * the teacher's counterpart to the student's {@link MicIcon}, and semantically
 * the opposite end of the same loop (they record, the teacher signs off).
 */
export function QueueIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="6" y="4" width="12" height="17" rx="2.5" stroke="currentColor" strokeWidth={1.9} />
      <path
        d="M9 4.5V3.5h6v1"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m9 12.5 2 2 4-4"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Kontent — modules & scenarios (stacked layers). */
export function ContentIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        d="M12 3 3 8l9 5 9-5z"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <path d="M3 13l9 5 9-5" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" />
    </svg>
  );
}

/** Progress — bar chart. Also the teacher's Analitika glyph: both mockups draw
 * this exact path, so it is genuinely one icon rather than a student import. */
export function ProgressIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        d="M4 19V9m5 10V5m5 14v-7m5 7V11"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Profil — user. */
export function ProfileIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth={1.8} />
      <path
        d="M5 20a7 7 0 0 1 14 0"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Sozlamalar — gear. The admin panel's fourth destination; no existing icon
 *  carried "settings", and reusing an unrelated glyph would make the bar read as
 *  a relabelled teacher nav rather than its own. */
export function SettingsIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth={1.8} />
      <path
        d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M18 6l-1.4 1.4M7.4 16.6 6 18M18 18l-1.4-1.4M7.4 7.4 6 6"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </svg>
  );
}

/** O'qituvchilar — a person with a board, distinct from GroupsIcon (a class of
 *  students) so the admin bar does not read "Guruhlar" twice. */
export function TeachersIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="4" width="18" height="11" rx="2" stroke="currentColor" strokeWidth={1.8} />
      <path
        d="M12 15v5M8.5 20h7M7.5 8.5h6M7.5 11.5h4"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </svg>
  );
}
