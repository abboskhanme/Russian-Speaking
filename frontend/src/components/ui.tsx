import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

/* ─── Celebrate ──────────────────────────────────────────────
   A gentle one-shot confetti burst for happy moments (score reveal).
   Pure CSS, auto-removes after the animation; no dependency. */
const CONFETTI = ["🎉", "✨", "⭐", "🎊", "💜", "🌟"];

export function Celebrate({ count = 14 }: { count?: number }) {
  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden" aria-hidden>
      {Array.from({ length: count }).map((_, i) => {
        const left = (i / count) * 100 + (i % 3) * 4;
        const delay = (i % 5) * 0.08;
        const size = 16 + (i % 4) * 6;
        return (
          <span
            key={i}
            className="animate-confetti absolute top-[12%]"
            style={{ left: `${left}%`, animationDelay: `${delay}s`, fontSize: `${size}px` }}
          >
            {CONFETTI[i % CONFETTI.length]}
          </span>
        );
      })}
    </div>
  );
}

/* ─── Button ─────────────────────────────────────────────── */
type Variant = "primary" | "success" | "tinted" | "plain" | "outline" | "destructive";

const variants: Record<Variant, string> = {
  primary:
    "bg-brand text-white shadow-[0_8px_18px_-6px_rgba(124,92,252,0.6)] hover:bg-brand-strong active:scale-[0.98]",
  success:
    "bg-success text-white shadow-[0_8px_18px_-6px_rgba(34,197,94,0.6)] hover:bg-success-strong active:scale-[0.98]",
  tinted: "bg-brand-soft text-brand-deep hover:bg-brand-soft/70 active:scale-[0.98]",
  plain: "text-brand hover:text-brand-strong active:opacity-60",
  outline:
    "border-2 border-ios-separator bg-white text-ink hover:border-brand/40 hover:bg-brand-tint active:scale-[0.98]",
  destructive: "bg-danger-soft text-danger hover:bg-danger-soft/70 active:scale-[0.98]",
};

export function Button({
  variant = "primary",
  full,
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; full?: boolean }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-[16px] font-extrabold transition disabled:pointer-events-none disabled:opacity-40 ${
        variants[variant]
      } ${full ? "w-full" : ""} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

/* ─── Card ───────────────────────────────────────────────── */
export function Card({
  children,
  className = "",
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`rounded-3xl bg-white p-5 shadow-[0_4px_24px_-12px_rgba(27,27,46,0.12)] ${
        onClick ? "cursor-pointer transition hover:-translate-y-0.5 active:scale-[0.99]" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

/* ─── Grouped list ───────────────────────────────────────── */
export function ListGroup({ header, children }: { header?: string; children: ReactNode }) {
  return (
    <div>
      {header && (
        <p className="mb-2 px-4 text-[13px] font-bold uppercase tracking-wide text-ios-secondary">
          {header}
        </p>
      )}
      <div className="divide-y divide-ios-separator overflow-hidden rounded-3xl bg-white shadow-[0_4px_24px_-12px_rgba(27,27,46,0.12)]">
        {children}
      </div>
    </div>
  );
}

export function ListRow({
  children,
  onClick,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-3 px-4 py-3.5 ${
        onClick ? "cursor-pointer transition active:bg-brand-tint" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

/* ─── Segmented control ──────────────────────────────────── */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
}) {
  return (
    <div className="flex gap-1 rounded-2xl bg-brand-soft/60 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-xl px-3 py-2 text-[14px] font-bold transition ${
            value === o.value
              ? "bg-white text-brand-deep shadow-sm"
              : "text-ios-secondary hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ─── Form fields ────────────────────────────────────────── */
export function Field({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <label className="block">
      {label && (
        <span className="mb-1.5 block text-[14px] font-bold text-ios-secondary">{label}</span>
      )}
      {children}
    </label>
  );
}

const inputBase =
  "w-full rounded-2xl border-2 border-ios-separator bg-white px-4 py-3 text-[16px] font-semibold text-ink placeholder:font-normal placeholder:text-ios-tertiary outline-none focus:border-brand transition";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputBase} ${props.className ?? ""}`} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputBase} resize-none ${props.className ?? ""}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputBase} appearance-none ${props.className ?? ""}`} />;
}

/* ─── Spinner ────────────────────────────────────────────── */
export function Spinner({ className = "" }: { className?: string }) {
  return (
    <div
      className={`h-6 w-6 animate-spin rounded-full border-[3px] border-brand/25 border-t-brand ${className}`}
    />
  );
}

/* ─── Badge / Chip ───────────────────────────────────────── */
type Tone = "gray" | "green" | "brand" | "orange" | "red";
const tones: Record<Tone, string> = {
  gray: "bg-ios-separator text-ios-secondary",
  green: "bg-success-soft text-success-strong",
  brand: "bg-brand-soft text-brand-deep",
  orange: "bg-warn-soft text-warn",
  red: "bg-danger-soft text-danger",
};

export function Badge({
  children,
  tone = "gray",
}: {
  children: ReactNode;
  tone?: Tone | "blue";
}) {
  const t = tone === "blue" ? "brand" : tone;
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-extrabold ${tones[t]}`}>
      {children}
    </span>
  );
}

