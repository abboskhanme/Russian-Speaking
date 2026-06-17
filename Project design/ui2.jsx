/* ============================================================
   GOVORI — UI v2 shared components
   Mascot, Confetti, RadarChart, Sparkline, Skeleton, SegTabs, AttemptDots
   ============================================================ */

/* ---------------- Mascot ----------------
   Simple geometric character (rounded shapes only). */
function Mascot({ size = 96, mood = 'happy', float = true }) {
  const moods = {
    happy:     { mouth: 'M40 62 Q50 72 60 62', brow: false, cheek: true },
    celebrate: { mouth: 'M38 60 Q50 76 62 60 Q50 70 38 60', brow: false, cheek: true },
    thinking:  { mouth: 'M44 66 Q50 62 56 66', brow: true, cheek: false },
    proud:     { mouth: 'M41 63 Q50 70 59 63', brow: false, cheek: true },
    sleepy:    { mouth: 'M44 65 Q50 68 56 65', brow: false, cheek: false },
  };
  const m = moods[mood] || moods.happy;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={float ? 'floaty' : ''} style={{ overflow: 'visible' }} aria-hidden="true">
      {/* shadow */}
      <ellipse cx="50" cy="93" rx="26" ry="5" fill="oklch(0.5 0.05 60 / 0.12)" />
      {/* little feet */}
      <ellipse cx="40" cy="86" rx="7" ry="5" fill="oklch(0.58 0.18 42)" />
      <ellipse cx="60" cy="86" rx="7" ry="5" fill="oklch(0.58 0.18 42)" />
      {/* body */}
      <rect x="20" y="26" width="60" height="58" rx="26" fill="oklch(0.72 0.17 52)" />
      <rect x="20" y="26" width="60" height="58" rx="26" fill="url(#mg)" />
      <defs>
        <linearGradient id="mg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="oklch(0.78 0.15 58)" stopOpacity="0.9" />
          <stop offset="100%" stopColor="oklch(0.66 0.19 40)" stopOpacity="0.5" />
        </linearGradient>
      </defs>
      {/* antenna */}
      <line x1="50" y1="26" x2="50" y2="14" stroke="oklch(0.62 0.18 42)" strokeWidth="3" strokeLinecap="round" />
      <circle cx="50" cy="11" r="4.5" fill="oklch(0.82 0.14 80)" />
      {/* eyes */}
      <g style={{ transformOrigin: '40px 48px', animation: 'blink 5s infinite' }}>
        <ellipse cx="40" cy="48" rx="8" ry="9" fill="#fff" />
        <circle cx="41" cy="49" r="3.6" fill="oklch(0.3 0.04 50)" />
        <circle cx="42.6" cy="47.4" r="1.2" fill="#fff" />
      </g>
      <g style={{ transformOrigin: '60px 48px', animation: 'blink 5s infinite' }}>
        <ellipse cx="60" cy="48" rx="8" ry="9" fill="#fff" />
        <circle cx="59" cy="49" r="3.6" fill="oklch(0.3 0.04 50)" />
        <circle cx="60.6" cy="47.4" r="1.2" fill="#fff" />
      </g>
      {m.brow && <line x1="34" y1="38" x2="44" y2="40" stroke="oklch(0.4 0.06 50)" strokeWidth="2.4" strokeLinecap="round" />}
      {m.cheek && <><circle cx="30" cy="60" r="4" fill="oklch(0.8 0.12 30 / 0.5)" /><circle cx="70" cy="60" r="4" fill="oklch(0.8 0.12 30 / 0.5)" /></>}
      {/* mouth */}
      <path d={m.mouth} fill="none" stroke="oklch(0.32 0.05 45)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ---------------- Confetti ---------------- */
function Confetti({ count = 90, duration = 2800 }) {
  const [on, setOn] = useState(true);
  useEffect(() => { const t = setTimeout(() => setOn(false), duration); return () => clearTimeout(t); }, []);
  if (!on) return null;
  const colors = ['oklch(0.72 0.18 52)', 'oklch(0.82 0.14 80)', 'oklch(0.69 0.14 152)', 'oklch(0.64 0.12 248)', 'oklch(0.6 0.15 305)'];
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 999, overflow: 'hidden' }} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => {
        const left = Math.random() * 100;
        const delay = Math.random() * 0.5;
        const dur = 1.8 + Math.random() * 1.4;
        const c = colors[i % colors.length];
        const sz = 6 + Math.random() * 7;
        const round = Math.random() > 0.5;
        return (
          <span key={i} style={{
            position: 'absolute', top: 0, left: `${left}%`, width: sz, height: round ? sz : sz * 0.5,
            background: c, borderRadius: round ? '50%' : 2,
            animation: `confettiFall ${dur}s cubic-bezier(.3,.4,.6,1) ${delay}s forwards`,
          }} />
        );
      })}
    </div>
  );
}

