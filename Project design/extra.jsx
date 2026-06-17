/* ============================================================
   GOVORI — Extra screens
   Student Assignments · Teacher Questions/Topics/Students
   Settings · Notifications · Profile · 404
   ============================================================ */

/* ---- local data ---- */
const STU_ASSIGN = [
  { tid: 't-p3', title: 'Part 3 — «Технологии и общество»', group: 'B1 — Kechki guruh', due: '2 kun qoldi', status: 'pending', hue: 248 },
  { tid: 't-p2', title: 'Part 2 — «Опишите путешествие»', group: 'B1 — Kechki guruh', due: 'Bugun', status: 'pending', hue: 47 },
  { tid: 't-p1', title: 'Part 1 — «Мой город»', group: 'B1 — Kechki guruh', due: 'Topshirildi', status: 'done', band: 6.0, hue: 152 },
  { tid: 't-p2', title: 'Part 2 — «Любимая книга»', group: 'B1 — Kechki guruh', due: 'Muddati oʻtgan', status: 'late', hue: 28 },
];
const QUESTIONS_LIB = [
  { id: 'q1', ru: 'Расскажите немного о себе.', part: 1, level: 'A2', type: 'text', uses: 320 },
  { id: 'q2', ru: 'Опишите книгу, которая вам понравилась.', part: 2, level: 'B1', type: 'text', uses: 286 },
  { id: 'q3', ru: 'Опишите этот рисунок и расскажите, что на нём происходит.', part: 2, level: 'B1', type: 'image', uses: 142 },
  { id: 'q4', ru: 'Как изменились привычки чтения за последние годы?', part: 3, level: 'B2', type: 'text', uses: 98 },
  { id: 'q5', ru: 'Посмотрите видео и опишите ситуацию.', part: 2, level: 'B2', type: 'video', uses: 64 },
  { id: 'q6', ru: 'Чем вы любите заниматься в свободное время?', part: 1, level: 'A2', type: 'text', uses: 410 },
];
const TOPICS = [
  { ru: 'Семья и дом', uz: 'Oila va uy', qs: 12, hue: 47, icon: 'home' },
  { ru: 'Путешествия', uz: 'Sayohat', qs: 9, hue: 152, icon: 'globe' },
  { ru: 'Технологии', uz: 'Texnologiya', qs: 8, hue: 248, icon: 'settings' },
  { ru: 'Образование', uz: "Ta'lim", qs: 11, hue: 80, icon: 'grad' },
  { ru: 'Здоровье и спорт', uz: 'Sogʻliq va sport', qs: 7, hue: 28, icon: 'flame' },
  { ru: 'Культура и искусство', uz: 'Madaniyat', qs: 6, hue: 305, icon: 'star' },
];
const NOTIF_GROUPS = [
  { day: 'Bugun', items: [
    { uz: 'Dilnoza opa Part 2 javobingizni baholadi', sub: '7.0 ball — «Ajoyib ish!»', icon: 'message', hue: 152, time: '14:20', unread: true },
    { uz: 'Kunlik topshiriq tayyor', sub: '«Любимая книга» — +90 XP', icon: 'flame', hue: 47, time: '09:00', unread: true },
  ] },
  { day: 'Kecha', items: [
    { uz: 'Yangi yutuq: 50 ta mashq! 🎉', sub: 'Tabriklaymiz, davom eting', icon: 'award', hue: 80, time: '18:40', unread: false },
    { uz: 'Streak muzlatildi ❄️', sub: 'Seriyangiz saqlanib qoldi', icon: 'flame', hue: 248, time: '00:05', unread: false },
  ] },
  { day: '2 kun oldin', items: [
    { uz: 'Yangi topshiriq: Part 3', sub: 'Muddat: 2 kun — «Технологии»', icon: 'book', hue: 305, time: '11:15', unread: false },
  ] },
];

