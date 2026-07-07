/* ============================================================
   GOVORI — design-system UI primitives (TypeScript port)
   Icons, Avatar, Button, Card, Pill, charts, Mascot, etc.
   Visuals match the "Project design" prototype 1:1.
   ============================================================ */
import {
  useState,
  useEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useI18n } from "../lib/i18n";

/* ---------------- Helpers ---------------- */
export function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const ss = Math.round(s) % 60;
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

/** Hue for a 0–100 score (green→amber→orange→red). */
export function bandColor(b: number): number {
  return b >= 78 ? 152 : b >= 67 ? 80 : b >= 56 ? 47 : 28;
}

const AVA_COLORS: [string, string][] = [
  ["oklch(0.92 0.06 62)", "oklch(0.45 0.16 47)"],
  ["oklch(0.92 0.05 152)", "oklch(0.42 0.13 152)"],
  ["oklch(0.92 0.05 248)", "oklch(0.45 0.13 248)"],
  ["oklch(0.93 0.05 305)", "oklch(0.46 0.14 305)"],
  ["oklch(0.94 0.06 85)", "oklch(0.48 0.13 70)"],
  ["oklch(0.92 0.05 28)", "oklch(0.5 0.16 28)"],
];
function avaColor(seed: string): [string, string] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 9973;
  return AVA_COLORS[h % AVA_COLORS.length];
}
function initials(name: string): string {
  const p = (name || "?").trim().split(/\s+/);
  return ((p[0]?.[0] ?? "?") + (p[1] ? p[1][0] : "")).toUpperCase();
}

/* ---------------- Icons ---------------- */
export const PATHS: Record<string, string> = {
  home: "M3 11.5 12 4l9 7.5M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9",
  book: "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM19 3v16M9 7h6M9 11h6",
  mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3M5 11a7 7 0 0 0 14 0M12 18v3",
  chart: "M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-8",
  trophy:
    "M7 4h10v4a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 0-3 3M9 16h6M8 20h8M12 16v4",
  users:
    "M16 18v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6M17 18v-1a4 4 0 0 0-3-3.8M15 3.2a3 3 0 0 1 0 5.8",
  settings:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 13a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.3a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 2.7 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 8 2.6h.1A1.6 1.6 0 0 0 9 1.1V1a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.1a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.3 1z",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  bell: "M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16M21 21l-4.3-4.3",
  play: "M6 4l14 8-14 8z",
  pause: "M8 5v14M16 5v14",
  check: "M20 6 9 17l-5-5",
  x: "M18 6 6 18M6 6l12 12",
  chevR: "M9 6l6 6-6 6",
  chevL: "M15 6l-6 6 6 6",
  chevD: "M6 9l6 6 6-6",
  star: "M12 3l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 18.4 6.2 21.4l1.1-6.5L2.6 9.8l6.5-.9z",
  flame: "M12 3s5 4 5 9a5 5 0 0 1-10 0c0-1.5.6-2.8 1.4-3.8C9 9.5 9 11 10 11.5 11 9 12 6 12 3z",
  award: "M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12M8.2 13.5 7 22l5-3 5 3-1.2-8.5",
  calendar: "M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7v5l3 2",
  message: "M21 11.5a8.4 8.4 0 0 1-9 8.3 9 9 0 0 1-3.8-.8L3 20l1-4.2A8.4 8.4 0 1 1 21 11.5z",
  plus: "M12 5v14M5 12h14",
  edit: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
  headphones:
    "M3 14v-2a9 9 0 0 1 18 0v2M21 16a2 2 0 0 1-2 2h-1v-6h1a2 2 0 0 1 2 2zM3 16a2 2 0 0 0 2 2h1v-6H5a2 2 0 0 0-2 2z",
  volume: "M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14",
  send: "M22 2 11 13M22 2l-7 20-4-9-9-4z",
  bulb: "M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.8 1 1.5 1 2.5h6c0-1 .3-1.7 1-2.5A6 6 0 0 0 12 3z",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2",
  sparkles: "M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15l-1.8-4.2L5.5 9l4.7-1.3zM19 14l.9 2.3 2.3.9-2.3.9L19 20l-.9-2.3L16 16l2.1-.7z",
  arrowUp: "M12 19V5M5 12l7-7 7 7",
  arrowDown: "M12 5v14M5 12l7 7 7-7",
  menu: "M3 6h18M3 12h18M3 18h18",
  dots: "M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2M19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2M5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2",
  filter: "M3 5h18l-7 8v6l-4-2v-4z",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
  eyeOff: "M10.7 5.1A11 11 0 0 1 12 5c6 0 10 7 10 7a13 13 0 0 1-1.7 2.7M6.6 6.6A13 13 0 0 0 2 12s4 7 10 7a11 11 0 0 0 5.4-1.4M3 3l18 18M9.9 9.9a3 3 0 0 0 4.2 4.2",
  grad: "M22 9 12 4 2 9l10 5 10-5zM6 11v5c0 1 2.7 3 6 3s6-2 6-3v-5M22 9v5",
  layers: "M12 3 2 8l10 5 10-5zM2 14l10 5 10-5M2 11l10 5 10-5",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z",
  refresh: "M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5",
  trash: "M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14",
  user: "M20 21v-2a5 5 0 0 0-5-5H9a5 5 0 0 0-5 5v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
  lock: "M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1M8 11V7a4 4 0 0 1 8 0v4",
  flag: "M4 21V4M4 4s2-1 5-1 4 2 7 2 4-1 4-1v10s-1 1-4 1-4-2-7-2-5 1-5 1",
  speak: "M21 11.5a8.4 8.4 0 0 1-9 8.3 9 9 0 0 1-3.8-.8L3 20l1-4.2A8.4 8.4 0 1 1 21 11.5zM9 10h6M9 13h4",
  upload: "M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M12 15V3M7 8l5-5 5 5",
  image: "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 16l5-5 4 4 3-3 6 6M9 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3",
  phone: "M16 2H8a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zM11 19h2",
  copy: "M9 9h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2M5 15a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2",
  link: "M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1",
};

