/* ============================================================
   GOVORI — Auth v2 (cozy, mascot, Google + role select)
   ============================================================ */

function Auth({ onLogin }) {
  const roles = [
    { id: 'student', uz: "Oʻquvchi", icon: 'grad', hue: 47 },
    { id: 'teacher', uz: "Oʻqituvchi", icon: 'headphones', hue: 152 },
    { id: 'admin', uz: 'Administrator', icon: 'settings', hue: 248 },
  ];
  const [sel, setSel] = useState('student');
  const [mode, setMode] = useState('login');

  return (
    <div style={{ height: '100vh', display: 'flex', overflow: 'hidden' }}>
      {/* Brand panel */}
      <div className="auth-brand" style={{ width: '44%', flexShrink: 0, position: 'relative', overflow: 'hidden', background: 'linear-gradient(160deg, oklch(0.73 0.16 58), oklch(0.6 0.19 35))', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 46, color: '#fff' }}>
        <div style={{ position: 'absolute', width: 460, height: 460, borderRadius: '50%', background: 'oklch(1 0 0 / 0.08)', top: -120, right: -120 }} />
        <div style={{ position: 'absolute', width: 300, height: 300, borderRadius: '50%', background: 'oklch(1 0 0 / 0.06)', bottom: -80, left: -60 }} />
        <Logo size={40} light />
        <div style={{ position: 'relative', zIndex: 2 }}>
          <div style={{ marginBottom: 18 }}><Mascot size={120} mood="happy" /></div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'oklch(1 0 0 / 0.18)', padding: '7px 14px', borderRadius: 999, fontSize: 13, fontWeight: 800, marginBottom: 18 }}><Icon name="sparkles" size={15} /> IELTS-uslubidagi metodika</div>
          <h1 style={{ fontSize: 'clamp(28px, 3.2vw, 42px)', color: '#fff', lineHeight: 1.1, letterSpacing: '-0.02em' }}>Rus tilida<br />qoʻrqmasdan gapir</h1>
          <p style={{ fontSize: 16.5, opacity: 0.92, marginTop: 16, maxWidth: 380, lineHeight: 1.5 }}>Gapir, AI baholasin, har kuni oʻs. Xato qilsang ham mayli — qayta urinish cheksiz.</p>
          <div className="row gap-5" style={{ marginTop: 30 }}>
            {[['1,284', "oʻquvchi"], ['52K+', 'javob'], ['+1.4', "oʻrtacha oʻsish"]].map((s, i) => (
              <div key={i} className="col"><span style={{ fontSize: 26, fontWeight: 900, fontFamily: 'var(--font-display)' }}>{s[0]}</span><span style={{ fontSize: 12.5, opacity: 0.85 }}>{s[1]}</span></div>
            ))}
          </div>
        </div>
        <div style={{ position: 'relative', zIndex: 2, fontSize: 13, opacity: 0.75 }}>© 2026 Govori — demo prototip</div>
      </div>

      {/* Form */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32, overflowY: 'auto' }}>
        <div style={{ width: '100%', maxWidth: 410 }} className="anim-fade-up">
          <div className="auth-brand-mobile" style={{ marginBottom: 22 }}><Logo size={38} /></div>
          <div className="row gap-2" style={{ background: 'var(--surface-2)', borderRadius: 'var(--r-pill)', padding: 4, marginBottom: 22 }}>
            {[['login', 'Kirish'], ['register', 'Roʻyxatdan oʻtish']].map(m => (
              <button key={m[0]} onClick={() => setMode(m[0])} className="tap" style={{ flex: 1, padding: '9px', borderRadius: 'var(--r-pill)', border: 'none', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 14, background: mode === m[0] ? 'var(--surface)' : 'transparent', color: mode === m[0] ? 'var(--primary-press)' : 'var(--muted)', boxShadow: mode === m[0] ? 'var(--sh-sm)' : 'none' }}>{m[1]}</button>
            ))}
          </div>

          <h2 style={{ fontSize: 25 }}>{mode === 'login' ? 'Xush kelibsiz! 👋' : 'Hisob yarating'}</h2>
          <p style={{ color: 'var(--muted)', marginTop: 5, marginBottom: 20, fontSize: 14.5 }}>Davom etish uchun maʼlumotlaringizni kiriting</p>

          <button className="tap" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '13px', borderRadius: 'var(--r-md)', border: '1.5px solid var(--line-2)', background: 'var(--surface)', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15, color: 'var(--ink)', cursor: 'pointer', marginBottom: 16 }}>
            <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.1-11.3-7.6l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.3 5.3C41.4 36.3 44 30.7 44 24c0-1.3-.1-2.3-.4-3.5z"/></svg>
            Google bilan kirish
          </button>

          <div className="row gap-3" style={{ margin: '6px 0 16px' }}><div style={{ flex: 1, height: 1, background: 'var(--line)' }} /><span style={{ fontSize: 12.5, color: 'var(--faint)' }}>yoki</span><div style={{ flex: 1, height: 1, background: 'var(--line)' }} /></div>

          <div className="col gap-3" style={{ marginBottom: 18 }}>
            {mode === 'register' && <AuthInput icon="user" placeholder="Ismingiz" />}
            <AuthInput icon="message" placeholder="Email" type="email" />
            <AuthInput icon="lock" placeholder="Parol" type="password" />
          </div>

          <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Demo: rol tanlang</span>
          <div className="row gap-2" style={{ margin: '10px 0 20px' }}>
            {roles.map(r => {
              const active = sel === r.id;
              return (
                <button key={r.id} onClick={() => setSel(r.id)} className="tap" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '13px 6px', borderRadius: 'var(--r-md)', cursor: 'pointer', border: active ? `2px solid oklch(0.7 0.16 ${r.hue})` : '2px solid var(--line)', background: active ? `oklch(0.97 0.03 ${r.hue})` : 'var(--surface)' }}>
                  <div style={{ width: 38, height: 38, borderRadius: 11, background: `oklch(0.94 0.06 ${r.hue})`, color: `oklch(0.5 0.16 ${r.hue})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={r.icon} size={20} /></div>
                  <span style={{ fontWeight: 800, fontFamily: 'var(--font-display)', fontSize: 12.5 }}>{r.uz}</span>
                </button>
              );
            })}
          </div>

          <Button full size="lg" iconR="chevR" onClick={() => onLogin(sel)}>{ROLE_LABEL[sel]} sifatida {mode === 'login' ? 'kirish' : 'boshlash'}</Button>
          <p style={{ textAlign: 'center', fontSize: 12.5, color: 'var(--faint)', marginTop: 14 }}>Demo rejimi — parol talab qilinmaydi</p>
        </div>
      </div>
    </div>
  );
}

function AuthInput({ icon, placeholder, type = 'text' }) {
  return (
    <div className="row gap-3" style={{ border: '1.5px solid var(--line-2)', borderRadius: 'var(--r-md)', padding: '12px 15px', background: 'var(--surface-2)' }}>
      <Icon name={icon} size={19} style={{ color: 'var(--muted)' }} />
      <input type={type} placeholder={placeholder} style={{ border: 'none', background: 'transparent', outline: 'none', flex: 1, fontSize: 15, color: 'var(--ink)' }} />
    </div>
  );
}

Object.assign(window, { Auth });