/* ---------------- Radar chart (4 axes) ---------------- */
function RadarChart({ data, size = 240, max = 9 }) {
  const cx = size / 2, cy = size / 2, r = size * 0.36;
  const n = data.length;
  const angle = i => (Math.PI * 2 * i) / n - Math.PI / 2;
  const pt = (i, val) => [cx + Math.cos(angle(i)) * r * (val / max), cy + Math.sin(angle(i)) * r * (val / max)];
  const poly = data.map((d, i) => pt(i, d.score).join(',')).join(' ');
  const rings = [3, 5, 7, 9];
  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: '100%', height: 'auto', maxWidth: size, overflow: 'visible' }}>
      {rings.map(g => (
        <polygon key={g} points={data.map((_, i) => pt(i, g).join(',')).join(' ')} fill="none" stroke="var(--line)" strokeWidth="1" />
      ))}
      {data.map((_, i) => {
        const [x, y] = pt(i, max);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--line)" strokeWidth="1" />;
      })}
      <polygon points={poly} fill="oklch(0.7 0.17 50 / 0.18)" stroke="oklch(0.68 0.18 47)" strokeWidth="2.4" strokeLinejoin="round" />
      {data.map((d, i) => { const [x, y] = pt(i, d.score); return <circle key={i} cx={x} cy={y} r="4" fill="var(--surface)" stroke="oklch(0.68 0.18 47)" strokeWidth="2.4" />; })}
      {data.map((d, i) => {
        const [x, y] = pt(i, max + 0.9);
        return <text key={i} x={x} y={y} textAnchor={Math.abs(x - cx) < 6 ? 'middle' : x > cx ? 'start' : 'end'} dominantBaseline="middle" fontSize="11.5" fontWeight="700" fill="var(--ink-soft)" fontFamily="var(--font-display)">{d.short}</text>;
      })}
    </svg>
  );
}

/* ---------------- Sparkline ---------------- */
function Sparkline({ data, w = 130, h = 40, hue = 47, fill = true }) {
  const min = Math.min(...data) - 0.3, max = Math.max(...data) + 0.3;
  const x = i => (i / (data.length - 1)) * w;
  const y = v => h - ((v - min) / (max - min || 1)) * h;
  const line = data.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
  const area = line + ` L${w} ${h} L0 ${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: w, height: h, overflow: 'visible' }}>
      {fill && <path d={area} fill={`oklch(0.7 0.16 ${hue} / 0.14)`} />}
      <path d={line} fill="none" stroke={`oklch(0.68 0.18 ${hue})`} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(data.length - 1)} cy={y(data[data.length - 1])} r="3.2" fill={`oklch(0.68 0.18 ${hue})`} />
    </svg>
  );
}

/* ---------------- Attempt dots (free attempts) ---------------- */
function AttemptDots({ used, total }) {
  return (
    <div className="row gap-1" aria-label={`${total - used} ta urinish qoldi`}>
      {Array.from({ length: total }).map((_, i) => (
        <span key={i} style={{ width: 9, height: 9, borderRadius: '50%', background: i < total - used ? 'var(--primary)' : 'var(--line-2)' }} />
      ))}
    </div>
  );
}

/* ---------------- Segmented tabs ---------------- */
function SegTabs({ tabs, value, onChange, full }) {
  return (
    <div className="row gap-1" style={{ background: 'var(--surface-2)', borderRadius: 'var(--r-pill)', padding: 4, width: full ? '100%' : 'auto' }}>
      {tabs.map(t => {
        const active = value === t.id;
        return (
          <button key={t.id} onClick={() => onChange(t.id)} className="tap" style={{
            flex: full ? 1 : 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            padding: '9px 16px', borderRadius: 'var(--r-pill)', border: 'none', fontSize: 14, fontWeight: 800, fontFamily: 'var(--font-display)',
            background: active ? 'var(--surface)' : 'transparent', color: active ? 'var(--primary-press)' : 'var(--muted)',
            boxShadow: active ? 'var(--sh-sm)' : 'none', whiteSpace: 'nowrap', transition: 'all .15s',
          }}>{t.icon && <Icon name={t.icon} size={16} />}{t.label}{t.badge != null && <span style={{ background: active ? 'var(--primary)' : 'var(--line-2)', color: active ? '#fff' : 'var(--muted)', borderRadius: 999, fontSize: 11, padding: '1px 7px', fontWeight: 800 }}>{t.badge}</span>}</button>
        );
      })}
    </div>
  );
}

/* ---------------- Skeleton block ---------------- */
function Skeleton({ w = '100%', h = 16, r, style }) {
  return <div className="skel" style={{ width: w, height: h, borderRadius: r || 'var(--r-xs)', ...style }} />;
}

Object.assign(window, { Mascot, Confetti, RadarChart, Sparkline, AttemptDots, SegTabs, Skeleton });