export type IconName = keyof typeof PATHS | string;

export function Icon({
  name,
  size = 20,
  sw = 1.9,
  fill = false,
  style,
  className,
}: {
  name: IconName;
  size?: number;
  sw?: number;
  fill?: boolean;
  style?: CSSProperties;
  className?: string;
}) {
  const d = PATHS[name] || "";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      className={className}
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

/* ---------------- Avatar ---------------- */
export function Avatar({
  name,
  size = 40,
  ring,
  src,
}: {
  name?: string | null;
  size?: number;
  ring?: boolean;
  src?: string | null;
}) {
  const [bg, fg] = avaColor(name || "?");
  const ringShadow = ring ? `0 0 0 3px var(--surface), 0 0 0 5px ${fg}` : "none";
  if (src)
    return (
      <img
        src={src}
        alt={name || ""}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          objectFit: "cover",
          flexShrink: 0,
          background: bg,
          boxShadow: ringShadow,
        }}
      />
    );
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: bg,
        color: fg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        fontFamily: "var(--font-display)",
        fontWeight: 700,
        fontSize: size * 0.38,
        boxShadow: ringShadow,
      }}
    >
      {initials(name || "?")}
    </div>
  );
}

/* ---------------- Button ---------------- */
export type GovVariant = "primary" | "soft" | "ghost" | "dark" | "success";
export type GovSize = "sm" | "md" | "lg";

export function Button({
  children,
  variant = "primary",
  size = "md",
  icon,
  iconR,
  full,
  onClick,
  style,
  disabled,
  type = "button",
  title,
}: {
  children?: ReactNode;
  variant?: GovVariant;
  size?: GovSize;
  icon?: IconName;
  iconR?: IconName;
  full?: boolean;
  onClick?: () => void;
  style?: CSSProperties;
  disabled?: boolean;
  type?: "button" | "submit";
  title?: string;
}) {
  const sizes: Record<GovSize, { padding: string; fontSize: number; gap: number }> = {
    sm: { padding: "7px 13px", fontSize: 13.5, gap: 6 },
    md: { padding: "11px 18px", fontSize: 15, gap: 8 },
    lg: { padding: "15px 26px", fontSize: 17, gap: 10 },
  };
  const variants: Record<GovVariant, CSSProperties> = {
    primary: { background: "var(--primary)", color: "#fff", boxShadow: "var(--sh-primary)", border: "1px solid transparent" },
    soft: { background: "var(--primary-tint)", color: "var(--primary-press)", border: "1px solid transparent" },
    ghost: { background: "transparent", color: "var(--ink-soft)", border: "1px solid var(--line-2)" },
    dark: { background: "var(--ink)", color: "var(--bg)", border: "1px solid transparent" },
    success: { background: "var(--success)", color: "#fff", border: "1px solid transparent" },
  };
  const s = sizes[size];
  return (
    <button
      type={type}
      title={title}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        padding: s.padding,
        fontSize: s.fontSize,
        ...variants[variant],
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: s.gap,
        borderRadius: "var(--r-pill)",
        fontFamily: "var(--font-display)",
        fontWeight: 800,
        width: full ? "100%" : "auto",
        whiteSpace: "nowrap",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "transform .12s, filter .15s, box-shadow .2s",
        ...style,
      }}
      onMouseDown={(e) => !disabled && (e.currentTarget.style.transform = "scale(0.96)")}
      onMouseUp={(e) => (e.currentTarget.style.transform = "")}
      onMouseLeave={(e) => (e.currentTarget.style.transform = "")}
    >
      {icon && <Icon name={icon} size={s.fontSize + 3} />}
      {children}
      {iconR && <Icon name={iconR} size={s.fontSize + 2} />}
    </button>
  );
}

