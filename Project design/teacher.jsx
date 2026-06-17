/* ============================================================
   GOVORI — Teacher screens v2
   ============================================================ */

function TeacherOverview({ go, openAnswer }) {
  const pending = SUBMISSIONS.filter(s => s.status === 'pending');
  const stats = [
    { uz: "Oʻquvchilar", val: 38, icon: 'users', hue: 47 },
    { uz: 'Baholanmagan', val: pending.length, icon: 'headphones', hue: 28 },
    { uz: 'Bu hafta baholangan', val: 24, icon: 'check', hue: 152 },
    { uz: "Oʻrtacha band", val: '6.1', icon: 'target', hue: 80 },
  ];
  return (
    <div className="col gap-5 focus-wrap">
      <div className="col gap-1"><h2 style={{ fontSize: 26 }}>Salom, Dilnoza! 👋</h2><p style={{ color: 'var(--muted)', fontSize: 15 }}>Bugun {pending.length} ta yangi javob baholashni kutmoqda</p></div>
      <div className="g4">
        {stats.map((s, i) => (
          <Card key={i} pad={20}>
            <div style={{ width: 42, height: 42, borderRadius: 12, background: `oklch(0.94 0.06 ${s.hue})`, color: `oklch(0.5 0.15 ${s.hue})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={s.icon} size={22} /></div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 30, marginTop: 14, lineHeight: 1 }}>{s.val}</div>
            <div style={{ fontSize: 13.5, color: 'var(--muted)', fontWeight: 700, marginTop: 5 }}>{s.uz}</div>
          </Card>
        ))}
      </div>
      <div className="g3">
        {[['tstudents', "Oʻquvchilarim", 'users', 47, '38 ta oʻquvchi'], ['questions', 'Savollar bazasi', 'message', 152, '6 ta savol'], ['topics', 'Mavzular', 'layers', 248, '6 ta mavzu']].map(q => (
          <Card key={q[0]} hover onClick={() => go(q[0])}>
            <div className="row gap-3">
              <div style={{ width: 46, height: 46, borderRadius: 13, background: `oklch(0.94 0.06 ${q[3]})`, color: `oklch(0.5 0.15 ${q[3]})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={q[2]} size={22} /></div>
              <div className="col grow"><span style={{ fontWeight: 800, fontSize: 15.5, fontFamily: 'var(--font-display)' }}>{q[1]}</span><span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{q[4]}</span></div>
              <Icon name="chevR" size={20} style={{ color: 'var(--faint)' }} />
            </div>
          </Card>
        ))}
      </div>
      <div className="split">
        <Card>
          <SectionTitle action={<Button variant="soft" size="sm" iconR="chevR" onClick={() => go('answers')}>Barchasi</Button>}>Baholash navbati</SectionTitle>
          <div className="col gap-2">
            {pending.map(s => (
              <div key={s.id} className="row gap-3 tap" style={{ padding: 12, borderRadius: 'var(--r-sm)', background: 'var(--surface-2)', cursor: 'pointer' }} onClick={() => openAnswer(s)}>
                <Avatar name={s.student} size={42} />
                <div className="col grow" style={{ minWidth: 0 }}><span style={{ fontWeight: 800, fontSize: 14.5 }} className="truncate">{s.student}</span><span style={{ fontSize: 12.5, color: 'var(--muted)' }} className="truncate">{s.task} · {fmt(s.dur)} · {s.when}</span></div>
                <Pill hue={bandColor(s.autoBand)} size="sm">AI {s.autoBand.toFixed(1)}</Pill>
                <Button size="sm" icon="play">Tinglash</Button>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <SectionTitle>Guruh dinamikasi</SectionTitle>
          <LineChart data={PROGRESS} hue={152} h={150} />
          <div style={{ marginTop: 14, padding: 13, background: 'var(--success-tint)', borderRadius: 'var(--r-sm)', display: 'flex', gap: 10, alignItems: 'center' }}><Icon name="arrowUp" size={18} style={{ color: 'var(--success)' }} /><span style={{ fontSize: 13.5, color: 'oklch(0.4 0.1 152)' }}>Guruh oʻrtacha bali oxirgi oyda <b>+0.5</b> koʻtarildi</span></div>
        </Card>
      </div>
    </div>
  );
}

/* ---------------- Assignments + Create question ---------------- */
function CreateQuestion({ onBack }) {
  const [type, setType] = useState('text');
  const [sample, setSample] = useState('');
  const t = QUESTION_TYPES.find(q => q.id === type);
  return (
    <div className="focus-wrap" style={{ maxWidth: 760, marginInline: 'auto' }}>
      <Button variant="ghost" size="sm" icon="chevL" onClick={onBack} style={{ marginBottom: 16 }}>Topshiriqlarga qaytish</Button>
      <h2 style={{ fontSize: 24, marginBottom: 4 }}>Yangi savol yaratish</h2>
      <p style={{ color: 'var(--muted)', fontSize: 15, marginBottom: 20 }}>Savol turini tanlang va topshiriqni toʻldiring</p>

      <div className="g3" style={{ marginBottom: 22 }}>
        {QUESTION_TYPES.map(q => {
          const active = type === q.id;
          return (
            <button key={q.id} onClick={() => setType(q.id)} className="tap" style={{
              padding: 18, borderRadius: 'var(--r-md)', textAlign: 'left', cursor: 'pointer',
              border: active ? `2px solid oklch(0.7 0.16 ${q.hue})` : '2px solid var(--line)', background: active ? `oklch(0.97 0.03 ${q.hue})` : 'var(--surface)',
            }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, background: `oklch(0.94 0.06 ${q.hue})`, color: `oklch(0.5 0.15 ${q.hue})`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}><Icon name={q.icon} size={21} /></div>
              <div style={{ fontWeight: 800, fontFamily: 'var(--font-display)', fontSize: 15.5 }}>{q.uz}</div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3, lineHeight: 1.4 }}>{q.desc}</div>
            </button>
          );
        })}
      </div>

      <Card>
        <div className="col gap-4">
          {type !== 'text' && <ImgSlot label={type === 'image' ? 'savol_rasmi.jpg' : 'savol_videosi.mp4'} h={150} hue={t.hue} />}
          <Field label="Savol matni (ruscha)"><textarea rows={2} placeholder="Опишите..." style={inp} /></Field>
          <Field label="Topshiriq izohi (oʻzbekcha)"><input placeholder="Masalan: 1-2 daqiqa toʻxtovsiz gapiring" style={inp} /></Field>
          <Field label={<div className="row between"><span>Namuna javob</span><button onClick={() => setSample('Я хочу рассказать о… Во-первых, … Кроме того, … В заключение, …')} style={{ border: 'none', background: 'var(--grape-tint)', color: 'var(--grape)', fontWeight: 800, fontFamily: 'var(--font-display)', fontSize: 12.5, padding: '5px 11px', borderRadius: 999, cursor: 'pointer' }} className="row gap-1 tap"><Icon name="sparkles" size={14} />AI yaratsin</button></div>}>
            <textarea rows={3} value={sample} onChange={e => setSample(e.target.value)} placeholder="Namunaviy javob (ixtiyoriy)" style={inp} />
          </Field>
          <div className="g2">
            <Field label="Daraja"><select style={inp}><option>A2</option><option>B1</option><option>B2</option><option>C1</option></select></Field>
            <Field label="Qism"><select style={inp}><option>Part 1</option><option>Part 2</option><option>Part 3</option><option>Shadowing</option></select></Field>
          </div>
        </div>
        <div className="row gap-3 between" style={{ marginTop: 20 }}>
          <Button variant="ghost" onClick={onBack}>Bekor qilish</Button>
          <Button icon="check" onClick={onBack}>Saqlash va tayinlash</Button>
        </div>
      </Card>
    </div>
  );
}
const inp = { width: '100%', border: '1px solid var(--line-2)', borderRadius: 'var(--r-sm)', padding: '11px 13px', fontSize: 14.5, outline: 'none', color: 'var(--ink)', background: 'var(--surface-2)', resize: 'vertical', fontFamily: 'inherit' };
function Field({ label, children }) { return (<label className="col gap-2"><span style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink-soft)' }}>{label}</span>{children}</label>); }

function TeacherAssignments() {
  const [creating, setCreating] = useState(false);
  if (creating) return <CreateQuestion onBack={() => setCreating(false)} />;
  return (
    <div className="focus-wrap">
      <div className="row between wrap gap-4" style={{ marginBottom: 20 }}>
        <div className="col gap-1"><h2 style={{ fontSize: 26 }}>Topshiriqlar</h2><p style={{ color: 'var(--muted)', fontSize: 15 }}>Guruh va oʻquvchilarga muddatli vazifalar</p></div>
        <Button icon="plus" onClick={() => setCreating(true)}>Yangi savol</Button>
      </div>
      <div className="g3">
        {TASKS.map(t => (
          <Card key={t.id} hover pad={0} style={{ overflow: 'hidden' }}>
            <div style={{ padding: 20 }}>
              <div className="row between" style={{ marginBottom: 12 }}><Pill hue={t.hue}>{t.titleUz}</Pill><span style={{ fontSize: 12, color: 'var(--muted)' }} className="row gap-1"><Icon name="calendar" size={14} />2 kun</span></div>
              <h3 style={{ fontSize: 16, lineHeight: 1.35, minHeight: 44 }}>{t.cueRu || t.questions[0]}</h3>
              <div style={{ marginTop: 14 }}><Bar value={63} hue={t.hue} /></div>
              <div className="row between" style={{ marginTop: 10 }}><span className="row gap-2" style={{ fontSize: 13, color: 'var(--muted)' }}><Icon name="users" size={15} />B1 guruh</span><span style={{ fontSize: 13, fontWeight: 800, color: 'var(--success)' }}>24/38 topshirdi</span></div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Groups + detail ---------------- */
function GroupDetail({ group, onBack }) {
  const [tab, setTab] = useState('students');
  return (
    <div className="focus-wrap">
      <Button variant="ghost" size="sm" icon="chevL" onClick={onBack} style={{ marginBottom: 16 }}>Guruhlarga qaytish</Button>
      <div className="row between wrap gap-4" style={{ marginBottom: 18 }}>
        <div className="row gap-3"><div style={{ width: 54, height: 54, borderRadius: 16, background: `linear-gradient(135deg, oklch(0.76 0.13 ${group.hue}), oklch(0.64 0.17 ${group.hue}))`, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="users" size={26} /></div><div className="col"><h2 style={{ fontSize: 23 }}>{group.name}</h2><span style={{ fontSize: 13.5, color: 'var(--muted)' }}>{group.students} oʻquvchi · {group.assignments} topshiriq</span></div></div>
        <SegTabs value={tab} onChange={setTab} tabs={[{ id: 'students', label: 'Ученики', icon: 'users' }, { id: 'tasks', label: 'Задания', icon: 'book' }]} />
      </div>

      {tab === 'students' && (
        <Card pad={0}>
          {group.members.map((m, i) => (
            <div key={i} className="row gap-3" style={{ padding: '13px 20px', borderBottom: i < group.members.length - 1 ? '1px solid var(--line)' : 'none' }}>
              <Avatar name={m.name} size={40} />
              <span className="grow" style={{ fontWeight: 800, fontSize: 14.5 }}>{m.name}</span>
              <Pill hue={bandColor(m.band)} size="sm">{m.band.toFixed(1)}</Pill>
              <span className="row gap-2" style={{ fontSize: 13, fontWeight: 800, color: m.done ? 'var(--success)' : 'var(--danger)' }}>
                <Icon name={m.done ? 'check' : 'x'} size={16} sw={3} />{m.done ? 'Bajardi' : 'Bajarmadi'}
              </span>
            </div>
          ))}
        </Card>
      )}
      {tab === 'tasks' && (
        <div className="g2">
          {TASKS.map(t => (
            <Card key={t.id}>
              <div className="row between" style={{ marginBottom: 10 }}><Pill hue={t.hue} size="sm">{t.titleUz}</Pill><span style={{ fontSize: 12, color: 'var(--muted)' }}>Muddat: 2 kun</span></div>
              <h3 style={{ fontSize: 15.5, lineHeight: 1.35, minHeight: 42 }}>{t.cueRu || t.questions[0]}</h3>
              <div className="row gap-3" style={{ marginTop: 12 }}>
                <div className="grow"><Bar value={[80, 55, 40][TASKS.indexOf(t)] || 50} hue={152} /></div>
                <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--success)' }}>{[10, 7, 5][TASKS.indexOf(t)] || 6}/{group.members.length}</span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function TeacherGroups() {
  const [sel, setSel] = useState(null);
  if (sel) return <GroupDetail group={sel} onBack={() => setSel(null)} />;
  return (
    <div className="focus-wrap">
      <div className="row between wrap gap-4" style={{ marginBottom: 20 }}>
        <div className="col gap-1"><h2 style={{ fontSize: 26 }}>Guruhlar</h2><p style={{ color: 'var(--muted)', fontSize: 15 }}>Guruhni oching — kim bajardi/bajarmadi koʻrinadi</p></div>
        <Button icon="plus">Guruh ochish</Button>
      </div>
      <div className="g3">
        {GROUPS.map(g => (
          <Card key={g.id} hover onClick={() => setSel(g)}>
            <div className="row between" style={{ marginBottom: 14 }}>
              <div style={{ width: 50, height: 50, borderRadius: 15, background: `linear-gradient(135deg, oklch(0.76 0.13 ${g.hue}), oklch(0.64 0.17 ${g.hue}))`, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="users" size={24} /></div>
              <Icon name="chevR" size={20} style={{ color: 'var(--faint)' }} />
            </div>
            <h3 style={{ fontSize: 17 }}>{g.name}</h3>
            <div className="row gap-4" style={{ marginTop: 10, color: 'var(--muted)', fontSize: 13 }}><span className="row gap-1"><Icon name="user" size={15} />{g.students} oʻquvchi</span><span className="row gap-1"><Icon name="book" size={15} />{g.assignments} topshiriq</span></div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Answers (submissions) + grading ---------------- */
function TeacherAnswers({ openAnswer }) {
  const [filter, setFilter] = useState('pending');
  const list = SUBMISSIONS.filter(s => filter === 'all' ? true : s.status === filter);
  return (
    <div className="focus-wrap">
      <div className="col gap-1" style={{ marginBottom: 18 }}><h2 style={{ fontSize: 26 }}>Javoblar</h2><p style={{ color: 'var(--muted)', fontSize: 15 }}>Yozuvlarni tinglang, AI bahosini koʻring va qoʻlda baho qoʻying</p></div>
      <div style={{ marginBottom: 18 }}>
        <SegTabs value={filter} onChange={setFilter} tabs={[{ id: 'pending', label: 'Kutilmoqda', badge: SUBMISSIONS.filter(s => s.status === 'pending').length }, { id: 'reviewed', label: 'Baholangan', badge: SUBMISSIONS.filter(s => s.status === 'reviewed').length }, { id: 'all', label: 'Hammasi' }]} />
      </div>
      <div className="col gap-3">
        {list.map(s => (
          <Card key={s.id} hover pad={16} onClick={() => openAnswer(s)}>
            <div className="row gap-4 wrap">
              <Avatar name={s.student} size={48} />
              <div className="col grow" style={{ minWidth: 150, gap: 3 }}><span style={{ fontWeight: 800, fontSize: 15.5 }}>{s.student}</span><span style={{ fontSize: 13, color: 'var(--muted)' }}>{s.task} · {s.topic}</span></div>
              <span className="row gap-1 t-hide-sm" style={{ fontSize: 13, color: 'var(--muted)' }}><Icon name="clock" size={14} />{fmt(s.dur)}</span>
              {s.status === 'reviewed' ? <Pill hue={bandColor(s.band)} icon="check">{s.band.toFixed(1)}</Pill> : <Pill hue={28}>Kutilmoqda</Pill>}
              <Button size="sm" icon={s.status === 'reviewed' ? 'eye' : 'play'}>{s.status === 'reviewed' ? "Koʻrish" : 'Baholash'}</Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function ReviewDetail({ sub, onBack }) {
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [scores, setScores] = useState(() => Object.fromEntries(CRITERIA.map(c => [c.key, sub.band || c.score])));
  const [note, setNote] = useState(sub.status === 'reviewed' ? 'Yaxshi javob! Fikr ravon. Grammatikaga biroz eʼtibor bering.' : '');
  const [sent, setSent] = useState(sub.status === 'reviewed');
  const timer = useRef(null);
  useEffect(() => { if (playing) timer.current = setInterval(() => setPos(p => { if (p >= sub.dur) { setPlaying(false); return sub.dur; } return p + 1; }), 250); return () => clearInterval(timer.current); }, [playing]);
  const avg = Object.values(scores).reduce((a, b) => a + b, 0) / CRITERIA.length;
  return (
    <div className="focus-wrap" style={{ maxWidth: 900, marginInline: 'auto' }}>
      <Button variant="ghost" size="sm" icon="chevL" onClick={onBack} style={{ marginBottom: 16 }}>Javoblarga qaytish</Button>
      <Card style={{ marginBottom: 16 }}>
        <div className="row gap-4 wrap between">
          <div className="row gap-3"><Avatar name={sub.student} size={52} /><div className="col" style={{ gap: 3 }}><span style={{ fontWeight: 800, fontSize: 18, fontFamily: 'var(--font-display)' }}>{sub.student}</span><span style={{ fontSize: 13.5, color: 'var(--muted)' }}>{sub.task} · {sub.when}</span></div></div>
          <Pill hue={bandColor(sub.autoBand)} icon="sparkles">AI: {sub.autoBand.toFixed(1)}</Pill>
        </div>
        <div style={{ marginTop: 16, padding: 16, background: 'var(--surface-2)', borderRadius: 'var(--r-md)' }}><span style={{ fontSize: 12, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Topshiriq</span><p style={{ fontSize: 17, marginTop: 6 }}>{sub.topic}</p></div>
        <div style={{ marginTop: 16, padding: 16, border: '1px solid var(--line)', borderRadius: 'var(--r-md)' }}>
          <div className="row gap-4">
            <button onClick={() => setPlaying(!playing)} className="tap" style={{ width: 50, height: 50, borderRadius: '50%', border: 'none', background: 'var(--primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: 'var(--sh-primary)' }}><Icon name={playing ? 'pause' : 'play'} size={22} fill={!playing} style={{ marginLeft: playing ? 0 : 2 }} /></button>
            <div className="col grow gap-2" style={{ justifyContent: 'center' }}><Bar value={(pos / sub.dur) * 100} hue={47} height={8} /><div className="row between mono" style={{ fontSize: 12.5, color: 'var(--muted)' }}><span>{fmt(pos)}</span><span>{fmt(sub.dur)}</span></div></div>
            <Icon name="volume" size={20} style={{ color: 'var(--faint)' }} />
          </div>
        </div>
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <div className="row between" style={{ marginBottom: 16 }}>
          <SectionTitle>Qoʻlda baho (AI ni bekor qiladi)</SectionTitle>
          <div className="row gap-2" style={{ background: `oklch(0.95 0.05 ${bandColor(avg)})`, padding: '6px 14px', borderRadius: 'var(--r-pill)' }}><span style={{ fontSize: 12.5, color: 'var(--muted)', fontWeight: 700 }}>Umumiy</span><span style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 19, color: `oklch(0.48 0.15 ${bandColor(avg)})` }}>{avg.toFixed(1)}</span></div>
        </div>
        <div className="col gap-5">
          {CRITERIA.map(c => (
            <div key={c.key} className="col gap-2">
              <div className="row between"><span style={{ fontSize: 14.5, fontWeight: 600 }}>{c.uz} <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>· {c.ru}</span></span><span style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 16, color: `oklch(0.5 0.15 ${bandColor(scores[c.key])})` }}>{scores[c.key].toFixed(1)}</span></div>
              <div className="row gap-1">
                {[4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9].map(v => (
                  <button key={v} onClick={() => setScores({ ...scores, [c.key]: v })} className="tap" style={{ flex: 1, height: 30, borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 800, fontFamily: 'var(--font-display)', background: scores[c.key] === v ? `oklch(0.68 0.16 ${bandColor(v)})` : 'var(--surface-2)', color: scores[c.key] === v ? '#fff' : 'var(--muted)' }}>{v}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <SectionTitle>Fikr-mulohaza</SectionTitle>
        <textarea value={note} onChange={e => { setNote(e.target.value); setSent(false); }} placeholder="Oʻquvchiga izoh yozing... (oʻzbek yoki rus tilida)" rows={4} style={inp} />
        <div className="row between wrap gap-3" style={{ marginTop: 14 }}>
          <div className="row gap-2 wrap">
            {['Ajoyib ish! 👍', 'Rod kelishigiga eʼtibor bering', 'Koʻproq misol keltiring'].map((q, i) => (
              <button key={i} onClick={() => { setNote(note ? note + ' ' + q : q); setSent(false); }} className="tap" style={{ padding: '6px 12px', borderRadius: 'var(--r-pill)', border: '1px dashed var(--line-2)', background: 'transparent', color: 'var(--ink-soft)', fontSize: 12.5, cursor: 'pointer' }}>+ {q}</button>
            ))}
          </div>
          <Button variant={sent ? 'success' : 'primary'} icon={sent ? 'check' : 'send'} onClick={() => setSent(true)}>{sent ? 'Yuborildi' : 'Bahoni yuborish'}</Button>
        </div>
      </Card>
    </div>
  );
}

/* ---------------- Gradebook + CSV ---------------- */
function exportCSV() {
  const head = ['Oʻquvchi', ...GRADEBOOK.cols, "Oʻrtacha"];
  const lines = [head.join(',')];
  GRADEBOOK.rows.forEach(r => {
    const valid = r.scores.filter(s => s != null);
    const avg = valid.length ? (valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(1) : '';
    lines.push([r.name, ...r.scores.map(s => s == null ? '' : s.toFixed(1)), avg].join(','));
  });
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'govori-jurnal.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function TeacherGradebook() {
  const gridCols = `2fr repeat(${GRADEBOOK.cols.length}, 0.8fr) 0.9fr`;
  return (
    <div className="focus-wrap">
      <div className="row between wrap gap-4" style={{ marginBottom: 20 }}>
        <div className="col gap-1"><h2 style={{ fontSize: 26 }}>Jurnal</h2><p style={{ color: 'var(--muted)', fontSize: 15 }}>Sinf jurnali, ballar va eksport</p></div>
        <Button variant="ghost" icon="arrowDown" onClick={exportCSV}>CSV eksport</Button>
      </div>
      <Card pad={0} style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 560 }}>
          <div className="t-head" style={{ display: 'grid', gridTemplateColumns: gridCols, padding: '14px 20px', borderBottom: '1px solid var(--line)', fontSize: 12, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            <span>Oʻquvchi</span>{GRADEBOOK.cols.map(c => <span key={c} style={{ textAlign: 'center' }}>{c}</span>)}<span style={{ textAlign: 'center' }}>Oʻrt.</span>
          </div>
          {GRADEBOOK.rows.map((r, i) => {
            const valid = r.scores.filter(s => s != null);
            const avg = valid.reduce((a, b) => a + b, 0) / valid.length;
            return (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: gridCols, padding: '12px 20px', borderBottom: i < GRADEBOOK.rows.length - 1 ? '1px solid var(--line)' : 'none', alignItems: 'center' }}>
                <div className="row gap-3" style={{ minWidth: 0 }}><Avatar name={r.name} size={34} /><span style={{ fontWeight: 700, fontSize: 14 }} className="truncate">{r.name}</span></div>
                {r.scores.map((s, j) => (
                  <span key={j} style={{ textAlign: 'center', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 14, color: s == null ? 'var(--faint)' : `oklch(0.5 0.15 ${bandColor(s)})` }}>{s == null ? '—' : s.toFixed(1)}</span>
                ))}
                <span style={{ textAlign: 'center' }}><Pill hue={bandColor(avg)} size="sm">{avg.toFixed(1)}</Pill></span>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

Object.assign(window, { TeacherOverview, TeacherAssignments, CreateQuestion, TeacherGroups, GroupDetail, TeacherAnswers, ReviewDetail, TeacherGradebook });
