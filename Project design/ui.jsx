/* ============================================================
   GOVORI — UI primitives, icons, charts, shell
   ============================================================ */
const { useState, useEffect, useRef, useMemo } = React;

/* ---------------- Icons ---------------- */
const PATHS = {
  home: 'M3 11.5 12 4l9 7.5M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM19 3v16M9 7h6M9 11h6',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3M5 11a7 7 0 0 0 14 0M12 18v3',
  chart: 'M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-8',
  trophy: 'M7 4h10v4a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 0-3 3M9 16h6M8 20h8M12 16v4',
  users: 'M16 18v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6M17 18v-1a4 4 0 0 0-3-3.8M15 3.2a3 3 0 0 1 0 5.8',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 13a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.3a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 2.7 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 8 2.6h.1A1.6 1.6 0 0 0 9 1.1V1a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.1a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.3 1z',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16M21 21l-4.3-4.3',
  play: 'M6 4l14 8-14 8z',
  pause: 'M8 5v14M16 5v14',
  check: 'M20 6 9 17l-5-5',
  x: 'M18 6 6 18M6 6l12 12',
  chevR: 'M9 6l6 6-6 6',
  chevL: 'M15 6l-6 6 6 6',
  chevD: 'M6 9l6 6 6-6',
  star: 'M12 3l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 18.4 6.2 21.4l1.1-6.5L2.6 9.8l6.5-.9z',
  flame: 'M12 3s5 4 5 9a5 5 0 0 1-10 0c0-1.5.6-2.8 1.4-3.8C9 9.5 9 11 10 11.5 11 9 12 6 12 3z',
  award: 'M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12M8.2 13.5 7 22l5-3 5 3-1.2-8.5',
  calendar: 'M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7v5l3 2',
  message: 'M21 11.5a8.4 8.4 0 0 1-9 8.3 9 9 0 0 1-3.8-.8L3 20l1-4.2A8.4 8.4 0 1 1 21 11.5z',
  plus: 'M12 5v14M5 12h14',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  headphones: 'M3 14v-2a9 9 0 0 1 18 0v2M21 16a2 2 0 0 1-2 2h-1v-6h1a2 2 0 0 1 2 2zM3 16a2 2 0 0 0 2 2h1v-6H5a2 2 0 0 0-2 2z',
  volume: 'M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4z',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.8 1 1.5 1 2.5h6c0-1 .3-1.7 1-2.5A6 6 0 0 0 12 3z',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2',
  sparkles: 'M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15l-1.8-4.2L5.5 9l4.7-1.3zM19 14l.9 2.3 2.3.9-2.3.9L19 20l-.9-2.3L16 16l2.1-.7z',
  arrowUp: 'M12 19V5M5 12l7-7 7 7',
  arrowDown: 'M12 5v14M5 12l7 7 7-7',
  menu: 'M3 6h18M3 12h18M3 18h18',
  dots: 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2M19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2M5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2',
  filter: 'M3 5h18l-7 8v6l-4-2v-4z',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  grad: 'M22 9 12 4 2 9l10 5 10-5zM6 11v5c0 1 2.7 3 6 3s6-2 6-3v-5M22 9v5',
  layers: 'M12 3 2 8l10 5 10-5zM2 14l10 5 10-5M2 11l10 5 10-5',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z',
  refresh: 'M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5',
  trash: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14',
  user: 'M20 21v-2a5 5 0 0 0-5-5H9a5 5 0 0 0-5 5v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  lock: 'M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1M8 11V7a4 4 0 0 1 8 0v4',
  flag: 'M4 21V4M4 4s2-1 5-1 4 2 7 2 4-1 4-1v10s-1 1-4 1-4-2-7-2-5 1-5 1',
  speak: 'M21 11.5a8.4 8.4 0 0 1-9 8.3 9 9 0 0 1-3.8-.8L3 20l1-4.2A8.4 8.4 0 1 1 21 11.5zM9 10h6M9 13h4',
};
function Icon({ name, size = 20, sw = 1.9, fill = false, style, className }) {
  const d = PATHS[name] || '';
  const filled = fill || ['play', 'star', 'flame'].includes(name) && fill;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'}
      stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
      style={style} className={className} aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/* ---------------- Avatar ---------------- */
function Avatar({ name, size = 40, ring }) {
  const [bg, fg] = avaColor(name || '?');
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: bg, color: fg,
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: size * 0.38,
      boxShadow: ring ? `0 0 0 3px var(--surface), 0 0 0 5px ${fg}` : 'none',
    }}>{initials(name || '?')}</div>
  );
}

