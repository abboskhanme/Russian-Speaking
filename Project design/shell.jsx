/* ============================================================
   GOVORI — App shell v2
   full-width · 3-tab student + bottom nav · teacher/admin sidebar
   ============================================================ */

const LangCtx = React.createContext({ lang: 'uz', t: k => k, setLang: () => {} });
function useT() { return React.useContext(LangCtx); }

function Logo({ size = 34, showText = true, light }) {
  return (
    <div className="row gap-3" style={{ alignItems: 'center' }}>
      <div style={{
        width: size, height: size, borderRadius: size * 0.34, flexShrink: 0,
        background: 'linear-gradient(140deg, oklch(0.76 0.16 56), oklch(0.65 0.19 38))',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 4px 12px oklch(0.66 0.19 40 / 0.4)',
      }}>
        <Icon name="speak" size={size * 0.56} sw={2.3} style={{ color: '#fff' }} />
      </div>
      {showText && (
        <div className="col">
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: size * 0.5, color: light ? '#fff' : 'var(--ink)', lineHeight: 1, letterSpacing: '-0.02em' }}>Govori</span>
          <span style={{ fontSize: size * 0.26, color: light ? 'oklch(1 0 0 / 0.7)' : 'var(--muted)', fontWeight: 700, marginTop: 2 }}>Рус тили speaking</span>
        </div>
      )}
    </div>
  );
}

const NAV = {
  student: [
    { id: 'home', key: 'home', icon: 'home' },
    { id: 'practice', key: 'practice', icon: 'mic' },
    { id: 'progress', key: 'progress', icon: 'chart' },
  ],
  teacher: [
    { id: 'overview', key: 'overview', icon: 'home' },
    { id: 'assignments', key: 'assignments', icon: 'book' },
    { id: 'groups', key: 'groups', icon: 'users' },
    { id: 'answers', key: 'answers', icon: 'headphones', badge: 3 },
    { id: 'gradebook', key: 'gradebook', icon: 'grad' },
  ],
  admin: [
    { id: 'dashboard', key: 'dashboard', icon: 'home' },
    { id: 'students', key: 'students', icon: 'users' },
    { id: 'teachers', key: 'teachers', icon: 'grad' },
    { id: 'tests', key: 'tests', icon: 'layers' },
  ],
};
const ROLE_LABEL = { student: "Oʻquvchi", teacher: "Oʻqituvchi", admin: 'Administrator' };