/* ---------------- Card ---------------- */
export function Card({
  children,
  style,
  pad = 22,
  onClick,
  hover,
  className,
}: {
  children: ReactNode;
  style?: CSSProperties;
  pad?: number;
  onClick?: () => void;
  hover?: boolean;
  className?: string;
}) {
  const [h, setH] = useState(false);
  return (
    <div
      onClick={onClick}
      className={className}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        background: "var(--surface)",
        borderRadius: "var(--r-lg)",
        padding: pad,
        border: "1px solid var(--line)",
        boxShadow: h && hover ? "var(--sh-lg)" : "var(--sh-sm)",
        transition: "box-shadow .2s, transform .2s",
        transform: h && hover ? "translateY(-3px)" : "none",
        cursor: onClick ? "pointer" : "default",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* ---------------- Pill ---------------- */
export function Pill({
  children,
  hue = 47,
  solid,
  icon,
  size = "md",
}: {
  children: ReactNode;
  hue?: number;
  solid?: boolean;
  icon?: IconName;
  size?: "sm" | "md";
}) {
  const bg = solid ? `oklch(0.7 0.16 ${hue})` : `oklch(0.95 0.05 ${hue})`;
  const fg = solid ? "#fff" : `oklch(0.45 0.15 ${hue})`;
  const s = size === "sm" ? { fontSize: 11.5, padding: "3px 9px" } : { fontSize: 13, padding: "5px 12px" };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        background: bg,
        color: fg,
        borderRadius: "var(--r-pill)",
        fontWeight: 700,
        fontFamily: "var(--font-display)",
        ...s,
      }}
    >
      {icon && <Icon name={icon} size={s.fontSize + 2} sw={2.3} />}
      {children}
    </span>
  );
}

/* ---------------- Progress bar ---------------- */
export function Bar({
  value,
  hue = 47,
  height = 9,
  track = "var(--surface-3)",
}: {
  value: number;
  hue?: number;
  height?: number;
  track?: string;
}) {
  return (
    <div style={{ background: track, borderRadius: 999, height, width: "100%", overflow: "hidden" }}>
      <div
        style={{
          width: `${Math.min(100, Math.max(0, value))}%`,
          height: "100%",
          borderRadius: 999,
          background: `linear-gradient(90deg, oklch(0.74 0.15 ${hue}), oklch(0.68 0.18 ${hue}))`,
          transition: "width .6s cubic-bezier(.2,.7,.3,1)",
        }}
      />
    </div>
  );
}

/* ---------------- Ring (circular progress) ---------------- */
export function Ring({
  value,
  size = 64,
  sw = 7,
  hue = 47,
  children,
}: {
  value: number;
  size?: number;
  sw?: number;
  hue?: number;
  children?: ReactNode;
}) {
  const r = (size - sw) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={sw} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`oklch(0.7 0.17 ${hue})`}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (Math.min(100, Math.max(0, value)) / 100) * c}
          style={{ transition: "stroke-dashoffset .8s cubic-bezier(.2,.7,.3,1)" }}
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {children}
      </div>
    </div>
  );
}