/** A soft rounded pill used for hints / phrases / tags. */
export function Chip({
  children,
  onClick,
  active,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  className?: string;
}) {
  return (
    <span
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full px-3.5 py-1.5 text-[13px] font-bold transition ${
        active ? "bg-brand text-white" : "bg-brand-soft text-brand-deep"
      } ${onClick ? "cursor-pointer hover:brightness-95" : ""} ${className}`}
    >
      {children}
    </span>
  );
}

/* ─── Linear progress bar ────────────────────────────────── */
export function ProgressBar({
  value,
  tone = "brand",
  className = "",
}: {
  value: number; // 0..1
  tone?: "brand" | "green";
  className?: string;
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const fill = tone === "green" ? "bg-success" : "bg-brand";
  return (
    <div className={`h-2.5 overflow-hidden rounded-full bg-ios-separator ${className}`}>
      <div
        className={`h-full rounded-full ${fill} transition-[width] duration-500`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/* ─── Circular progress ring ─────────────────────────────── */
export function Ring({
  value,
  size = 72,
  stroke = 8,
  tone = "brand",
  children,
  className = "",
}: {
  value: number; // 0..1
  size?: number;
  stroke?: number;
  tone?: "brand" | "green" | "red";
  children?: ReactNode;
  className?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value));
  const color =
    tone === "green" ? "var(--color-success)" : tone === "red" ? "var(--color-danger)" : "var(--color-brand)";
  return (
    <div
      className={`relative inline-flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
    >
      <svg className="-rotate-90" width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-ios-separator)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}

/* ─── Streak badge (🔥 12) ───────────────────────────────── */
export function StreakBadge({ days }: { days: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-warn-soft px-2.5 py-1 text-[14px] font-extrabold text-warn">
      <span className="text-[15px] leading-none">🔥</span>
      {days}
    </span>
  );
}

/* ─── Brand logo (speech bubble) ─────────────────────────── */
export function BrandLogo({ size = 36 }: { size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-2xl bg-brand text-white shadow-[0_6px_14px_-4px_rgba(124,92,252,0.7)]"
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 24 24" width={size * 0.58} height={size * 0.58} fill="none">
        <path
          d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v7A2.5 2.5 0 0 1 17.5 15H10l-4 3.5V15H6.5A2.5 2.5 0 0 1 4 12.5v-7Z"
          fill="currentColor"
        />
        <circle cx="9" cy="9" r="1.15" fill="#7c5cfc" />
        <circle cx="12" cy="9" r="1.15" fill="#7c5cfc" />
        <circle cx="15" cy="9" r="1.15" fill="#7c5cfc" />
      </svg>
    </span>
  );
}