/* ---------------- Button ---------------- */
function Button({ children, variant = 'primary', size = 'md', icon, iconR, full, onClick, style, disabled }) {
  const sizes = {
    sm: { padding: '7px 13px', fontSize: 13.5, gap: 6 },
    md: { padding: '11px 18px', fontSize: 15, gap: 8 },
    lg: { padding: '15px 26px', fontSize: 17, gap: 10 },
  };
  const variants = {
    primary: { background: 'var(--primary)', color: '#fff', boxShadow: 'var(--sh-primary)', border: '1px solid transparent' },
    soft: { background: 'var(--primary-tint)', color: 'var(--primary-press)', border: '1px solid transparent' },
    ghost: { background: 'transparent', color: 'var(--ink-soft)', border: '1px solid var(--line-2)' },
    dark: { background: 'var(--ink)', color: 'var(--bg)', border: '1px solid transparent' },
    success: { background: 'var(--success)', color: '#fff', border: '1px solid transparent' },
  };
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled} style={{
      ...sizes[size], ...variants[variant],
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      gap: sizes[size].gap, borderRadius: 'var(--r-pill)', fontFamily: 'var(--font-display)',
      fontWeight: 600, width: full ? '100%' : 'auto', whiteSpace: 'nowrap',
      opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer',
      transition: 'transform .12s, filter .15s, box-shadow .2s', ...style,
    }}
      onMouseDown={e => !disabled && (e.currentTarget.style.transform = 'scale(0.96)')}
      onMouseUp={e => (e.currentTarget.style.transform = '')}
      onMouseLeave={e => (e.currentTarget.style.transform = '')}>
      {icon && <Icon name={icon} size={sizes[size].fontSize + 3} />}
      {children}
      {iconR && <Icon name={iconR} size={sizes[size].fontSize + 2} />}
    </button>
  );
}

/* ---------------- Card ---------------- */
function Card({ children, style, pad = 22, onClick, hover }) {
  const [h, setH] = useState(false);
  return (
    <div onClick={onClick}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        background: 'var(--surface)', borderRadius: 'var(--r-lg)', padding: pad,
        border: '1px solid var(--line)', boxShadow: h && hover ? 'var(--sh-lg)' : 'var(--sh-sm)',
        transition: 'box-shadow .2s, transform .2s',
        transform: h && hover ? 'translateY(-3px)' : 'none',
        cursor: onClick ? 'pointer' : 'default', ...style,
      }}>{children}</div>
  );
}

/* ---------------- Badge / Pill ---------------- */
function Pill({ children, hue = 47, solid, icon, size = 'md' }) {
  const bg = solid ? `oklch(0.7 0.16 ${hue})` : `oklch(0.95 0.05 ${hue})`;
  const fg = solid ? '#fff' : `oklch(0.45 0.15 ${hue})`;
  const s = size === 'sm' ? { fontSize: 11.5, padding: '3px 9px' } : { fontSize: 13, padding: '5px 12px' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, background: bg, color: fg,
      borderRadius: 'var(--r-pill)', fontWeight: 700, fontFamily: 'var(--font-display)', ...s,
    }}>{icon && <Icon name={icon} size={s.fontSize + 2} sw={2.3} />}{children}</span>
  );
}

/* ---------------- Progress bar ---------------- */
function Bar({ value, hue = 47, height = 9, track = 'var(--surface-3)' }) {
  return (
    <div style={{ background: track, borderRadius: 999, height, width: '100%', overflow: 'hidden' }}>
      <div style={{
        width: `${Math.min(100, value)}%`, height: '100%', borderRadius: 999,
        background: `linear-gradient(90deg, oklch(0.74 0.15 ${hue}), oklch(0.68 0.18 ${hue}))`,
        transition: 'width .6s cubic-bezier(.2,.7,.3,1)',
      }} />
    </div>
  );
}

/* ---------------- Ring (circular progress) ---------------- */
function Ring({ value, size = 64, sw = 7, hue = 47, children }) {
  const r = (size - sw) / 2, c = 2 * Math.PI * r;
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={sw} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`oklch(0.7 0.17 ${hue})`}
          strokeWidth={sw} strokeLinecap="round" strokeDasharray={c}
          strokeDashoffset={c - (value / 100) * c} style={{ transition: 'stroke-dashoffset .8s cubic-bezier(.2,.7,.3,1)' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{children}</div>
    </div>
  );
}