/* ---------------- Line chart ---------------- */
export function LineChart({
  data,
  w = 520,
  h = 160,
  hue = 47,
  min = 0,
  max = 100,
}: {
  data: { w: string; band: number }[];
  w?: number;
  h?: number;
  hue?: number;
  min?: number;
  max?: number;
}) {
  if (data.length < 2) return null;
  const pad = { l: 30, r: 12, t: 14, b: 24 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const x = (i: number) => pad.l + (i / (data.length - 1)) * iw;
  const y = (v: number) => pad.t + ih - ((v - min) / (max - min)) * ih;
  const pts = data.map((d, i) => [x(i), y(d.band)] as const);
  const line = pts.map((p, i) => (i ? "L" : "M") + p[0] + " " + p[1]).join(" ");
  const area = line + ` L${x(data.length - 1)} ${pad.t + ih} L${pad.l} ${pad.t + ih} Z`;
  const gid = `lg-${hue}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "auto" }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={`oklch(0.7 0.17 ${hue})`} stopOpacity="0.22" />
          <stop offset="100%" stopColor={`oklch(0.7 0.17 ${hue})`} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[20, 40, 60, 80, 100].map((g) => (
        <g key={g}>
          <line x1={pad.l} y1={y(g)} x2={w - pad.r} y2={y(g)} stroke="var(--line)" strokeWidth="1" />
          <text x={pad.l - 8} y={y(g) + 3.5} textAnchor="end" fontSize="10.5" fill="var(--faint)">
            {g}
          </text>
        </g>
      ))}
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={`oklch(0.68 0.18 ${hue})`} strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r={i === pts.length - 1 ? 4.5 : 3} fill="var(--surface)" stroke={`oklch(0.68 0.18 ${hue})`} strokeWidth="2.4" />
      ))}
      {data.map((d, i) => (
        <text key={i} x={x(i)} y={h - 7} textAnchor="middle" fontSize="10" fill="var(--faint)">
          {d.w}
        </text>
      ))}
    </svg>
  );
}

/* ---------------- Bar chart ---------------- */
export function BarChart({
  data,
  valueKey = "v",
  labelKey = "m",
  w = 520,
  h = 160,
  hue = 47,
  unit = "",
}: {
  data: Record<string, string | number>[];
  valueKey?: string;
  labelKey?: string;
  w?: number;
  h?: number;
  hue?: number;
  unit?: string;
}) {
  const pad = { l: 10, r: 10, t: 16, b: 26 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const max = Math.max(...data.map((d) => Number(d[valueKey]))) * 1.1 || 1;
  const bw = (iw / data.length) * 0.56;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "auto" }}>
      {data.map((d, i) => {
        const dh = Number(d[valueKey]);
        const bh = (dh / max) * ih;
        const cx = pad.l + (i + 0.5) * (iw / data.length);
        const barHue = Number(d.hue) || hue;
        return (
          <g key={i}>
            <rect x={cx - bw / 2} y={pad.t + ih - bh} width={bw} height={Math.max(bh, 2)} rx={6} fill={`oklch(${0.62 + (dh / max) * 0.12} 0.16 ${barHue})`} />
            <text x={cx} y={pad.t + ih - bh - 6} textAnchor="middle" fontSize="10.5" fontWeight="700" fill="var(--ink-soft)">
              {dh}
              {unit}
            </text>
            <text x={cx} y={h - 8} textAnchor="middle" fontSize="10.5" fill="var(--faint)">
              {d[labelKey]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ---------------- Radar chart (n axes) ---------------- */
export function RadarChart({
  data,
  size = 240,
  max = 100,
}: {
  data: { short: string; score: number }[];
  size?: number;
  max?: number;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.36;
  const n = data.length;
  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const pt = (i: number, val: number): [number, number] => [
    cx + Math.cos(angle(i)) * r * (val / max),
    cy + Math.sin(angle(i)) * r * (val / max),
  ];
  const poly = data.map((d, i) => pt(i, d.score).join(",")).join(" ");
  const rings = [20, 40, 60, 80, 100];
  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: "100%", height: "auto", maxWidth: size, overflow: "visible" }}>
      {rings.map((g) => (
        <polygon key={g} points={data.map((_, i) => pt(i, g).join(",")).join(" ")} fill="none" stroke="var(--line)" strokeWidth="1" />
      ))}
      {data.map((_, i) => {
        const [x, y] = pt(i, max);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--line)" strokeWidth="1" />;
      })}
      <polygon points={poly} fill="oklch(0.7 0.17 50 / 0.18)" stroke="oklch(0.68 0.18 47)" strokeWidth="2.4" strokeLinejoin="round" />
      {data.map((d, i) => {
        const [x, y] = pt(i, d.score);
        return <circle key={i} cx={x} cy={y} r="4" fill="var(--surface)" stroke="oklch(0.68 0.18 47)" strokeWidth="2.4" />;
      })}
      {data.map((d, i) => {
        const [x, y] = pt(i, max + 10);
        return (
          <text key={i} x={x} y={y} textAnchor={Math.abs(x - cx) < 6 ? "middle" : x > cx ? "start" : "end"} dominantBaseline="middle" fontSize="11.5" fontWeight="700" fill="var(--ink-soft)">
            {d.short}
          </text>
        );
      })}
    </svg>
  );
}

/* ---------------- Sparkline ---------------- */
export function Sparkline({
  data,
  w = 130,
  h = 40,
  hue = 47,
  fill = true,
}: {
  data: number[];
  w?: number;
  h?: number;
  hue?: number;
  fill?: boolean;
}) {
  if (data.length < 2) return null;
  const min = Math.min(...data) - 0.3;
  const max = Math.max(...data) + 0.3;
  const x = (i: number) => (i / (data.length - 1)) * w;
  const y = (v: number) => h - ((v - min) / (max - min || 1)) * h;
  const line = data.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)).join(" ");
  const area = line + ` L${w} ${h} L0 ${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: w, height: h, overflow: "visible" }}>
      {fill && <path d={area} fill={`oklch(0.7 0.16 ${hue} / 0.14)`} />}
      <path d={line} fill="none" stroke={`oklch(0.68 0.18 ${hue})`} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(data.length - 1)} cy={y(data[data.length - 1])} r="3.2" fill={`oklch(0.68 0.18 ${hue})`} />
    </svg>
  );
}

