import type { SVGProps } from "react";

/**
 * Nav icons — Ovoz DS, 24×24 grid, drawn with `currentColor` so the active /
 * inactive colour flows from the item's CSS `color` (docs/03 §3.6 Foundations).
 * Extracted faithfully from `RussianDesign/Govori/Govorim - Student.dc.html`
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

/** Speak — microphone (the mobile "Gapirish" FAB in the mockup). */
export function MicIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
      <path
        d="M6 11a6 6 0 0 0 12 0M12 17v4"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Progress — bar chart. */
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