/* ─── User avatar (initials) ─────────────────────────────── */
export function Avatar({ name, size = 40 }: { name?: string | null; size?: number }) {
  const initials =
    (name ?? "?")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?";
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand-soft font-extrabold text-brand-deep"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initials}
    </span>
  );
}

/* ─── Friendly mascot (purple blob w/ headphones) ────────── */
export function Mascot({ size = 96 }: { size?: number }) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} aria-hidden>
      <defs>
        <linearGradient id="mascot-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#9b7bff" />
          <stop offset="1" stopColor="#7c5cfc" />
        </linearGradient>
      </defs>
      {/* headphone band */}
      <path d="M30 56a30 30 0 0 1 60 0" fill="none" stroke="#5b2bd6" strokeWidth="6" strokeLinecap="round" />
      {/* body */}
      <path
        d="M30 64c0-16 13-28 30-28s30 12 30 28v10c0 12-13 20-30 20S30 86 30 74V64Z"
        fill="url(#mascot-body)"
      />
      {/* ear cups */}
      <rect x="22" y="56" width="14" height="22" rx="7" fill="#5b2bd6" />
      <rect x="84" y="56" width="14" height="22" rx="7" fill="#5b2bd6" />
      {/* eyes */}
      <circle cx="50" cy="64" r="5.5" fill="#fff" />
      <circle cx="70" cy="64" r="5.5" fill="#fff" />
      <circle cx="51" cy="65" r="2.6" fill="#1b1b2e" />
      <circle cx="71" cy="65" r="2.6" fill="#1b1b2e" />
      {/* smile */}
      <path d="M52 76c3 4 13 4 16 0" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
      {/* cheeks */}
      <circle cx="43" cy="74" r="3" fill="#ff9bbf" opacity="0.7" />
      <circle cx="77" cy="74" r="3" fill="#ff9bbf" opacity="0.7" />
      {/* sparkle */}
      <path d="M96 30l2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5Z" fill="#ffd166" />
    </svg>
  );
}

/* ─── Hot-air-balloon + suitcase travel illustration ─────── */
export function TravelArt({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 150" className={className} aria-hidden>
      {/* mountains */}
      <path d="M70 130 L120 60 L150 95 L170 70 L200 130 Z" fill="#bfe3f5" />
      <path d="M120 60 L132 76 L120 90 L108 76 Z" fill="#e8f5fc" />
      {/* clouds */}
      <ellipse cx="40" cy="55" rx="16" ry="8" fill="#dbeafe" />
      <ellipse cx="160" cy="40" rx="14" ry="7" fill="#dbeafe" />
      {/* balloon */}
      <path d="M120 18c14 0 24 11 24 25 0 12-10 22-24 34-14-12-24-22-24-34 0-14 10-25 24-25Z" fill="#9b7bff" />
      <path d="M120 18c5 0 9 11 9 25s-4 24-9 34c-5-10-9-20-9-34S115 18 120 18Z" fill="#c9b8ff" />
      <rect x="115" y="80" width="10" height="7" rx="2" fill="#a8783c" />
      {/* small pink balloon */}
      <path d="M86 30c7 0 12 6 12 13 0 6-5 11-12 17-7-6-12-11-12-17 0-7 5-13 12-13Z" fill="#ff9bbf" />
      {/* suitcase */}
      <rect x="78" y="100" width="44" height="34" rx="6" fill="#f2b134" />
      <rect x="92" y="92" width="16" height="10" rx="3" fill="none" stroke="#c98a1e" strokeWidth="3" />
      <line x1="90" y1="100" x2="90" y2="134" stroke="#d99a28" strokeWidth="3" />
      <line x1="110" y1="100" x2="110" y2="134" stroke="#d99a28" strokeWidth="3" />
      {/* grass */}
      <ellipse cx="100" cy="138" rx="64" ry="9" fill="#bbe8c8" />
    </svg>
  );
}