/* ---------------- Section header ---------------- */
export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="row between" style={{ marginBottom: 14 }}>
      <h3 style={{ fontSize: 19 }}>{children}</h3>
      {action}
    </div>
  );
}

/* ---------------- Image placeholder slot ---------------- */
export function ImgSlot({ label, h = 140, hue = 47 }: { label: string; h?: number; hue?: number }) {
  return (
    <div
      style={{
        height: h,
        borderRadius: "var(--r-md)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: `repeating-linear-gradient(135deg, oklch(0.95 0.03 ${hue}), oklch(0.95 0.03 ${hue}) 9px, oklch(0.97 0.02 ${hue}) 9px, oklch(0.97 0.02 ${hue}) 18px)`,
        border: "1px dashed var(--line-2)",
        color: "var(--muted)",
        fontFamily: "'Spline Sans Mono', monospace",
        fontSize: 12,
      }}
    >
      {label}
    </div>
  );
}

/* ---------------- Mascot ---------------- */
export type Mood = "happy" | "celebrate" | "thinking" | "proud" | "sleepy";
export function Mascot({ size = 96, mood = "happy", float = true }: { size?: number; mood?: Mood; float?: boolean }) {
  const moods: Record<Mood, { mouth: string; brow: boolean; cheek: boolean }> = {
    happy: { mouth: "M40 62 Q50 72 60 62", brow: false, cheek: true },
    celebrate: { mouth: "M38 60 Q50 76 62 60 Q50 70 38 60", brow: false, cheek: true },
    thinking: { mouth: "M44 66 Q50 62 56 66", brow: true, cheek: false },
    proud: { mouth: "M41 63 Q50 70 59 63", brow: false, cheek: true },
    sleepy: { mouth: "M44 65 Q50 68 56 65", brow: false, cheek: false },
  };
  const m = moods[mood] || moods.happy;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={float ? "floaty" : ""} style={{ overflow: "visible" }} aria-hidden="true">
      <ellipse cx="50" cy="93" rx="26" ry="5" fill="oklch(0.5 0.05 60 / 0.12)" />
      <ellipse cx="40" cy="86" rx="7" ry="5" fill="oklch(0.58 0.18 42)" />
      <ellipse cx="60" cy="86" rx="7" ry="5" fill="oklch(0.58 0.18 42)" />
      <rect x="20" y="26" width="60" height="58" rx="26" fill="oklch(0.72 0.17 52)" />
      <rect x="20" y="26" width="60" height="58" rx="26" fill="url(#mg)" />
      <defs>
        <linearGradient id="mg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="oklch(0.78 0.15 58)" stopOpacity="0.9" />
          <stop offset="100%" stopColor="oklch(0.66 0.19 40)" stopOpacity="0.5" />
        </linearGradient>
      </defs>
      <line x1="50" y1="26" x2="50" y2="14" stroke="oklch(0.62 0.18 42)" strokeWidth="3" strokeLinecap="round" />
      <circle cx="50" cy="11" r="4.5" fill="oklch(0.82 0.14 80)" />
      <g style={{ transformOrigin: "40px 48px", animation: "blink 5s infinite" }}>
        <ellipse cx="40" cy="48" rx="8" ry="9" fill="#fff" />
        <circle cx="41" cy="49" r="3.6" fill="oklch(0.3 0.04 50)" />
        <circle cx="42.6" cy="47.4" r="1.2" fill="#fff" />
      </g>
      <g style={{ transformOrigin: "60px 48px", animation: "blink 5s infinite" }}>
        <ellipse cx="60" cy="48" rx="8" ry="9" fill="#fff" />
        <circle cx="59" cy="49" r="3.6" fill="oklch(0.3 0.04 50)" />
        <circle cx="60.6" cy="47.4" r="1.2" fill="#fff" />
      </g>
      {m.brow && <line x1="34" y1="38" x2="44" y2="40" stroke="oklch(0.4 0.06 50)" strokeWidth="2.4" strokeLinecap="round" />}
      {m.cheek && (
        <>
          <circle cx="30" cy="60" r="4" fill="oklch(0.8 0.12 30 / 0.5)" />
          <circle cx="70" cy="60" r="4" fill="oklch(0.8 0.12 30 / 0.5)" />
        </>
      )}
      <path d={m.mouth} fill="none" stroke="oklch(0.32 0.05 45)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ---------------- Confetti ---------------- */
export function Confetti({ count = 90, duration = 2800 }: { count?: number; duration?: number }) {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setOn(false), duration);
    return () => clearTimeout(t);
  }, [duration]);
  if (!on) return null;
  const colors = [
    "oklch(0.72 0.18 52)",
    "oklch(0.82 0.14 80)",
    "oklch(0.69 0.14 152)",
    "oklch(0.64 0.12 248)",
    "oklch(0.6 0.15 305)",
  ];
  return (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 999, overflow: "hidden" }} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => {
        const left = ((i * 37) % 100) + (i % 5);
        const delay = (i % 7) * 0.07;
        const dur = 1.8 + (i % 5) * 0.28;
        const c = colors[i % colors.length];
        const sz = 6 + (i % 6);
        const round = i % 2 === 0;
        return (
          <span
            key={i}
            style={{
              position: "absolute",
              top: 0,
              left: `${left}%`,
              width: sz,
              height: round ? sz : sz * 0.5,
              background: c,
              borderRadius: round ? "50%" : 2,
              animation: `confettiFall ${dur}s cubic-bezier(.3,.4,.6,1) ${delay}s forwards`,
            }}
          />
        );
      })}
    </div>
  );
}

