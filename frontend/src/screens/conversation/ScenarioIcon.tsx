/**
 * ScenarioIcon — the AI Suhbat scenario glyphs, drawn in the app's own line-icon
 * style (24×24, 1.8 stroke, `currentColor`, like `widgets/Nav/icons`) instead of
 * platform emoji, which rendered differently on every phone and clashed with the
 * line icons around them. Decorative everywhere (the title beside it says the
 * same thing), so always `aria-hidden`.
 *
 * Known scenario slugs get their own glyph; anything else — a scenario an admin
 * added after this bundle shipped — gets the generic speech bubble.
 */
import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const stroke = {
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function Svg({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" aria-hidden focusable="false" {...props}>
      {children}
    </svg>
  );
}

/** В аптеке — a capsule. */
function PillGlyph(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="8.5" width="17" height="7" rx="3.5" transform="rotate(-45 12 12)" {...stroke} />
      <path d="m9.5 9.5 5 5" {...stroke} />
    </Svg>
  );
}

/** Собеседование — a briefcase. */
function BriefcaseGlyph(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="7.5" width="17" height="12" rx="2" {...stroke} />
      <path d="M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5M3.5 12.5h17" {...stroke} />
    </Svg>
  );
}

/** У врача — a stethoscope. */
function StethoscopeGlyph(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 4v5a4 4 0 0 0 8 0V4" {...stroke} />
      <path d="M10 13v2.5a4.5 4.5 0 0 0 9 0V13" {...stroke} />
      <circle cx="19" cy="11" r="2" {...stroke} />
    </Svg>
  );
}

/** В такси — a car. */
function CarGlyph(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 16.5v-4l1.8-4.6A1.5 1.5 0 0 1 8.2 7h7.6a1.5 1.5 0 0 1 1.4.9L19 12.5v4" {...stroke} />
      <rect x="3.5" y="12.5" width="17" height="4.5" rx="1.5" {...stroke} />
      <path d="M6.5 17v1.5M17.5 17v1.5M5 12.5h14" {...stroke} />
    </Svg>
  );
}

/** Any other scenario, and Erkin mavzu — a speech bubble. */
function ChatGlyph(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-7l-4 3v-3H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5z"
        {...stroke}
      />
      <path d="M8 10h8M8 13h5" {...stroke} />
    </Svg>
  );
}

const GLYPHS: Record<string, (props: IconProps) => ReactNode> = {
  pharmacy: PillGlyph,
  interview: BriefcaseGlyph,
  doctor: StethoscopeGlyph,
  taxi: CarGlyph,
};

export function ScenarioIcon({ id, size = 24 }: { id: string; size?: number }) {
  const Glyph = GLYPHS[id] ?? ChatGlyph;
  return <Glyph width={size} height={size} />;
}