/* ---------------- Line chart ---------------- */
function LineChart({ data, w = 520, h = 160, hue = 47, min = 4, max = 9 }) {
  const pad = { l: 30, r: 12, t: 14, b: 24 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const x = i => pad.l + (i / (data.length - 1)) * iw;
  const y = v => pad.t + ih - ((v - min) / (max - min)) * ih;
  const pts = data.map((d, i) => [x(i), y(d.band)]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ' ' + p[1]).join(' ');
  const area = line + ` L${x(data.length - 1)} ${pad.t + ih} L${pad.l} ${pad.t + ih} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto' }}>
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={`oklch(0.7 0.17 ${hue})`} stopOpacity="0.22" />
          <stop offset="100%" stopColor={`oklch(0.7 0.17 ${hue})`} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[5, 6, 7, 8].map(g => (
        <g key={g}>
          <line x1={pad.l} y1={y(g)} x2={w - pad.r} y2={y(g)} stroke="var(--line)" strokeWidth="1" />
          <text x={pad.l - 8} y={y(g) + 3.5} textAnchor="end" fontSize="10.5" fill="var(--faint)" fontFamily="var(--font-body)">{g}.0</text>
        </g>
      ))}
      <path d={area} fill="url(#lg)" />
      <path d={line} fill="none" stroke={`oklch(0.68 0.18 ${hue})`} strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r={i === pts.length - 1 ? 4.5 : 3} fill="var(--surface)" stroke={`oklch(0.68 0.18 ${hue})`} strokeWidth="2.4" />
      ))}
      {data.map((d, i) => (
        <text key={i} x={x(i)} y={h - 7} textAnchor="middle" fontSize="10" fill="var(--faint)" fontFamily="var(--font-body)">{d.w}</text>
      ))}
    </svg>
  );
}

/* ---------------- Bar chart ---------------- */
function BarChart({ data, valueKey = 'v', labelKey = 'm', w = 520, h = 160, hue = 47, unit = '' }) {
  const pad = { l: 10, r: 10, t: 16, b: 26 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const max = Math.max(...data.map(d => d[valueKey])) * 1.1;
  const bw = iw / data.length * 0.56;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto' }}>
      {data.map((d, i) => {
        const bh = (d[valueKey] / max) * ih;
        const cx = pad.l + (i + 0.5) * (iw / data.length);
        const dh = d[valueKey];
        return (
          <g key={i}>
            <rect x={cx - bw / 2} y={pad.t + ih - bh} width={bw} height={Math.max(bh, 2)} rx={6}
              fill={`oklch(${0.62 + (dh / max) * 0.12} 0.16 ${d.hue || hue})`} />
            <text x={cx} y={pad.t + ih - bh - 6} textAnchor="middle" fontSize="10.5" fontWeight="700" fill="var(--ink-soft)" fontFamily="var(--font-display)">{dh}{unit}</text>
            <text x={cx} y={h - 8} textAnchor="middle" fontSize="10.5" fill="var(--faint)" fontFamily="var(--font-body)">{d[labelKey]}</text>
          </g>
        );
      })}
    </svg>
  );
}

/* ---------------- Section header ---------------- */
function SectionTitle({ children, action }) {
  return (
    <div className="row between" style={{ marginBottom: 14 }}>
      <h3 style={{ fontSize: 19 }}>{children}</h3>
      {action}
    </div>
  );
}

/* ---------------- Empty / placeholder image ---------------- */
function ImgSlot({ label, h = 140, hue = 47 }) {
  return (
    <div style={{
      height: h, borderRadius: 'var(--r-md)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: `repeating-linear-gradient(135deg, oklch(0.95 0.03 ${hue}), oklch(0.95 0.03 ${hue}) 9px, oklch(0.97 0.02 ${hue}) 9px, oklch(0.97 0.02 ${hue}) 18px)`,
      border: '1px dashed var(--line-2)', color: 'var(--muted)', fontFamily: "'Spline Sans Mono', monospace", fontSize: 12,
    }}>{label}</div>
  );
}

Object.assign(window, {
  Icon, Avatar, Button, Card, Pill, Bar, Ring, LineChart, BarChart, SectionTitle, ImgSlot,
  useState, useEffect, useRef, useMemo,
});