/* ---------------- Attempt dots (free attempts) ---------------- */
export function AttemptDots({ used, total }: { used: number; total: number }) {
  return (
    <div className="row gap-1" aria-label={`${total - used} attempts left`}>
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          style={{
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: i < total - used ? "var(--primary)" : "var(--line-2)",
          }}
        />
      ))}
    </div>
  );
}

/* ---------------- Segmented tabs ---------------- */
export interface SegTab {
  id: string;
  label: ReactNode;
  icon?: IconName;
  badge?: number | null;
}
export function SegTabs({
  tabs,
  value,
  onChange,
  full,
}: {
  tabs: SegTab[];
  value: string;
  onChange: (id: string) => void;
  full?: boolean;
}) {
  return (
    <div className="row gap-1" style={{ background: "var(--surface-2)", borderRadius: "var(--r-pill)", padding: 4, width: full ? "100%" : "auto" }}>
      {tabs.map((t) => {
        const active = value === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className="tap"
            style={{
              flex: full ? 1 : "none",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
              padding: "9px 16px",
              borderRadius: "var(--r-pill)",
              border: "none",
              fontSize: 14,
              fontWeight: 800,
              fontFamily: "var(--font-display)",
              background: active ? "var(--surface)" : "transparent",
              color: active ? "var(--primary-press)" : "var(--muted)",
              boxShadow: active ? "var(--sh-sm)" : "none",
              whiteSpace: "nowrap",
              transition: "all .15s",
            }}
          >
            {t.icon && <Icon name={t.icon} size={16} />}
            {t.label}
            {t.badge != null && (
              <span
                style={{
                  background: active ? "var(--primary)" : "var(--line-2)",
                  color: active ? "#fff" : "var(--muted)",
                  borderRadius: 999,
                  fontSize: 11,
                  padding: "1px 7px",
                  fontWeight: 800,
                }}
              >
                {t.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- Skeleton ---------------- */
export function Skeleton({ w = "100%", h = 16, r, style }: { w?: number | string; h?: number; r?: string; style?: CSSProperties }) {
  return <div className="skel" style={{ width: w, height: h, borderRadius: r || "var(--r-xs)", ...style }} />;
}

/* ---------------- Form field + input style ---------------- */
export const inp: CSSProperties = {
  width: "100%",
  border: "1px solid var(--line-2)",
  borderRadius: "var(--r-sm)",
  padding: "11px 13px",
  fontSize: 14.5,
  outline: "none",
  color: "var(--ink)",
  background: "var(--surface-2)",
  resize: "vertical",
  fontFamily: "inherit",
};

export function Field({
  label,
  children,
  as,
}: {
  label: ReactNode;
  children: ReactNode;
  // Defaults to <label> so clicking the caption focuses the input. Pass "div"
  // for children that aren't native form controls (e.g. a contentEditable rich
  // editor) — otherwise the <label> forwards clicks to its first real control
  // (a toolbar <select>), stealing focus and making the surface unclickable.
  as?: "label" | "div";
}) {
  const Wrap = as ?? "label";
  return (
    <Wrap className="col gap-2">
      <span style={{ fontSize: 13, fontWeight: 800, color: "var(--ink-soft)" }}>{label}</span>
      {children}
    </Wrap>
  );
}

/* ---------------- Toggle ---------------- */
export function Toggle({ on, set }: { on: boolean; set: (v: boolean) => void }) {
  return (
    <button
      onClick={() => set(!on)}
      className="tap"
      style={{
        width: 46,
        height: 26,
        borderRadius: 999,
        border: "none",
        cursor: "pointer",
        position: "relative",
        flexShrink: 0,
        background: on ? "var(--success)" : "var(--line-2)",
        transition: "background .2s",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: on ? 23 : 3,
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: "#fff",
          transition: "left .2s",
          boxShadow: "var(--sh-sm)",
        }}
      />
    </button>
  );
}

/* ---------------- Brand logo ---------------- */
export function Logo({ size = 34, showText = true, light }: { size?: number; showText?: boolean; light?: boolean }) {
  return (
    <div className="row gap-3" style={{ alignItems: "center" }}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: size * 0.34,
          flexShrink: 0,
          background: "linear-gradient(140deg, oklch(0.76 0.16 56), oklch(0.65 0.19 38))",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 4px 12px oklch(0.66 0.19 40 / 0.4)",
        }}
      >
        <Icon name="speak" size={size * 0.56} sw={2.3} style={{ color: "#fff" }} />
      </div>
      {showText && (
        <div className="col">
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: size * 0.5, color: light ? "#fff" : "var(--ink)", lineHeight: 1, letterSpacing: "-0.02em" }}>Govori</span>
          <span style={{ fontSize: size * 0.26, color: light ? "oklch(1 0 0 / 0.7)" : "var(--muted)", fontWeight: 700, marginTop: 2 }}>Рус тили speaking</span>
        </div>
      )}
    </div>
  );
}

/* ---------------- Recording waveform (decorative) ---------------- */
export function Waveform({ active, bars = 44 }: { active: boolean; bars?: number }) {
  return (
    <div className="row" style={{ gap: 3, height: 60, alignItems: "center", justifyContent: "center" }}>
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          style={{
            width: 4,
            borderRadius: 999,
            background: active ? "var(--primary)" : "var(--line-2)",
            height: active ? `${18 + Math.abs(Math.sin(i * 0.9)) * 38}px` : "6px",
            transformOrigin: "center",
            transition: "background .3s",
            animation: active ? `bars ${0.5 + (i % 5) * 0.12}s ease-in-out ${i * 0.03}s infinite` : "none",
          }}
        />
      ))}
    </div>
  );
}

/* ---------------- Per-word pronunciation transcript ---------------- */
export type PronTone = "good" | "mid" | "low" | "neutral";
export interface PhonemeSeg {
  ph: string;
  pron?: PronTone;
  note?: string;
}
export interface WordSeg {
  w: string;
  pron?: PronTone;
  issue?: "grammar" | "filler";
  note?: string;
  // Per-sound (letter) breakdown; shown under words that weren't pronounced well.
  phonemes?: PhonemeSeg[];
}
const PRON_MAP = {
  good: { bg: "var(--pron-good-bg)", fg: "var(--pron-good)" },
  mid: { bg: "var(--pron-mid-bg)", fg: "var(--pron-mid)" },
  low: { bg: "var(--pron-low-bg)", fg: "var(--pron-low)" },
  // Word the recognizer didn't score — plain text, NOT green (so green only ever
  // means genuinely good pronunciation).
  neutral: { bg: "transparent", fg: "var(--ink)" },
};
export function WordTranscript({ words }: { words: WordSeg[] }) {
  return (
    <p style={{ fontSize: 19, lineHeight: 2.2, color: "var(--ink)" }}>
      {words.map((seg, i) => {
        const tone = seg.pron || "neutral";
        const c = PRON_MAP[tone];
        const underline = seg.issue ? `underline wavy ${seg.issue === "grammar" ? "var(--danger)" : "var(--grape)"}` : "none";
        // Show the accuracy % inline on the words that aren't green, so it's clear
        // WHY they're coloured (works on touch — no hover needed).
        const showPct = seg.note && (tone === "mid" || tone === "low");
        // Letter-by-letter breakdown for words that weren't pronounced well, so the
        // learner sees exactly which sounds to fix — only the off ones, to stay tidy.
        const badPhonemes = (tone === "mid" || tone === "low") && seg.phonemes
          ? seg.phonemes.filter((p) => p.pron === "mid" || p.pron === "low")
          : [];
        return (
          <span
            key={i}
            style={{
              display: "inline-flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 3,
              margin: "0 1.5px",
              verticalAlign: "top",
            }}
          >
            <span
              title={seg.note || ""}
              style={{
                background: c.bg,
                color: c.fg,
                borderRadius: 6,
                padding: "2px 5px",
                textDecoration: underline,
                textUnderlineOffset: 3,
                fontWeight: 700,
              }}
            >
              {seg.w}
              {showPct && (
                <span style={{ fontSize: 11, fontWeight: 800, marginLeft: 3, opacity: 0.75 }}>
                  {seg.note}
                </span>
              )}
            </span>
            {badPhonemes.length > 0 && (
              <span className="row" style={{ gap: 2, flexWrap: "wrap", justifyContent: "center" }}>
                {badPhonemes.map((p, j) => (
                  <span
                    key={j}
                    title={p.note || ""}
                    style={{
                      background: PRON_MAP[p.pron || "neutral"].bg,
                      color: PRON_MAP[p.pron || "neutral"].fg,
                      borderRadius: 4,
                      padding: "0 3px",
                      fontSize: 11,
                      fontWeight: 800,
                      lineHeight: 1.5,
                    }}
                  >
                    {p.ph}
                  </span>
                ))}
              </span>
            )}
          </span>
        );
      })}
    </p>
  );
}

/* ---------------- Shared chrome styles ---------------- */
export const iconBtn: CSSProperties = {
  width: 42,
  height: 42,
  borderRadius: "50%",
  border: "none",
  background: "transparent",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--ink-soft)",
  cursor: "pointer",
  position: "relative",
  transition: "background .15s",
};

