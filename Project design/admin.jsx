/* ============================================================
   GOVORI — Admin screens v2
   ============================================================ */

function AdminDashboard() {
  return (
    <div className="col gap-5 focus-wrap">
      <div className="col gap-1"><h2 style={{ fontSize: 26 }}>Boshqaruv paneli</h2><p style={{ color: 'var(--muted)', fontSize: 15 }}>Platforma holati — iyun 2026</p></div>
      <div className="g4">
        {ADMIN_KPI.map((k, i) => (
          <Card key={i} pad={20}>
            <div className="row between" style={{ alignItems: 'flex-start' }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, background: `oklch(0.94 0.06 ${k.hue})`, color: `oklch(0.5 0.15 ${k.hue})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={['users', 'flame', 'mic', 'target'][i]} size={22} /></div>
              <span className="row gap-1" style={{ fontSize: 12.5, fontWeight: 800, color: k.up ? 'var(--success)' : 'var(--danger)' }}><Icon name={k.up ? 'arrowUp' : 'arrowDown'} size={13} sw={2.5} />{k.delta}</span>
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 30, marginTop: 14, lineHeight: 1 }}>{k.val}</div>
            <div style={{ fontSize: 13.5, color: 'var(--muted)', fontWeight: 700, marginTop: 5 }}>{k.uz}</div>
          </Card>
        ))}
      </div>
      <div className="split">
        <Card>
          <SectionTitle action={<Pill hue={47} size="sm" icon="arrowUp">+107%</Pill>}>Oʻquvchilar oʻsishi</SectionTitle>
          <BarChart data={ADMIN_ENROLL} valueKey="v" labelKey="m" hue={47} h={180} />
        </Card>
        <Card>
          <SectionTitle>Daraja boʻyicha</SectionTitle>
          <div className="col gap-3" style={{ marginTop: 8 }}>
            {ADMIN_LEVELS.map(l => { const total = ADMIN_LEVELS.reduce((a, b) => a + b.n, 0); return (
              <div key={l.lvl} className="row gap-3"><span style={{ width: 26, fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 14, color: `oklch(0.5 0.15 ${l.hue})` }}>{l.lvl}</span><div className="grow"><Bar value={(l.n / total) * 100} hue={l.hue} height={10} /></div><span style={{ fontSize: 13, color: 'var(--ink-soft)', fontWeight: 700, width: 38, textAlign: 'right' }}>{l.n}</span></div>
            ); })}
          </div>
        </Card>
      </div>
      <Card>
        <SectionTitle action={<Button variant="ghost" size="sm" icon="arrowDown">Eksport</Button>}>Soʻnggi faollik</SectionTitle>
        <div className="col gap-1">
          {[['Jasur Toshmatov', 'Part 2 javobini topshirdi', '5 daq oldin', 'mic', 47], ['Dilnoza Karimova', 'Kamola R. ni baholadi (7.0)', '22 daq oldin', 'check', 152], ['Yangi oʻquvchi', 'Sevara T. roʻyxatdan oʻtdi', '1 soat oldin', 'user', 248], ['Admin', 'Aziz N. ga Premium berdi', '2 soat oldin', 'star', 80]].map((a, i) => (
            <div key={i} className="row gap-3" style={{ padding: '11px 0', borderBottom: i < 3 ? '1px solid var(--line)' : 'none' }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: `oklch(0.95 0.05 ${a[4]})`, color: `oklch(0.5 0.15 ${a[4]})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={a[3]} size={17} /></div>
              <div className="col grow" style={{ minWidth: 0 }}><span style={{ fontSize: 14, fontWeight: 700 }} className="truncate">{a[0]}</span><span style={{ fontSize: 12.5, color: 'var(--muted)' }} className="truncate">{a[1]}</span></div>
              <span style={{ fontSize: 12.5, color: 'var(--faint)', whiteSpace: 'nowrap' }}>{a[2]}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function AdminStudents() {
  const [q, setQ] = useState('');
  const [prem, setPrem] = useState({});
  const list = ADMIN_USERS.filter(u => u.role === "Oʻquvchi" && u.name.toLowerCase().includes(q.toLowerCase()));
  const cols = '2.2fr 0.7fr 0.9fr 1fr 1.2fr';
  return (
    <div className="focus-wrap">
      <div className="row between wrap gap-4" style={{ marginBottom: 18 }}>
        <div className="col gap-1"><h2 style={{ fontSize: 26 }}>Oʻquvchilar</h2><p style={{ color: 'var(--muted)', fontSize: 15 }}>Premiumni qoʻlda bering yoki olib qoʻying</p></div>
        <Button icon="plus">Qoʻshish</Button>
      </div>
      <div className="row gap-2" style={{ background: 'var(--surface)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-pill)', padding: '9px 16px', marginBottom: 18, maxWidth: 360 }}>
        <Icon name="search" size={18} style={{ color: 'var(--muted)' }} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Ism boʻyicha qidirish..." style={{ border: 'none', background: 'transparent', outline: 'none', flex: 1, fontSize: 14, color: 'var(--ink)' }} />
      </div>
      <Card pad={0}>
        <div className="t-head" style={{ display: 'grid', gridTemplateColumns: cols, padding: '14px 20px', borderBottom: '1px solid var(--line)', fontSize: 12, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          <span>Oʻquvchi</span><span>Daraja</span><span>Holat</span><span>Qoʻshilgan</span><span style={{ textAlign: 'right' }}>Premium</span>
        </div>
        {list.map((u, i) => {
          const isPrem = prem[u.name] ?? false;
          return (
            <div key={i} className="t-row" style={{ display: 'grid', gridTemplateColumns: cols, padding: '12px 20px', borderBottom: i < list.length - 1 ? '1px solid var(--line)' : 'none', alignItems: 'center' }}>
              <div className="row gap-3" style={{ minWidth: 0 }}><Avatar name={u.name} size={38} /><span style={{ fontWeight: 700, fontSize: 14.5 }} className="truncate">{u.name}</span></div>
              <span className="t-hide-sm" style={{ fontSize: 13.5, color: 'var(--muted)' }}>{u.lvl}</span>
              <span className="t-hide-sm"><span className="row gap-2" style={{ fontSize: 13, fontWeight: 600, color: u.status === 'active' ? 'var(--success)' : 'var(--faint)' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: u.status === 'active' ? 'var(--success)' : 'var(--faint)' }} />{u.status === 'active' ? 'Faol' : 'Nofaol'}</span></span>
              <span className="t-hide-sm mono" style={{ fontSize: 13, color: 'var(--muted)' }}>{u.joined}</span>
              <div style={{ justifySelf: 'end' }}>
                {isPrem ? <Button size="sm" variant="ghost" icon="x" onClick={() => setPrem({ ...prem, [u.name]: false })}>Olib qoʻyish</Button> : <Button size="sm" variant="soft" icon="star" onClick={() => setPrem({ ...prem, [u.name]: true })}>Berish</Button>}
              </div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}

function AdminTeachers() {
  const cols = '2.2fr 0.9fr 1fr 1fr 1.2fr';
  return (
    <div className="focus-wrap">
      <div className="row between wrap gap-4" style={{ marginBottom: 18 }}>
        <div className="col gap-1"><h2 style={{ fontSize: 26 }}>Oʻqituvchilar</h2><p style={{ color: 'var(--muted)', fontSize: 15 }}>{ADMIN_TEACHERS.length} ta oʻqituvchi</p></div>
        <Button icon="plus">Oʻqituvchi qoʻshish</Button>
      </div>
      <Card pad={0}>
        <div className="t-head" style={{ display: 'grid', gridTemplateColumns: cols, padding: '14px 20px', borderBottom: '1px solid var(--line)', fontSize: 12, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          <span>Oʻqituvchi</span><span>Guruhlar</span><span>Oʻquvchilar</span><span>Holat</span><span>Qoʻshilgan</span>
        </div>
        {ADMIN_TEACHERS.map((u, i) => (
          <div key={i} className="t-row" style={{ display: 'grid', gridTemplateColumns: cols, padding: '12px 20px', borderBottom: i < ADMIN_TEACHERS.length - 1 ? '1px solid var(--line)' : 'none', alignItems: 'center' }}>
            <div className="row gap-3" style={{ minWidth: 0 }}><Avatar name={u.name} size={38} /><span style={{ fontWeight: 700, fontSize: 14.5 }} className="truncate">{u.name}</span></div>
            <span style={{ fontWeight: 800, fontFamily: 'var(--font-display)' }}>{u.groups}</span>
            <span className="t-hide-sm" style={{ fontWeight: 800, fontFamily: 'var(--font-display)' }}>{u.students}</span>
            <span className="t-hide-sm"><span className="row gap-2" style={{ fontSize: 13, fontWeight: 600, color: u.status === 'active' ? 'var(--success)' : 'var(--faint)' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: u.status === 'active' ? 'var(--success)' : 'var(--faint)' }} />{u.status === 'active' ? 'Faol' : 'Nofaol'}</span></span>
            <span className="t-hide-sm mono" style={{ fontSize: 13, color: 'var(--muted)' }}>{u.joined}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}

function AdminTests() {
  return (
    <div className="focus-wrap">
      <div className="row between wrap gap-4" style={{ marginBottom: 20 }}>
        <div className="col gap-1"><h2 style={{ fontSize: 26 }}>Testlar va savollar bazasi</h2><p style={{ color: 'var(--muted)', fontSize: 15 }}>Platformadagi tayyor topshiriqlar toʻplami</p></div>
        <Button icon="plus">Test qoʻshish</Button>
      </div>
      <div className="g2">
        {ADMIN_TESTS.map((t, i) => (
          <Card key={i} hover>
            <div className="row gap-4">
              <div style={{ width: 52, height: 52, borderRadius: 15, background: `linear-gradient(135deg, oklch(0.76 0.12 ${t.hue}), oklch(0.64 0.17 ${t.hue}))`, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 18 }}>{t.part === 0 ? <Icon name="headphones" size={24} /> : 'P' + t.part}</div>
              <div className="col grow" style={{ minWidth: 0 }}>
                <span style={{ fontWeight: 800, fontSize: 16 }} className="truncate">{t.title}</span>
                <div className="row gap-4" style={{ marginTop: 6, color: 'var(--muted)', fontSize: 13 }}><span className="row gap-1"><Icon name="message" size={14} />{t.qs} savol</span><span className="row gap-1"><Icon name="users" size={14} />{t.uses} marta</span></div>
              </div>
              <button style={iconBtn} className="tap"><Icon name="dots" size={18} /></button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { AdminDashboard, AdminStudents, AdminTeachers, AdminTests });