/* ---------------- Student: Assignments ---------------- */
function StudentAssignments({ startTask }) {
  const statusMap = {
    pending: { uz: 'Kutilmoqda', hue: 47, icon: 'clock' },
    done: { uz: 'Topshirildi', hue: 152, icon: 'check' },
    late: { uz: 'Muddati oʻtgan', hue: 28, icon: 'flag' },
  };
  return (
    <div className="focus-wrap">
      <div className="col gap-1" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 26 }}>Topshiriqlar</h2>
        <p style={{ color: 'var(--muted)', fontSize: 15 }}>Oʻqituvchingiz bergan muddatli vazifalar</p>
      </div>
      <div className="g2">
        {STU_ASSIGN.map((a, i) => {
          const st = statusMap[a.status];
          return (
            <Card key={i} style={{ opacity: a.status === 'done' ? 0.85 : 1 }}>
              <div className="row between" style={{ marginBottom: 10 }}>
                <Pill hue={a.hue} size="sm">{a.group}</Pill>
                <span className="row gap-1" style={{ fontSize: 12.5, fontWeight: 700, color: `oklch(0.5 0.15 ${st.hue})` }}><Icon name={st.icon} size={14} />{a.due}</span>
              </div>
              <h3 style={{ fontSize: 17, lineHeight: 1.35, minHeight: 46 }}>{a.title}</h3>
              <div className="row between" style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
                {a.status === 'done'
                  ? <Pill hue={bandColor(a.band)} icon="check">{a.band.toFixed(1)} ball</Pill>
                  : <span className="row gap-2" style={{ fontSize: 13, fontWeight: 700, color: `oklch(0.5 0.14 ${st.hue})` }}><Icon name={st.icon} size={15} />{st.uz}</span>}
                {a.status === 'done'
                  ? <Button size="sm" variant="ghost" icon="eye">Natija</Button>
                  : <Button size="sm" icon="mic" onClick={() => startTask(TASKS.find(t => t.id === a.tid) || TASKS[0])}>Bajarish</Button>}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- Teacher: Questions library ---------------- */
function TeacherQuestions({ onCreate }) {
  const [q, setQ] = useState('');
  const typeIcon = { text: 'message', image: 'eye', video: 'play' };
  const list = QUESTIONS_LIB.filter(x => x.ru.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="focus-wrap">
      <div className="row between wrap gap-4" style={{ marginBottom: 18 }}>
        <div className="col gap-1"><h2 style={{ fontSize: 26 }}>Savollar bazasi</h2><p style={{ color: 'var(--muted)', fontSize: 15 }}>Savollarni tahrirlang, nusxalang yoki yangisini yarating</p></div>
        <Button icon="plus" onClick={onCreate}>Yangi savol</Button>
      </div>
      <div className="row gap-2" style={{ background: 'var(--surface)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-pill)', padding: '9px 16px', marginBottom: 18, maxWidth: 380 }}>
        <Icon name="search" size={18} style={{ color: 'var(--muted)' }} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Savol boʻyicha qidirish..." style={{ border: 'none', background: 'transparent', outline: 'none', flex: 1, fontSize: 14, color: 'var(--ink)' }} />
      </div>
      <div className="col gap-3">
        {list.map(x => {
          const hue = [0, 152, 47, 248][x.part] || 47;
          return (
            <Card key={x.id} hover pad={16}>
              <div className="row gap-4 wrap">
                <div style={{ width: 46, height: 46, borderRadius: 13, background: `oklch(0.94 0.06 ${hue})`, color: `oklch(0.5 0.15 ${hue})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={typeIcon[x.type]} size={21} /></div>
                <div className="col grow" style={{ minWidth: 180, gap: 5 }}>
                  <span style={{ fontWeight: 700, fontSize: 15.5, lineHeight: 1.3 }}>{x.ru}</span>
                  <div className="row gap-2 wrap"><Pill hue={hue} size="sm">Part {x.part}</Pill><Pill hue={47} size="sm">{x.level}</Pill><span style={{ fontSize: 12, color: 'var(--muted)' }} className="row gap-1"><Icon name="users" size={13} />{x.uses} marta</span></div>
                </div>
                <div className="row gap-2">
                  <button style={iconBtn} className="tap" title="Tahrirlash"><Icon name="edit" size={18} /></button>
                  <button style={iconBtn} className="tap" title="Nusxalash"><Icon name="layers" size={18} /></button>
                  <button style={iconBtn} className="tap" title="Oʻchirish"><Icon name="trash" size={18} /></button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- Teacher: Topics ---------------- */
function TeacherTopics() {
  return (
    <div className="focus-wrap">
      <div className="row between wrap gap-4" style={{ marginBottom: 20 }}>
        <div className="col gap-1"><h2 style={{ fontSize: 26 }}>Mavzular</h2><p style={{ color: 'var(--muted)', fontSize: 15 }}>Savollar mavzular boʻyicha guruhlanadi</p></div>
        <Button icon="plus">Mavzu qoʻshish</Button>
      </div>
      <div className="g3">
        {TOPICS.map((t, i) => (
          <Card key={i} hover>
            <div className="row between" style={{ marginBottom: 14 }}>
              <div style={{ width: 50, height: 50, borderRadius: 15, background: `linear-gradient(135deg, oklch(0.78 0.11 ${t.hue}), oklch(0.65 0.16 ${t.hue}))`, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={t.icon} size={24} /></div>
              <button style={iconBtn} className="tap"><Icon name="dots" size={18} /></button>
            </div>
            <h3 style={{ fontSize: 18 }}>{t.ru}</h3>
            <p style={{ fontSize: 13.5, color: 'var(--muted)', marginTop: 2 }}>{t.uz}</p>
            <div className="row gap-2" style={{ marginTop: 12, color: 'var(--ink-soft)', fontSize: 13, fontWeight: 700 }}><Icon name="message" size={15} />{t.qs} savol</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Teacher: Students ---------------- */
function TeacherStudentsList() {
  const [q, setQ] = useState('');
  const [prem, setPrem] = useState({});
  const list = TEACHER_STUDENTS.filter(s => s.name.toLowerCase().includes(q.toLowerCase()));
  const cols = '2fr 0.7fr 0.7fr 1.3fr 1fr 1fr';
  return (
    <div className="focus-wrap">
      <div className="col gap-1" style={{ marginBottom: 18 }}><h2 style={{ fontSize: 26 }}>Oʻquvchilarim</h2><p style={{ color: 'var(--muted)', fontSize: 15 }}>Qidiring, progressni kuzating, premium bering</p></div>
      <div className="row gap-2" style={{ background: 'var(--surface)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-pill)', padding: '9px 16px', marginBottom: 18, maxWidth: 360 }}>
        <Icon name="search" size={18} style={{ color: 'var(--muted)' }} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Ism boʻyicha qidirish..." style={{ border: 'none', background: 'transparent', outline: 'none', flex: 1, fontSize: 14, color: 'var(--ink)' }} />
      </div>
      <Card pad={0}>
        <div className="t-head" style={{ display: 'grid', gridTemplateColumns: cols, columnGap: 12, padding: '14px 20px', borderBottom: '1px solid var(--line)', fontSize: 12, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          <span>Oʻquvchi</span><span>Daraja</span><span>Band</span><span>Progress</span><span>Faollik</span><span style={{ textAlign: 'right' }}>Premium</span>
        </div>
        {list.map((s, i) => (
          <div key={i} className="t-row" style={{ display: 'grid', gridTemplateColumns: cols, columnGap: 12, padding: '12px 20px', borderBottom: i < list.length - 1 ? '1px solid var(--line)' : 'none', alignItems: 'center' }}>
            <div className="row gap-3" style={{ minWidth: 0 }}><Avatar name={s.name} size={38} /><span style={{ fontWeight: 700, fontSize: 14.5 }} className="truncate">{s.name}</span></div>
            <span className="t-hide-sm"><Pill hue={47} size="sm">{s.lvl}</Pill></span>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 15, color: `oklch(0.5 0.15 ${bandColor(s.band)})` }}>{s.band.toFixed(1)}</span>
            <div className="row gap-2 t-hide-sm"><Bar value={s.progress} hue={47} height={7} /><span style={{ fontSize: 12.5, color: 'var(--muted)', width: 32 }}>{s.progress}%</span></div>
            <span className="t-hide-sm" style={{ fontSize: 13, color: 'var(--muted)' }}>{s.last}</span>
            <div style={{ justifySelf: 'end' }}>{prem[s.name] ? <Button size="sm" variant="ghost" icon="x" onClick={() => setPrem({ ...prem, [s.name]: false })}>Olib qoʻyish</Button> : <Button size="sm" variant="soft" icon="star" onClick={() => setPrem({ ...prem, [s.name]: true })}>Berish</Button>}</div>
          </div>
        ))}
      </Card>
    </div>
  );
}

/* ---------------- Settings (role-aware) ---------------- */
function Toggle({ on, set }) {
  return (
    <button onClick={() => set(!on)} className="tap" style={{ width: 46, height: 26, borderRadius: 999, border: 'none', cursor: 'pointer', position: 'relative', flexShrink: 0, background: on ? 'var(--success)' : 'var(--line-2)', transition: 'background .2s' }}>
      <span style={{ position: 'absolute', top: 3, left: on ? 23 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: 'var(--sh-sm)' }} />
    </button>
  );
}
function SettingsScreen({ role, user, go }) {
  const { lang, setLang } = useT();
  const [tg, setTg] = useState({ daily: true, feedback: true, streak: true, email: false, sound: true, autoAI: true, teacherApprove: true });
  const set = k => v => setTg(s => ({ ...s, [k]: v }));
  const langs = [['uz', "Oʻzbekcha"], ['ru', 'Русский'], ['en', 'English']];

  const Section = ({ title, children }) => (<div className="col gap-3"><span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</span><Card pad={0}>{children}</Card></div>);
  const Row = ({ label, sub, children, last }) => (<div className="row between gap-4" style={{ padding: '15px 20px', borderBottom: last ? 'none' : '1px solid var(--line)' }}><div className="col"><span style={{ fontSize: 15, fontWeight: 700 }}>{label}</span>{sub && <span style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>{sub}</span>}</div>{children}</div>);

  return (
    <div className="focus-wrap" style={{ maxWidth: 720, marginInline: 'auto' }}>
      <div className="col gap-1" style={{ marginBottom: 22 }}><h2 style={{ fontSize: 26 }}>Sozlamalar</h2><p style={{ color: 'var(--muted)', fontSize: 15 }}>Hisob, til va bildirishnomalar</p></div>
      <div className="col gap-5">
        <Section title="Hisob">
          <Row label={user.name} sub={ROLE_LABEL[role]}><Avatar name={user.name} size={42} /></Row>
          <Row label="Email" sub="madina@example.com"><Button size="sm" variant="ghost" icon="edit">Oʻzgartirish</Button></Row>
          <Row label="Parol" sub="Oxirgi oʻzgarish: 2 oy oldin" last><Button size="sm" variant="ghost">Yangilash</Button></Row>
        </Section>

        <Section title="Til (uz / ru / en)">
          <div style={{ padding: 14 }}>
            <div className="row gap-2">
              {langs.map(l => (
                <button key={l[0]} onClick={() => setLang(l[0])} className="tap" style={{ flex: 1, padding: '11px', borderRadius: 'var(--r-sm)', cursor: 'pointer', border: lang === l[0] ? '2px solid var(--primary)' : '2px solid var(--line)', background: lang === l[0] ? 'var(--primary-tint)' : 'var(--surface)', color: lang === l[0] ? 'var(--primary-press)' : 'var(--ink-soft)', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 14 }}>{l[1]}</button>
              ))}
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 10 }}>Menyu tili oʻzgaradi. Oʻquv kontenti (savollar) ruscha qoladi.</p>
          </div>
        </Section>

        <Section title="Bildirishnomalar">
          <Row label="Kunlik topshiriq eslatmasi"><Toggle on={tg.daily} set={set('daily')} /></Row>
          <Row label="Baho va oʻqituvchi izohi"><Toggle on={tg.feedback} set={set('feedback')} /></Row>
          <Row label="Streak eslatmasi"><Toggle on={tg.streak} set={set('streak')} /></Row>
          <Row label="Email xabarnomalar" last><Toggle on={tg.email} set={set('email')} /></Row>
        </Section>

        {role === 'student' && (
          <Section title="Mashq">
            <Row label="Ovoz effektlari" sub="Nishonlash va tugma tovushlari" last><Toggle on={tg.sound} set={set('sound')} /></Row>
          </Section>
        )}
        {(role === 'teacher' || role === 'admin') && (
          <Section title="Baholash">
            <Row label="AI avtomatik baholash"><Toggle on={tg.autoAI} set={set('autoAI')} /></Row>
            <Row label="Oʻqituvchi tasdigʼi talab qilinsin" last><Toggle on={tg.teacherApprove} set={set('teacherApprove')} /></Row>
          </Section>
        )}

        <div className="row between" style={{ paddingTop: 4 }}>
          <Button variant="ghost" onClick={() => go('notfound')} style={{ color: 'var(--faint)' }}>Demo: 404 sahifa</Button>
          <Button variant="ghost" icon="logout" style={{ color: 'var(--danger)', borderColor: 'var(--danger-tint)' }} onClick={() => go('__logout')}>Chiqish</Button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Notifications ---------------- */
function NotificationsPage() {
  return (
    <div className="focus-wrap" style={{ maxWidth: 680, marginInline: 'auto' }}>
      <div className="row between wrap gap-4" style={{ marginBottom: 20 }}>
        <div className="col gap-1"><h2 style={{ fontSize: 26 }}>Bildirishnomalar</h2><p style={{ color: 'var(--muted)', fontSize: 15 }}>Barcha yangilik va eslatmalar</p></div>
        <Button variant="ghost" size="sm" icon="check">Hammasini oʻqilgan</Button>
      </div>
      <div className="col gap-5">
        {NOTIF_GROUPS.map((g, gi) => (
          <div key={gi} className="col gap-2">
            <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '0.06em', paddingLeft: 4 }}>{g.day}</span>
            <Card pad={0}>
              {g.items.map((n, i) => (
                <div key={i} className="row gap-3" style={{ padding: '14px 18px', borderBottom: i < g.items.length - 1 ? '1px solid var(--line)' : 'none', background: n.unread ? 'var(--primary-tint)' : 'transparent' }}>
                  <div style={{ width: 40, height: 40, borderRadius: 12, background: `oklch(0.95 0.05 ${n.hue})`, color: `oklch(0.5 0.15 ${n.hue})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={n.icon} size={19} /></div>
                  <div className="col grow" style={{ minWidth: 0 }}><span style={{ fontSize: 14.5, fontWeight: 700 }}>{n.uz}</span><span style={{ fontSize: 13, color: 'var(--muted)' }}>{n.sub}</span></div>
                  <span style={{ fontSize: 12, color: 'var(--faint)', whiteSpace: 'nowrap' }}>{n.time}</span>
                  {n.unread && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--primary)', flexShrink: 0 }} />}
                </div>
              ))}
            </Card>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Profile (role-aware) ---------------- */
function ProfileScreen({ role, user }) {
  const isStudent = role === 'student';
  const stats = isStudent
    ? [['Band', STUDENT.band.toFixed(1), 47], ['Streak', STUDENT.streak, 28], ['XP', STUDENT.points.toLocaleString(), 80], ['Daraja', STUDENT.level, 152]]
    : role === 'teacher'
      ? [['Guruhlar', 3, 47], ['Oʻquvchilar', 38, 152], ['Baholandi', 248, 80], ["Oʻrt. band", '6.1', 248]]
      : [['Foydalanuvchilar', '1,284', 47], ['Oʻqituvchilar', 12, 152], ['Kurslar', 5, 80], ['Faol', '892', 248]];
  return (
    <div className="focus-wrap" style={{ maxWidth: 760, marginInline: 'auto' }}>
      <Card pad={0} style={{ overflow: 'hidden', marginBottom: 20 }}>
        <div style={{ height: 110, background: 'linear-gradient(135deg, oklch(0.75 0.15 56), oklch(0.64 0.19 38))', position: 'relative' }}>
          <div style={{ position: 'absolute', right: -30, top: -30, width: 160, height: 160, borderRadius: '50%', background: 'oklch(1 0 0 / 0.1)' }} />
        </div>
        <div style={{ padding: '0 28px 24px', marginTop: -46 }}>
          <div className="row between wrap gap-4" style={{ alignItems: 'flex-end' }}>
            <div className="row gap-4" style={{ alignItems: 'flex-end' }}>
              <div style={{ borderRadius: '50%', border: '5px solid var(--surface)', background: 'var(--surface)' }}><Avatar name={user.name} size={92} /></div>
              <div className="col" style={{ paddingBottom: 6 }}><h2 style={{ fontSize: 24 }}>{user.name}</h2><span style={{ fontSize: 14, color: 'var(--muted)' }}>{ROLE_LABEL[role]} {isStudent && `· ${STUDENT.city}`}</span></div>
            </div>
            <Button variant="ghost" icon="edit" style={{ marginBottom: 6 }}>Profilni tahrirlash</Button>
          </div>
        </div>
      </Card>

      <div className="g4" style={{ marginBottom: 20 }}>
        {stats.map((s, i) => (
          <Card key={i} pad={18} style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 26, color: `oklch(0.5 0.15 ${s[2]})` }}>{s[1]}</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 700, marginTop: 4 }}>{s[0]}</div>
          </Card>
        ))}
      </div>

      {isStudent && (
        <Card>
          <SectionTitle>Mening maqsadim</SectionTitle>
          <div className="row gap-4">
            <Ring value={Math.round((STUDENT.band / STUDENT.goalBand) * 100)} size={92} sw={10} hue={47}><span style={{ fontWeight: 900, fontFamily: 'var(--font-display)', fontSize: 18 }}>{STUDENT.band.toFixed(1)}</span></Ring>
            <div className="col" style={{ justifyContent: 'center', gap: 4 }}><span style={{ fontSize: 15, fontWeight: 800 }}>Maqsad: band {STUDENT.goalBand.toFixed(1)}</span><span style={{ fontSize: 13.5, color: 'var(--muted)' }}>Yana 1.0 ball — davom eting! 🔥</span></div>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ---------------- 404 ---------------- */
function NotFound({ go, home }) {
  return (
    <div className="focus-wrap" style={{ maxWidth: 460, marginInline: 'auto', textAlign: 'center', paddingTop: 36 }}>
      <Mascot size={120} mood="thinking" />
      <h1 style={{ fontSize: 72, marginTop: 8, background: 'linear-gradient(135deg, oklch(0.72 0.18 52), oklch(0.62 0.19 38))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', letterSpacing: '-0.04em' }}>404</h1>
      <h2 style={{ fontSize: 24, marginTop: 4 }}>Sahifa topilmadi</h2>
      <p style={{ color: 'var(--muted)', fontSize: 15, marginTop: 8 }}>Bu sahifa mavjud emas yoki koʻchirilgan. Keling, sizni xavfsiz joyga qaytaramiz.</p>
      <Button size="lg" icon="home" style={{ marginTop: 22 }} onClick={() => go(home)}>Bosh sahifaga</Button>
    </div>
  );
}

Object.assign(window, { StudentAssignments, TeacherQuestions, TeacherTopics, TeacherStudentsList, SettingsScreen, NotificationsPage, ProfileScreen, NotFound });