function LangSwitcher() {
  const { lang, setLang } = useT();
  const [open, setOpen] = useState(false);
  const langs = [['uz', "Oʻz"], ['ru', 'Ру'], ['en', 'En']];
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(!open)} className="tap" style={{ ...iconBtn, width: 'auto', padding: '0 12px', gap: 6, fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 14 }}>
        <Icon name="globe" size={18} /><span className="hide-sm">{langs.find(l => l[0] === lang)[1]}</span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 60 }} />
          <div className="anim-fade-up" style={{ position: 'absolute', right: 0, top: 48, background: 'var(--surface)', borderRadius: 'var(--r-md)', boxShadow: 'var(--sh-lg)', border: '1px solid var(--line)', padding: 6, zIndex: 70, minWidth: 130 }}>
            {[['uz', "Oʻzbekcha"], ['ru', 'Русский'], ['en', 'English']].map(l => (
              <button key={l[0]} onClick={() => { setLang(l[0]); setOpen(false); }} className="tap" style={{
                display: 'flex', width: '100%', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 'var(--r-sm)', border: 'none',
                background: lang === l[0] ? 'var(--primary-tint)' : 'transparent', color: lang === l[0] ? 'var(--primary-press)' : 'var(--ink-soft)',
                fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, textAlign: 'left',
              }}>{l[1]}{lang === l[0] && <Icon name="check" size={15} sw={3} style={{ marginLeft: 'auto' }} />}</button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Sidebar({ role, screen, go, mobileOpen, setMobileOpen, onSwitch }) {
  const { t } = useT();
  const items = NAV[role];
  return (
    <>
      {mobileOpen && <div onClick={() => setMobileOpen(false)} style={{ position: 'fixed', inset: 0, background: 'oklch(0.3 0.02 60 / 0.4)', zIndex: 40 }} className="mobile-only" />}
      <aside className={`sidebar ${mobileOpen ? 'open' : ''}`} style={{
        width: 250, flexShrink: 0, background: 'var(--surface)', borderRight: '1px solid var(--line)',
        display: 'flex', flexDirection: 'column', padding: '20px 16px', zIndex: 50,
      }}>
        <div style={{ padding: '4px 8px 22px' }}><Logo /></div>
        <nav className="col gap-1" style={{ flex: 1 }}>
          {items.map(it => {
            const active = screen === it.id;
            return (
              <button key={it.id} onClick={() => { go(it.id); setMobileOpen(false); }} className="tap" style={{
                display: 'flex', alignItems: 'center', gap: 13, padding: '12px 14px', borderRadius: 'var(--r-sm)', border: 'none',
                background: active ? 'var(--primary-tint)' : 'transparent', color: active ? 'var(--primary-press)' : 'var(--ink-soft)',
                textAlign: 'left', fontFamily: 'var(--font-display)', fontWeight: active ? 800 : 700, fontSize: 15.5, transition: 'background .15s, color .15s',
              }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--surface-2)'; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
                <Icon name={it.icon} size={21} sw={active ? 2.3 : 2} />
                <span className="grow">{t(it.key)}</span>
                {it.badge && <span style={{ background: 'var(--danger)', color: '#fff', fontSize: 11, fontWeight: 800, borderRadius: 999, minWidth: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px' }}>{it.badge}</span>}
              </button>
            );
          })}
        </nav>

        {role === 'student' && (
          <div style={{ background: 'var(--surface-2)', borderRadius: 'var(--r-md)', padding: 14, marginBottom: 12, position: 'relative', overflow: 'hidden' }}>
            <div className="row gap-3" style={{ alignItems: 'center' }}>
              <Mascot size={46} float={false} mood="happy" />
              <div className="col">
                <span style={{ fontWeight: 800, fontFamily: 'var(--font-display)', fontSize: 14 }}>Davom et! 🔥</span>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{STUDENT.streak} kunlik seriya</span>
              </div>
            </div>
          </div>
        )}

        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '0.07em', padding: '0 6px 8px' }}>Demo: rolni almashtir</div>
          <div className="row gap-1" style={{ background: 'var(--surface-2)', borderRadius: 'var(--r-pill)', padding: 4 }}>
            {['student', 'teacher', 'admin'].map(r => (
              <button key={r} onClick={() => onSwitch(r)} className="tap" style={{
                flex: 1, padding: '7px 4px', borderRadius: 'var(--r-pill)', border: 'none', fontSize: 12, fontWeight: 800, fontFamily: 'var(--font-display)',
                background: role === r ? 'var(--surface)' : 'transparent', color: role === r ? 'var(--primary-press)' : 'var(--muted)', boxShadow: role === r ? 'var(--sh-sm)' : 'none',
              }}>{r === 'student' ? 'Stu' : r === 'teacher' ? "Oʻqit" : 'Admin'}</button>
            ))}
          </div>
        </div>
      </aside>
    </>
  );
}

function Topbar({ user, role, title, onMenu, attempts, go, onLogout }) {
  const { t } = useT();
  const [notif, setNotif] = useState(false);
  const [menu, setMenu] = useState(false);
  return (
    <header style={{ height: 'var(--header-h)', flexShrink: 0, borderBottom: '1px solid var(--line)', background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 14, padding: '0 20px', position: 'relative', zIndex: 30 }}>
      {role !== 'student' && <button className="mobile-only tap" onClick={onMenu} style={iconBtn}><Icon name="menu" size={22} /></button>}
      {role === 'student' && <div className="mobile-only"><Logo size={30} showText={false} /></div>}
      <h2 style={{ fontSize: 20, lineHeight: 1.1, flex: 1, minWidth: 0 }} className={role === 'student' ? 'truncate hide-sm' : 'truncate'}>{title}</h2>

      {role === 'student' && !attempts.premium && (
        <div className="row gap-2 attempts-chip" style={{ background: 'var(--primary-tint)', borderRadius: 'var(--r-pill)', padding: '6px 12px' }}>
          <AttemptDots used={attempts.used} total={attempts.total} />
          <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--primary-press)', fontFamily: 'var(--font-display)' }}>{attempts.total - attempts.used} {t('attemptsLeft')}</span>
        </div>
      )}
      {role === 'student' && attempts.premium && <Pill hue={80} icon="star" solid>{t('premium')}</Pill>}

      <div className="search-box hide-sm" style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'var(--surface-2)', borderRadius: 'var(--r-pill)', padding: '9px 16px', width: 200, color: 'var(--muted)' }}>
        <Icon name="search" size={18} />
        <input placeholder={t('search')} style={{ border: 'none', background: 'transparent', outline: 'none', flex: 1, fontSize: 14, color: 'var(--ink)' }} />
      </div>

      <LangSwitcher />

      <div style={{ position: 'relative' }}>
        <button onClick={() => setNotif(!notif)} className="tap" style={iconBtn}>
          <Icon name="bell" size={21} />
          <span style={{ position: 'absolute', top: 8, right: 9, width: 8, height: 8, borderRadius: '50%', background: 'var(--primary)', border: '2px solid var(--surface)' }} />
        </button>
        {notif && (
          <>
            <div onClick={() => setNotif(false)} style={{ position: 'fixed', inset: 0, zIndex: 55 }} />
            <div className="anim-fade-up" style={{ position: 'absolute', right: 0, top: 50, width: 300, background: 'var(--surface)', borderRadius: 'var(--r-md)', boxShadow: 'var(--sh-lg)', border: '1px solid var(--line)', padding: 8, zIndex: 60 }}>
              {[['Dilnoza opa baho qoʻydi', 'Part 2 — 7.0 ball', 'message', 152], ['Streak muzlatildi ❄️', 'Bugun mashq qilmasangiz ham saqlanadi', 'flame', 248], ['Yangi yutuq: 50 mashq!', 'Tabriklaymiz 🎉', 'award', 80]].map((n, i) => (
                <div key={i} className="row gap-3" style={{ padding: 11, borderRadius: 'var(--r-sm)' }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: `oklch(0.95 0.05 ${n[3]})`, color: `oklch(0.5 0.15 ${n[3]})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={n[2]} size={18} /></div>
                  <div className="col"><span style={{ fontSize: 13.5, fontWeight: 700 }}>{n[0]}</span><span style={{ fontSize: 12, color: 'var(--muted)' }}>{n[1]}</span></div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div style={{ position: 'relative' }}>
        <button onClick={() => setMenu(!menu)} className="tap" style={{ display: 'flex', alignItems: 'center', gap: 10, border: 'none', background: 'transparent', cursor: 'pointer', paddingLeft: 8, borderLeft: '1px solid var(--line)' }}>
          <Avatar name={user.name} size={38} />
          <div className="col user-meta hide-sm" style={{ minWidth: 0, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 14, fontWeight: 800, fontFamily: 'var(--font-display)' }} className="truncate">{user.short}</span>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{ROLE_LABEL[role]}</span>
          </div>
          <Icon name="chevD" size={16} style={{ color: 'var(--faint)' }} className="hide-sm" />
        </button>
        {menu && (
          <>
            <div onClick={() => setMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 55 }} />
            <div className="anim-fade-up" style={{ position: 'absolute', right: 0, top: 52, width: 232, background: 'var(--surface)', borderRadius: 'var(--r-md)', boxShadow: 'var(--sh-lg)', border: '1px solid var(--line)', padding: 8, zIndex: 60 }}>
              <div className="row gap-3" style={{ padding: '8px 10px 12px', borderBottom: '1px solid var(--line)', marginBottom: 6 }}>
                <Avatar name={user.name} size={40} />
                <div className="col" style={{ minWidth: 0 }}><span style={{ fontSize: 14, fontWeight: 800, fontFamily: 'var(--font-display)' }} className="truncate">{user.name}</span><span style={{ fontSize: 12, color: 'var(--muted)' }}>{ROLE_LABEL[role]}</span></div>
              </div>
              {[['profile', 'Profil', 'user'], ['settings', 'Sozlamalar', 'settings'], ['notifications', 'Bildirishnomalar', 'bell']].map(m => (
                <button key={m[0]} onClick={() => { go(m[0]); setMenu(false); }} className="tap" style={menuItem}>
                  <Icon name={m[2]} size={18} />{m[1]}
                </button>
              ))}
              <div style={{ height: 1, background: 'var(--line)', margin: '6px 0' }} />
              <button onClick={() => { onLogout(); setMenu(false); }} className="tap" style={{ ...menuItem, color: 'var(--danger)' }}>
                <Icon name="logout" size={18} />Chiqish
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
const menuItem = { display: 'flex', width: '100%', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 'var(--r-sm)', border: 'none', background: 'transparent', color: 'var(--ink-soft)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14.5, textAlign: 'left', cursor: 'pointer' };

const iconBtn = { width: 42, height: 42, borderRadius: '50%', border: 'none', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-soft)', cursor: 'pointer', position: 'relative', transition: 'background .15s' };

function BottomNav({ screen, go }) {
  const { t } = useT();
  return (
    <nav className="bottom-nav">
      {NAV.student.map(it => {
        const active = screen === it.id || (it.id === 'practice' && ['answer', 'result', 'shadowing', 'review', 'paywall'].includes(screen));
        return (
          <button key={it.id} onClick={() => go(it.id)} className="tap" style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '8px 0', border: 'none', background: 'transparent',
            color: active ? 'var(--primary)' : 'var(--muted)', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 11.5,
          }}>
            <Icon name={it.icon} size={24} sw={active ? 2.4 : 2} fill={false} />
            {t(it.key)}
          </button>
        );
      })}
    </nav>
  );
}

function Shell({ role, screen, go, user, onSwitch, title, attempts, onLogout, children }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--bg)' }}>
      <Sidebar role={role} screen={screen} go={go} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} onSwitch={onSwitch} />
      <div className="col" style={{ flex: 1, minWidth: 0 }}>
        <Topbar user={user} role={role} title={title} onMenu={() => setMobileOpen(true)} attempts={attempts} go={go} onLogout={onLogout} />
        <main className="main-scroll" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }} key={screen}>
          <div className="page anim-fade-up">{children}</div>
        </main>
        {role === 'student' && <BottomNav screen={screen} go={go} />}
      </div>
    </div>
  );
}

Object.assign(window, { Logo, Shell, Sidebar, Topbar, BottomNav, NAV, ROLE_LABEL, iconBtn, LangCtx, useT, LangSwitcher });