/* Page wrapper with the standard fade-in. */
export function Page({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="focus-wrap anim-fade-up" style={style}>
      {children}
    </div>
  );
}

/* Page header (title + subtitle + optional action). */
export function PageHead({
  title,
  sub,
  action,
}: {
  title: ReactNode;
  sub?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="row between wrap gap-4" style={{ marginBottom: 20 }}>
      <div className="col gap-1">
        <h2 style={{ fontSize: 26 }}>{title}</h2>
        {sub && <p style={{ color: "var(--muted)", fontSize: 15, margin: 0 }}>{sub}</p>}
      </div>
      {action}
    </div>
  );
}

/* Centered loading spinner (Govori orange). */
export function Loading({ full }: { full?: boolean }) {
  return (
    <div className="row center" style={{ width: "100%", height: full ? "60vh" : 220 }}>
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: "50%",
          border: "3.5px solid var(--surface-3)",
          borderTopColor: "var(--primary)",
          animation: "spin 0.8s linear infinite",
        }}
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/* Resilient <img> for task media served over flaky/slow mobile connections.
   While the bytes are still arriving it shows a spinner instead of the browser's
   half-drawn "tiny pixel". If a load errors (network drop) it silently retries a
   couple of times with a short backoff; only after `maxAttempts` failures does it
   surface a "couldn't load — slow internet" message with a manual retry button. */
