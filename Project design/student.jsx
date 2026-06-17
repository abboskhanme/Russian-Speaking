/* ============================================================
   GOVORI — Student screens v2
   ============================================================ */

const RECENT = [
  { task: 'Part 2 — Cue card', topic: 'Любимая книга', band: 6.0, when: 'Bugun', hue: 47 },
  { task: 'Part 1 — Intervyu', topic: 'Свободное время', band: 6.5, when: 'Kecha', hue: 152 },
  { task: 'Shadowing', topic: 'Повседневные фразы', band: 8.0, when: '2 kun', hue: 80 },
];

/* ---------------- Home (cozy focus) ---------------- */
function StudentHome({ startTask, go, attempts }) {
  const u = STUDENT;
  const daily = TASKS.find(t => t.id === DAILY.taskId);
  return (
    <div className="col gap-5 focus-wrap">
      {/* Focus card */}
      <Card pad={0} style={{ overflow: 'hidden' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 460px', padding: '30px 32px', background: 'linear-gradient(135deg, oklch(0.75 0.15 56), oklch(0.64 0.19 38))', color: '#fff', position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 22 }}>
            <div style={{ position: 'absolute', right: -50, bottom: -60, width: 220, height: 220, borderRadius: '50%', background: 'oklch(1 0 0 / 0.1)' }} />
            <div className="hide-sm" style={{ flexShrink: 0 }}><Mascot size={108} mood="happy" /></div>
            <div className="col">
              <span style={{ fontSize: 14, opacity: 0.92 }}>Salom, {u.short}! 👋</span>
              <h2 style={{ color: '#fff', fontSize: 26, marginTop: 6, lineHeight: 1.2 }}>Bugungi savolga javob beramizmi?</h2>
              <div className="row gap-3" style={{ marginTop: 16 }}>
                <div className="row gap-2" style={{ background: 'oklch(1 0 0 / 0.18)', borderRadius: 999, padding: '7px 13px' }}><Icon name="flame" size={17} /><span style={{ fontWeight: 800, fontSize: 14 }}>{u.streak} kun</span></div>
                <div className="row gap-2" style={{ background: 'oklch(1 0 0 / 0.18)', borderRadius: 999, padding: '7px 13px' }}><Icon name="sparkles" size={17} /><span style={{ fontWeight: 800, fontSize: 14 }}>{u.points.toLocaleString()} XP</span></div>
              </div>
            </div>
          </div>
          <div style={{ flex: '1 1 320px', padding: '24px 28px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div className="row between" style={{ marginBottom: 4 }}>
              <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{DAILY.titleUz}</span>
              <Pill hue={47} size="sm" icon="sparkles">+{DAILY.xp} XP</Pill>
            </div>
            <h3 style={{ fontSize: 19, marginTop: 8 }}>{DAILY.promptUz}</h3>
            <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: 4 }}>{DAILY.promptRu}</p>
            <Button style={{ marginTop: 18 }} icon="mic" onClick={() => startTask(daily)}>Javob berishni boshlash</Button>
            {!attempts.premium && <div className="row gap-2" style={{ marginTop: 12, justifyContent: 'center' }}><AttemptDots used={attempts.used} total={attempts.total} /><span style={{ fontSize: 12, color: 'var(--faint)' }}>{attempts.total - attempts.used} ta bepul urinish qoldi</span></div>}
          </div>
        </div>
      </Card>

      {/* Stats */}
      <div className="g3">
        {[
          { uz: 'Joriy band', val: u.band.toFixed(1), sub: `Maqsad ${u.goalBand.toFixed(1)}`, icon: 'target', hue: 47 },
          { uz: 'Kunlik seriya', val: u.streak, sub: '❄️ muzlatish bor', icon: 'flame', hue: 28 },
          { uz: 'Reyting', val: '#' + u.rank, sub: 'guruhda', icon: 'trophy', hue: 80 },
        ].map((s, i) => (
          <Card key={i} pad={18}>
            <div className="row between">
              <div style={{ width: 40, height: 40, borderRadius: 12, background: `oklch(0.94 0.06 ${s.hue})`, color: `oklch(0.5 0.15 ${s.hue})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={s.icon} size={21} /></div>
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 28, lineHeight: 1, marginTop: 12 }}>{s.val}</div>
            <div style={{ fontSize: 13, color: 'var(--ink-soft)', fontWeight: 700, marginTop: 5 }}>{s.uz}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{s.sub}</div>
          </Card>
        ))}
      </div>

      {/* Recent + assignments */}
      <div className="split">
        <Card>
          <SectionTitle action={<Button variant="soft" size="sm" iconR="chevR" onClick={() => go('practice')}>Praktika</Button>}>Soʻnggi javoblar</SectionTitle>
          <div className="col gap-2">
            {RECENT.map((r, i) => (
              <div key={i} className="row gap-3" style={{ padding: 12, borderRadius: 'var(--r-sm)', background: 'var(--surface-2)' }}>
                <div style={{ width: 42, height: 42, borderRadius: 12, background: `oklch(0.94 0.06 ${r.hue})`, color: `oklch(0.5 0.15 ${r.hue})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="mic" size={19} /></div>
                <div className="col grow" style={{ minWidth: 0 }}><span style={{ fontWeight: 800, fontSize: 14.5 }} className="truncate">{r.task}</span><span style={{ fontSize: 12.5, color: 'var(--muted)' }} className="truncate">{r.topic} · {r.when}</span></div>
                <Pill hue={bandColor(r.band)} size="sm">{r.band.toFixed(1)}</Pill>
              </div>
            ))}
          </div>
        </Card>
        <div className="col gap-5">
          <Card>
            <SectionTitle>Kunlik maqsad</SectionTitle>
            <div className="row gap-4">
              <Ring value={66} size={86} sw={10} hue={152}><div className="col" style={{ alignItems: 'center' }}><span style={{ fontWeight: 900, fontFamily: 'var(--font-display)', fontSize: 18 }}>2/3</span></div></Ring>
              <div className="col" style={{ justifyContent: 'center', gap: 4 }}>
                <span style={{ fontSize: 14.5, fontWeight: 800 }}>Yana 1 ta mashq</span>
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>Seriyani saqlash uchun</span>
              </div>
            </div>
          </Card>
          <Card style={{ background: 'var(--info-tint)', borderColor: 'oklch(0.85 0.06 248)' }}>
            <div className="row gap-3" style={{ alignItems: 'flex-start' }}>
              <div style={{ width: 38, height: 38, borderRadius: 11, background: 'var(--surface)', color: 'var(--info)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="calendar" size={19} /></div>
              <div className="col"><span style={{ fontWeight: 800, fontSize: 14.5 }}>Oʻqituvchi topshirigʼi</span><span style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 2 }}>Part 3 — «Технологии». Muddat: 2 kun.</span><button onClick={() => go('assignments')} style={{ marginTop: 8, alignSelf: 'flex-start', border: 'none', background: 'transparent', color: 'var(--info)', fontWeight: 800, fontFamily: 'var(--font-display)', fontSize: 13.5, padding: 0, cursor: 'pointer' }}>Bajarish →</button></div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Shadowing ---------------- */
function Shadowing() {
  const [sel, setSel] = useState(0);
  const [phase, setPhase] = useState('idle'); // idle | playing | rec | done
  const [score, setScore] = useState(null);
  const p = SHADOW[sel];
  const play = () => { setPhase('playing'); setTimeout(() => setPhase('idle'), 1600); };
  const rec = () => { setPhase('rec'); setTimeout(() => { setScore(82 + Math.floor(Math.random() * 14)); setPhase('done'); }, 1800); };
  const pick = i => { setSel(i); setPhase('idle'); setScore(null); };
  return (
    <div className="split">
      <Card>
        <SectionTitle>Iboralar</SectionTitle>
        <div className="col gap-2">
          {SHADOW.map((s, i) => (
            <button key={i} onClick={() => pick(i)} className="tap" style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: 13, borderRadius: 'var(--r-sm)', textAlign: 'left',
              border: '1px solid', borderColor: sel === i ? 'oklch(0.78 0.12 80)' : 'var(--line)', background: sel === i ? 'var(--amber-tint)' : 'var(--surface)', cursor: 'pointer',
            }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--surface-2)', color: 'var(--ink-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="headphones" size={18} /></div>
              <div className="col grow" style={{ minWidth: 0 }}><span style={{ fontWeight: 700, fontSize: 14 }} className="truncate">{s.ru}</span><span style={{ fontSize: 12, color: 'var(--muted)' }} className="truncate">{s.uz}</span></div>
              {s.pron != null && <Pill hue={s.pron >= 85 ? 152 : 80} size="sm">{s.pron}%</Pill>}
            </button>
          ))}
        </div>
      </Card>

      <Card style={{ textAlign: 'center' }}>
        <Pill hue={80} icon="volume">Eshit va takrorla</Pill>
        <h2 style={{ fontSize: 24, marginTop: 16, lineHeight: 1.3 }}>{p.ru}</h2>
        <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: 6 }}>{p.uz}</p>

        {/* speaker / waveform */}
        <div style={{ margin: '22px 0' }}>
          {phase === 'rec' ? <Waveform active /> : (
            <div className="row center gap-1" style={{ height: 60 }}>
              {Array.from({ length: 28 }).map((_, i) => (
                <span key={i} style={{ width: 4, borderRadius: 999, background: phase === 'playing' ? 'oklch(0.7 0.13 80)' : 'var(--line-2)', height: `${14 + Math.abs(Math.sin(i)) * 30}px`, animation: phase === 'playing' ? `bars ${0.5 + (i % 4) * 0.1}s ease-in-out ${i * 0.03}s infinite` : 'none' }} />
              ))}
            </div>
          )}
        </div>

        {phase === 'done' ? (
          <div className="anim-pop">
            {score >= 90 && <Confetti count={50} />}
            <Ring value={score} size={96} sw={10} hue={score >= 85 ? 152 : 80}><div className="col" style={{ alignItems: 'center' }}><span style={{ fontWeight: 900, fontFamily: 'var(--font-display)', fontSize: 26, color: `oklch(0.5 0.14 ${score >= 85 ? 152 : 80})` }}>{score}</span><span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 800 }}>TALAFFUZ</span></div></Ring>
            <p style={{ fontSize: 14, color: 'var(--ink-soft)', marginTop: 10 }}>{score >= 90 ? 'Mukammal! 🎉' : 'Yaxshi! Yana bir bor urinib koʻring.'}</p>
            <div className="row gap-2 center" style={{ marginTop: 16 }}><Button variant="ghost" size="sm" icon="refresh" onClick={rec}>Qayta</Button><Button size="sm" iconR="chevR" onClick={() => pick((sel + 1) % SHADOW.length)}>Keyingi</Button></div>
          </div>
        ) : (
          <div className="row gap-3 center">
            <Button variant="soft" icon="play" onClick={play} disabled={phase === 'rec'}>Eshitish</Button>
            <button onClick={rec} disabled={phase !== 'idle'} className="tap" style={recBtn(phase === 'rec')}>
              {phase === 'rec' ? <span style={{ width: 24, height: 24, borderRadius: 7, background: '#fff' }} /> : <Icon name="mic" size={30} style={{ color: '#fff' }} />}
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ---------------- Review (SRS) ---------------- */
function ReviewSession() {
  const [done, setDone] = useState({});
  const dueCount = REVIEW_ITEMS.filter((_, i) => !done[i]).length;
  return (
    <div className="focus-wrap">
      <Card style={{ marginBottom: 18, background: 'linear-gradient(135deg, oklch(0.96 0.04 305), var(--surface))', borderColor: 'oklch(0.86 0.07 305)' }}>
        <div className="row gap-4 wrap between">
          <div className="row gap-3"><Mascot size={56} mood="thinking" float={false} /><div className="col"><h3 style={{ fontSize: 19 }}>Takrorlash (SRS)</h3><span style={{ fontSize: 13.5, color: 'var(--muted)' }}>Zaif koʻnikmalar interval boʻyicha takrorlanadi</span></div></div>
          <Pill hue={305}>{dueCount} ta bugun</Pill>
        </div>
      </Card>
      <div className="g2">
        {REVIEW_ITEMS.map((r, i) => (
          <Card key={i} style={{ opacity: done[i] ? 0.6 : 1 }}>
            <div className="row between" style={{ marginBottom: 10 }}>
              <Pill hue={r.hue} size="sm">{r.skill}</Pill>
              <span style={{ fontSize: 12.5, color: 'var(--muted)' }} className="row gap-1"><Icon name="clock" size={14} />{r.due}</span>
            </div>
            <h3 style={{ fontSize: 16.5, lineHeight: 1.35 }}>{r.uz}</h3>
            <div className="row between" style={{ marginTop: 14 }}>
              <span style={{ fontSize: 12.5, color: 'var(--faint)' }}>Takror: {r.reps}/5</span>
              {done[i] ? <Pill hue={152} size="sm" icon="check">Bajarildi</Pill> : <Button size="sm" icon="refresh" onClick={() => setDone({ ...done, [i]: true })}>Mashq qilish</Button>}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Practice hub ---------------- */
function StudentPractice({ startTask }) {
  const { t } = useT();
  const [tab, setTab] = useState('questions');
  return (
    <div className="focus-wrap">
      <div className="row between wrap gap-4" style={{ marginBottom: 18 }}>
        <div className="col gap-1"><h2 style={{ fontSize: 26 }}>{t('practice')}</h2><p style={{ color: 'var(--muted)', fontSize: 15 }}>Savollarga javob bering, takrorlang, talaffuzni mashq qiling</p></div>
        <SegTabs value={tab} onChange={setTab} tabs={[{ id: 'questions', label: 'Savollar', icon: 'mic' }, { id: 'shadow', label: 'Shadowing', icon: 'headphones' }, { id: 'review', label: 'Takrorlash', icon: 'refresh', badge: REVIEW_ITEMS.filter(r => r.due === 'Bugun').length }]} />
      </div>

      {tab === 'questions' && (
        <div className="g3">
          {TASKS.map(t2 => (
            <Card key={t2.id} hover pad={0} onClick={() => startTask(t2)} style={{ overflow: 'hidden' }}>
              <div style={{ height: 92, background: `linear-gradient(135deg, oklch(0.74 0.13 ${t2.hue}), oklch(0.64 0.17 ${t2.hue}))`, position: 'relative', display: 'flex', alignItems: 'center', padding: '0 22px' }}>
                <div style={{ position: 'absolute', right: -20, top: -20, width: 110, height: 110, borderRadius: '50%', background: 'oklch(1 0 0 / 0.12)' }} />
                <div style={{ width: 50, height: 50, borderRadius: 15, background: 'oklch(1 0 0 / 0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}><Icon name={t2.kind === 'interview' ? 'message' : t2.kind === 'cue' ? 'flag' : 'users'} size={25} /></div>
                <span style={{ position: 'absolute', top: 12, right: 16, fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 40, color: 'oklch(1 0 0 / 0.3)' }}>{t2.part}</span>
              </div>
              <div style={{ padding: 20 }}>
                <div className="row between" style={{ marginBottom: 8 }}><span style={{ fontWeight: 800, fontFamily: 'var(--font-display)', fontSize: 17 }}>{t2.titleUz}</span><Pill hue={t2.hue} size="sm">{t2.difficulty}</Pill></div>
                <p style={{ color: 'var(--muted)', fontSize: 13.5, lineHeight: 1.5, minHeight: 40 }}>{t2.descUz}</p>
                <div className="row between" style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)' }}><span className="row gap-2" style={{ color: 'var(--ink-soft)', fontSize: 13 }}><Icon name="clock" size={15} />~{Math.round(t2.durationSec / 60)} daq</span><span className="row gap-2" style={{ color: `oklch(0.55 0.15 ${t2.hue})`, fontSize: 13, fontWeight: 800 }}><Icon name="sparkles" size={15} />+{t2.xp} XP</span></div>
              </div>
            </Card>
          ))}
        </div>
      )}
      {tab === 'shadow' && <Shadowing />}
      {tab === 'review' && <ReviewSession />}
    </div>
  );
}

/* ---------------- Progress hub ---------------- */
function StudentProgress() {
  const { t } = useT();
  const radarData = CRITERIA.map(c => ({ short: c.uz.split(' ')[0], score: c.score }));
  const trend = PROGRESS.map(p => p.band);
  const got = ACHIEVEMENTS.filter(a => a.got).length;
  return (
    <div className="col gap-5 focus-wrap">
      <div className="col gap-1"><h2 style={{ fontSize: 26 }}>{t('progress')}</h2><p style={{ color: 'var(--muted)', fontSize: 15 }}>Koʻnikmalar, ball trendi va yutuqlar</p></div>

      <div className="split">
        <Card>
          <SectionTitle>Koʻnikmalar (radar)</SectionTitle>
          <div className="row" style={{ justifyContent: 'center', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
            <RadarChart data={radarData} size={250} />
            <div className="col gap-3" style={{ minWidth: 160 }}>
              {CRITERIA.map(c => { const ch = bandColor(c.score); return (
                <div key={c.key} className="row gap-3" style={{ alignItems: 'center' }}><span style={{ width: 10, height: 10, borderRadius: 3, background: `oklch(0.68 0.16 ${ch})`, flexShrink: 0 }} /><span className="grow" style={{ fontSize: 13.5, fontWeight: 600 }}>{c.uz}</span><span style={{ fontWeight: 900, fontFamily: 'var(--font-display)', color: `oklch(0.5 0.15 ${ch})` }}>{c.score.toFixed(1)}</span></div>
              ); })}
            </div>
          </div>
        </Card>
        <div className="col gap-5">
          <Card style={{ textAlign: 'center' }}>
            <SectionTitle>Umumiy band</SectionTitle>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <Ring value={(STUDENT.band / 9) * 100} size={120} sw={12} hue={bandColor(STUDENT.band)}><div className="col" style={{ alignItems: 'center' }}><span style={{ fontWeight: 900, fontFamily: 'var(--font-display)', fontSize: 30 }}>{STUDENT.band.toFixed(1)}</span><span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>/ {STUDENT.goalBand.toFixed(1)} maqsad</span></div></Ring>
            </div>
          </Card>
          <Card>
            <div className="row between" style={{ marginBottom: 10 }}><span style={{ fontSize: 14, fontWeight: 800, fontFamily: 'var(--font-display)' }}>Ball trendi</span><Pill hue={152} size="sm" icon="arrowUp">+1.5</Pill></div>
            <div className="row between" style={{ alignItems: 'flex-end' }}>
              <Sparkline data={trend} w={150} h={48} />
              <div className="col" style={{ alignItems: 'flex-end' }}><span style={{ fontSize: 12, color: 'var(--muted)' }}>8 hafta</span><span style={{ fontWeight: 900, fontFamily: 'var(--font-display)', fontSize: 18 }}>5.0 → 6.5</span></div>
            </div>
          </Card>
        </div>
      </div>

      {/* Achievements */}
      <Card>
        <SectionTitle action={<Pill hue={80} size="sm" icon="award">{got}/{ACHIEVEMENTS.length}</Pill>}>Yutuqlar</SectionTitle>
        <div className="g4" style={{ gap: 14 }}>
          {ACHIEVEMENTS.map(a => (
            <div key={a.id} className="col" style={{ alignItems: 'center', textAlign: 'center', gap: 8, padding: 16, borderRadius: 'var(--r-md)', background: a.got ? `oklch(0.97 0.03 ${a.hue})` : 'var(--surface-2)' }}>
              <div style={{ width: 54, height: 54, borderRadius: '50%', background: a.got ? `oklch(0.93 0.08 ${a.hue})` : 'var(--surface-3)', color: a.got ? `oklch(0.55 0.16 ${a.hue})` : 'var(--faint)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: a.got ? `2px solid oklch(0.7 0.14 ${a.hue})` : '2px dashed var(--line-2)', position: 'relative' }}>
                <Icon name={a.got ? a.icon : 'lock'} size={23} fill={a.got && (a.icon === 'star' || a.icon === 'flame')} />
              </div>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink-soft)', lineHeight: 1.3 }}>{a.uz}</span>
              {a.got ? <span style={{ fontSize: 11, color: 'var(--faint)' }}>{a.date}</span> : <div style={{ width: '70%' }}><Bar value={a.prog} hue={a.hue} height={5} /></div>}
            </div>
          ))}
        </div>
      </Card>

      {/* Soft leaderboard (neighbors) */}
      <Card>
        <SectionTitle action={<span style={{ fontSize: 12.5, color: 'var(--muted)' }}>Yumshoq — atrofingizdagilar</span>}>Haftalik reyting</SectionTitle>
        <div className="col gap-1">
          {LEADERBOARD.slice(2, 6).map((p, i) => (
            <div key={i} className="row gap-3" style={{ padding: '11px 12px', borderRadius: 'var(--r-sm)', background: p.you ? 'var(--primary-tint)' : 'transparent' }}>
              <span style={{ width: 22, textAlign: 'center', fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 14, color: 'var(--muted)' }}>{i + 3}</span>
              <Avatar name={p.name} size={36} />
              <div className="col grow" style={{ minWidth: 0 }}><span style={{ fontSize: 14, fontWeight: 800 }} className="truncate">{p.name}{p.you && <span style={{ color: 'var(--primary)' }}> (siz)</span>}</span><span className="row gap-1" style={{ fontSize: 12, color: 'var(--muted)' }}><Icon name="flame" size={12} style={{ color: 'oklch(0.65 0.16 28)' }} />{p.streak} kun</span></div>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 15 }}>{p.pts.toLocaleString()}<span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}> XP</span></span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

Object.assign(window, { StudentHome, StudentPractice, StudentProgress, Shadowing, ReviewSession });