/* ─── Stat card (dashboards) ─────────────────────────────── */
export function StatCard({
  icon,
  value,
  label,
  tone = "brand",
}: {
  icon: ReactNode;
  value: ReactNode;
  label: string;
  tone?: "brand" | "green" | "orange" | "red";
}) {
  const bg: Record<string, string> = {
    brand: "bg-brand-soft text-brand-deep",
    green: "bg-success-soft text-success-strong",
    orange: "bg-warn-soft text-warn",
    red: "bg-danger-soft text-danger",
  };
  return (
    <div className="rounded-3xl bg-white p-4 shadow-[0_4px_24px_-12px_rgba(27,27,46,0.12)]">
      <span className={`mb-3 flex h-10 w-10 items-center justify-center rounded-2xl text-[19px] ${bg[tone]}`}>
        {icon}
      </span>
      <p className="text-[26px] font-extrabold leading-none tabular-nums text-ink">{value}</p>
      <p className="mt-1 text-[13px] font-bold text-ios-secondary">{label}</p>
    </div>
  );
}

/* ─── Radar chart (per-criterion scores) ─────────────────── */
export function Radar({
  data,
  max = 9,
  size = 220,
}: {
  data: { label: string; value: number }[];
  max?: number;
  size?: number;
}) {
  const n = data.length;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 34;
  const point = (val: number, i: number, rad = r) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const rr = rad * Math.max(0, Math.min(1, val / max));
    return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)] as const;
  };
  const poly = data.map((d, i) => point(d.value, i).join(",")).join(" ");
  const rings = [0.5, 1];

  return (
    <svg width={size} height={size} className="mx-auto">
      {rings.map((g) => (
        <polygon
          key={g}
          points={data.map((_, i) => point(max, i, r * g).join(",")).join(" ")}
          fill="none"
          stroke="var(--color-ios-separator)"
          strokeWidth="1.5"
        />
      ))}
      {data.map((_, i) => {
        const [x, y] = point(max, i);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--color-ios-separator)" strokeWidth="1" />;
      })}
      <polygon points={poly} fill="rgba(124,92,252,0.22)" stroke="var(--color-brand)" strokeWidth="2.5" strokeLinejoin="round" />
      {data.map((d, i) => {
        const [x, y] = point(d.value, i);
        return <circle key={i} cx={x} cy={y} r="3.5" fill="var(--color-brand)" />;
      })}
      {data.map((d, i) => {
        const [x, y] = point(max * 1.18, i);
        return (
          <text key={i} x={x} y={y} textAnchor="middle" dominantBaseline="middle" className="fill-ios-secondary" style={{ fontSize: 11, fontWeight: 800 }}>
            {d.label}
          </text>
        );
      })}
    </svg>
  );
}

/* ─── Sparkline (trend) ──────────────────────────────────── */
export function Sparkline({
  values,
  max = 9,
  height = 64,
}: {
  values: number[];
  max?: number;
  height?: number;
}) {
  const w = 100;
  if (values.length < 2) return null;
  const stepX = w / (values.length - 1);
  const y = (v: number) => height - (Math.max(0, Math.min(max, v)) / max) * (height - 8) - 4;
  const pts = values.map((v, i) => [i * stepX, y(v)] as const);
  const line = pts.map((p) => p.join(",")).join(" ");
  const area = `0,${height} ${line} ${w},${height}`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="h-16 w-full" style={{ height }}>
      <polygon points={area} fill="rgba(124,92,252,0.12)" />
      <polyline points={line} fill="none" stroke="var(--color-brand)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {pts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r="2.5" fill="var(--color-brand)" vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}

/* ─── Large title ────────────────────────────────────────── */
export function LargeTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-3">
      <h1 className="text-[30px] font-extrabold leading-tight tracking-tight md:text-[34px]">
        {children}
      </h1>
      {right}
    </div>
  );
}