export function MediaImage({
  src,
  alt = "",
  style,
  containerStyle,
  maxAttempts = 3,
}: {
  src: string | null | undefined;
  alt?: string;
  style?: CSSProperties;
  containerStyle?: CSSProperties;
  maxAttempts?: number;
}) {
  const { t } = useI18n();
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const timer = useRef<number | null>(null);

  // Restart the load cycle whenever the source changes.
  useEffect(() => {
    setAttempt(0);
    setStatus(src ? "loading" : "error");
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [src]);

  function retry() {
    if (timer.current) clearTimeout(timer.current);
    setStatus("loading");
    // Bumping `attempt` remounts the <img> (via key) so the browser re-requests
    // instead of reusing the failed response.
    setAttempt((a) => a + 1);
  }

  function handleError() {
    // attempt is 0-based; attempt+1 is how many tries we've made so far.
    if (attempt + 1 < maxAttempts) {
      timer.current = window.setTimeout(retry, 800 * (attempt + 1));
    } else {
      setStatus("error");
    }
  }

  if (!src) return null;

  const minH = 150;

  if (status === "error") {
    return (
      <div
        className="col center gap-3"
        style={{
          minHeight: minH,
          padding: 20,
          textAlign: "center",
          borderRadius: "var(--r-md)",
          background: "var(--surface-2)",
          border: "1px dashed var(--line-2)",
          ...containerStyle,
        }}
      >
        <div
          style={{
            width: 46, height: 46, borderRadius: "50%",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "var(--surface-3)", color: "var(--muted)",
          }}
        >
          <Icon name="image" size={24} />
        </div>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--muted)", maxWidth: 260 }}>
          {t("imageLoadFailed")}
        </span>
        <Button variant="soft" size="sm" icon="refresh" onClick={retry}>
          {t("imageRetry")}
        </Button>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", ...containerStyle }}>
      {status === "loading" && (
        <div
          className="row center"
          style={{
            minHeight: minH, width: "100%",
            borderRadius: "var(--r-md)", background: "var(--surface-2)",
          }}
        >
          <div
            style={{
              width: 34, height: 34, borderRadius: "50%",
              border: "3.5px solid var(--surface-3)", borderTopColor: "var(--primary)",
              animation: "spin 0.8s linear infinite",
            }}
          />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}
      <img
        key={attempt}
        src={src}
        alt={alt}
        onLoad={() => setStatus("loaded")}
        onError={handleError}
        style={{ ...style, display: status === "loaded" ? style?.display ?? "block" : "none" }}
      />
    </div>
  );
}

/* Empty-state block with mascot. */
export function EmptyState({ text, mood = "sleepy" }: { text: string; mood?: Mood }) {
  return (
    <Card style={{ textAlign: "center", padding: 40 }}>
      <Mascot size={84} mood={mood} float={false} />
      <p style={{ color: "var(--muted)", fontSize: 15, marginTop: 8 }}>{text}</p>
    </Card>
  );
}
