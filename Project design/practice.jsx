/* ============================================================
   GOVORI — Answer flow, Result v2, Paywall
   ============================================================ */

function fmt(s) { const m = Math.floor(s / 60), ss = s % 60; return `${m}:${ss.toString().padStart(2, '0')}`; }
function bandColor(b) { return b >= 7 ? 152 : b >= 6 ? 80 : b >= 5 ? 47 : 28; }

function Waveform({ active, bars = 44 }) {
  return (
    <div className="row" style={{ gap: 3, height: 60, alignItems: 'center', justifyContent: 'center' }}>
      {Array.from({ length: bars }).map((_, i) => (
        <span key={i} style={{
          width: 4, borderRadius: 999, background: active ? 'var(--primary)' : 'var(--line-2)',
          height: active ? `${18 + Math.abs(Math.sin(i * 0.9)) * 38}px` : '6px', transformOrigin: 'center', transition: 'background .3s',
          animation: active ? `bars ${0.5 + (i % 5) * 0.12}s ease-in-out ${i * 0.03}s infinite` : 'none',
        }} />
      ))}
    </div>
  );
}

function recBtn(recording) {
  return {
    width: 88, height: 88, borderRadius: '50%', border: 'none', cursor: 'pointer',
    background: recording ? 'var(--danger)' : 'linear-gradient(140deg, oklch(0.76 0.17 55), oklch(0.65 0.19 40))',
    display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto',
    boxShadow: recording ? '0 6px 22px oklch(0.64 0.16 18 / 0.45)' : 'var(--sh-pop)',
    animation: recording ? 'pulseRing 1.6s infinite' : 'none', transition: 'transform .12s',
  };
}

/* ---------------- Answer flow ---------------- */
function AnswerFlow({ task, onExit, onDone }) {
  const isCue = task.kind === 'cue';
  const isMulti = task.questions && task.questions.length > 1;
  const [phase, setPhase] = useState(isCue ? 'prep' : 'ready');
  const [qi, setQi] = useState(0);
  const [prep, setPrep] = useState(task.prepSec || 0);
  const [sec, setSec] = useState(0);
  const timer = useRef(null);

  useEffect(() => {
    if (phase !== 'prep') return;
    const id = setInterval(() => setPrep(p => { if (p <= 1) { clearInterval(id); setPhase('ready'); return 0; } return p - 1; }), 1000);
    return () => clearInterval(id);
  }, [phase]);
  useEffect(() => { if (phase === 'rec') timer.current = setInterval(() => setSec(s => s + 1), 1000); return () => clearInterval(timer.current); }, [phase]);

  const startRec = () => { setSec(0); setPhase('rec'); };
  const stopRec = () => {
    clearInterval(timer.current);
    if (isMulti && qi < task.questions.length - 1) { setQi(qi + 1); setSec(0); setPhase('ready'); return; }
    setPhase('analyzing');
    setTimeout(() => onDone(), 2800);
  };
  const questions = task.questions || [];
  const progressPct = isMulti ? ((qi + (phase === 'rec' ? 0.5 : 0)) / questions.length) * 100 : 0;

  return (
    <div className="focus-wrap" style={{ maxWidth: 820, marginInline: 'auto' }}>
      <div className="row between" style={{ marginBottom: 18 }}>
        <Button variant="ghost" size="sm" icon="chevL" onClick={onExit}>Chiqish</Button>
        <Pill hue={task.hue}>{task.titleUz}</Pill>
      </div>

      {isMulti && (
        <div style={{ marginBottom: 18 }}>
          <div className="row between" style={{ marginBottom: 7 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink-soft)' }}>Savol {qi + 1} / {questions.length}</span>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>{Math.round(progressPct)}%</span>
          </div>
          <Bar value={progressPct} hue={task.hue} />
        </div>
      )}

      <Card pad={0} style={{ overflow: 'hidden', marginBottom: 20 }}>
        <div style={{ padding: '26px 28px', background: `linear-gradient(135deg, oklch(0.97 0.03 ${task.hue}), var(--surface))` }}>
          {isCue ? (
            <>
              <div className="row gap-2" style={{ marginBottom: 12 }}><Icon name="flag" size={18} style={{ color: `oklch(0.6 0.15 ${task.hue})` }} /><span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Cue card</span></div>
              <h2 style={{ fontSize: 24, lineHeight: 1.25 }}>{task.cueRu}</h2>
              <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: 6, fontStyle: 'italic' }}>{task.cueUz}</p>
              <div className="col gap-2" style={{ marginTop: 16 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink-soft)' }}>Quyidagilarni yoriting:</span>
                {task.bullets.map((b, i) => (
                  <div key={i} className="row gap-3" style={{ alignItems: 'flex-start' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: `oklch(0.65 0.16 ${task.hue})`, marginTop: 9, flexShrink: 0 }} />
                    <span style={{ fontSize: 16, color: 'var(--ink)' }}>{b}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="row gap-2" style={{ marginBottom: 12 }}><Icon name="message" size={18} style={{ color: `oklch(0.6 0.15 ${task.hue})` }} /><span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Savol</span></div>
              <h2 style={{ fontSize: 25, lineHeight: 1.3 }} key={qi}>{questions[qi]}</h2>
            </>
          )}
        </div>
      </Card>

      {phase === 'prep' && (
        <Card style={{ textAlign: 'center' }}>
          <Mascot size={72} mood="thinking" />
          <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: 4 }}>Tayyorlaning... fikrlaringizni jamlang</p>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 54, color: 'var(--primary)', margin: '4px 0' }}>{fmt(prep)}</div>
          <Button variant="soft" size="sm" onClick={() => { setPrep(0); setPhase('ready'); }}>Tayyorman</Button>
        </Card>
      )}
      {phase === 'ready' && (
        <Card style={{ textAlign: 'center' }}>
          <Waveform active={false} />
          <p style={{ color: 'var(--muted)', fontSize: 14, margin: '14px 0 18px' }}>Tayyor boʻlsangiz, mikrofonni bosing</p>
          <button onClick={startRec} className="tap" style={recBtn(false)}><Icon name="mic" size={34} style={{ color: '#fff' }} /></button>
          <p style={{ fontSize: 13, color: 'var(--faint)', marginTop: 14 }}>Xato qilsangiz ham mayli — qayta urinish bepul 😊</p>
        </Card>
      )}
      {phase === 'rec' && (
        <Card style={{ textAlign: 'center' }}>
          <div className="row center gap-2" style={{ marginBottom: 8 }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--danger)' }} className="floaty" />
            <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--danger)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Yozilmoqda</span>
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 44, color: 'var(--ink)' }} className="mono">{fmt(sec)}</div>
          <div style={{ margin: '12px 0 20px' }}><Waveform active={true} /></div>
          <button onClick={stopRec} className="tap" style={recBtn(true)}><span style={{ width: 26, height: 26, borderRadius: 7, background: '#fff' }} /></button>
          <p style={{ fontSize: 13, color: 'var(--faint)', marginTop: 14 }}>{isMulti && qi < questions.length - 1 ? 'Toʻxtatib, keyingi savolga oʻting' : 'Toʻxtatish va tahlilga yuborish'}</p>
        </Card>
      )}
      {phase === 'analyzing' && (
        <Card style={{ textAlign: 'center', padding: 40 }}>
          <Mascot size={88} mood="thinking" />
          <h3 style={{ fontSize: 21, marginTop: 10 }}>AI tinglayapti...</h3>
          <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: 6 }}>Talaffuz, grammatika, lugʻat va ravonlik baholanmoqda</p>
          <div className="col gap-2" style={{ maxWidth: 300, margin: '20px auto 0' }}>
            {['Ovoz matnga aylantirilmoqda', 'Har bir soʻz talaffuzi tekshirilmoqda', 'Ball hisoblanmoqda'].map((s, i) => (
              <div key={i} className="row gap-3 anim-fade-in" style={{ animationDelay: `${i * 0.7}s`, fontSize: 13.5, color: 'var(--ink-soft)', justifyContent: 'flex-start' }}>
                <Icon name="check" size={16} style={{ color: 'var(--success)' }} sw={3} />{s}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

/* ---------------- Pronunciation legend + transcript ---------------- */
const PRON_MAP = {
  good: { bg: 'var(--pron-good-bg)', fg: 'var(--pron-good)' },
  mid: { bg: 'var(--pron-mid-bg)', fg: 'var(--pron-mid)' },
  low: { bg: 'var(--pron-low-bg)', fg: 'var(--pron-low)' },
};
function WordTranscript({ words }) {
  return (
    <p style={{ fontSize: 19, lineHeight: 2.0, color: 'var(--ink)' }}>
      {words.map((seg, i) => {
        const c = PRON_MAP[seg.pron] || PRON_MAP.good;
        const underline = seg.issue ? `underline wavy ${seg.issue === 'grammar' ? 'var(--danger)' : 'var(--grape)'}` : 'none';
        return (
          <span key={i} title={seg.note || ''} style={{
            background: c.bg, color: c.fg, borderRadius: 6, padding: '2px 5px', margin: '0 1.5px',
            textDecoration: underline, textUnderlineOffset: 3, fontWeight: 700, cursor: seg.note ? 'help' : 'default',
            display: 'inline-block',
          }}>{seg.w}</span>
        );
      })}
    </p>
  );
}

/* ---------------- Result v2 ---------------- */
function ResultV2({ task, attempts, onRetry, onContinue, onUpgrade }) {
  const fb = AI_FEEDBACK;
  const hue = bandColor(fb.band);
  const [showAllCorr, setShowAllCorr] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);

  const corrections = [
    ...fb.improve,
    { uz: 'Soʻz boyligini kengaytiring', ru: '«хороший» → «увлекательный»', sev: 'lexical' },
    { uz: 'Fikrni misol bilan asoslang', ru: 'например, по-моему...', sev: 'fluency' },
  ];
  const shown = showAllCorr ? corrections : corrections.slice(0, 3);
  const noAttemptsLeft = !attempts.premium && (attempts.total - attempts.used) <= 0;

  return (
    <div className="focus-wrap" style={{ maxWidth: 880, marginInline: 'auto' }}>
      <Confetti />
      {/* Celebration header */}
      <Card pad={0} style={{ overflow: 'hidden', marginBottom: 18 }}>
        <div style={{ padding: '28px 30px', background: `linear-gradient(135deg, oklch(0.96 0.045 ${hue}), var(--surface))` }}>
          <div className="row between wrap gap-4">
            <div className="row gap-4" style={{ alignItems: 'center' }}>
              <Mascot size={84} mood="celebrate" />
              <div className="col gap-1">
                <Pill hue={task.hue} icon="check">Yakunlandi</Pill>
                <h2 style={{ fontSize: 25, marginTop: 4 }}>Zoʻr ish! 🎉</h2>
                <p style={{ color: 'var(--muted)', fontSize: 14 }}>{task.titleUz} · {fmt(fb.durationSec)} · {fb.wordsPerMin} soʻz/daq</p>
              </div>
            </div>
            <div className="row gap-4" style={{ alignItems: 'center' }}>
              <Ring value={(fb.band / 9) * 100} size={108} sw={11} hue={hue}>
                <div className="col" style={{ alignItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 34, color: `oklch(0.5 0.15 ${hue})`, lineHeight: 1 }}>{fb.band.toFixed(1)}</span>
                  <span style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 800, letterSpacing: '0.06em' }}>BAND</span>
                </div>
              </Ring>
              <div style={{ background: 'var(--amber-tint)', borderRadius: 'var(--r-md)', padding: '12px 16px', textAlign: 'center' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 22, color: 'oklch(0.55 0.14 70)' }}>+{task.xp}</div>
                <div style={{ fontSize: 10.5, color: 'oklch(0.5 0.1 70)', fontWeight: 800 }}>XP</div>
              </div>
            </div>
          </div>
        </div>
        <div className="g4" style={{ padding: '18px 30px', borderTop: '1px solid var(--line)', gap: '18px 26px' }}>
          {fb.criteria.map(c => {
            const ch = bandColor(c.score);
            return (
              <div key={c.key} className="col gap-2">
                <div className="row between"><span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>{c.uz}</span><span style={{ fontSize: 14, fontWeight: 900, fontFamily: 'var(--font-display)', color: `oklch(0.5 0.15 ${ch})` }}>{c.score.toFixed(1)}</span></div>
                <Bar value={(c.score / 9) * 100} hue={ch} height={7} />
              </div>
            );
          })}
        </div>
      </Card>

      {/* Strengths FIRST (encouragement) */}
      <Card style={{ marginBottom: 16, borderColor: 'oklch(0.85 0.07 152)' }}>
        <div className="row gap-2" style={{ marginBottom: 14 }}><Icon name="check" size={20} style={{ color: 'var(--success)' }} sw={2.6} /><h3 style={{ fontSize: 18 }}>Kuchli tomonlar</h3></div>
        <div className="col gap-3">
          {fb.strengths.map((s, i) => (
            <div key={i} className="row gap-3" style={{ alignItems: 'flex-start' }}>
              <div style={{ width: 26, height: 26, borderRadius: 8, background: 'var(--success-tint)', color: 'var(--success)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="check" size={15} sw={3} /></div>
              <span style={{ fontSize: 15, lineHeight: 1.5 }}>{s}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Corrections — max 3, then show all */}
      <Card style={{ marginBottom: 16 }}>
        <div className="row between" style={{ marginBottom: 14 }}>
          <div className="row gap-2"><Icon name="target" size={20} style={{ color: 'var(--primary)' }} /><h3 style={{ fontSize: 18 }}>Yaxshilash uchun</h3></div>
          <Pill hue={47} size="sm">{Math.min(3, corrections.length)} ta muhim</Pill>
        </div>
        <div className="col gap-2">
          {shown.map((m, i) => {
            const sevHue = m.sev === 'grammar' ? 28 : m.sev === 'fluency' ? 47 : m.sev === 'pronun' ? 305 : m.sev === 'lexical' ? 248 : 47;
            return (
              <div key={i} className="row gap-3" style={{ alignItems: 'flex-start', padding: 13, background: 'var(--surface-2)', borderRadius: 'var(--r-sm)' }}>
                <div style={{ width: 26, height: 26, borderRadius: 8, background: `oklch(0.94 0.05 ${sevHue})`, color: `oklch(0.5 0.15 ${sevHue})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 13, fontWeight: 900, fontFamily: 'var(--font-display)' }}>{i + 1}</div>
                <div className="col"><span style={{ fontSize: 15, fontWeight: 800 }}>{m.uz}</span><span style={{ fontSize: 14, color: 'var(--muted)' }}>{m.ru}</span></div>
              </div>
            );
          })}
        </div>
        {corrections.length > 3 && (
          <button onClick={() => setShowAllCorr(!showAllCorr)} className="tap" style={{ marginTop: 12, width: '100%', padding: 11, borderRadius: 'var(--r-sm)', border: '1px dashed var(--line-2)', background: 'transparent', color: 'var(--ink-soft)', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
            <Icon name={showAllCorr ? 'chevD' : 'plus'} size={16} />{showAllCorr ? 'Kamroq' : `Hammasini koʻrsatish (${corrections.length})`}
          </button>
        )}
      </Card>

      {/* Transcript with per-word pronunciation (collapsible) */}
      <Card style={{ marginBottom: 18 }}>
        <button onClick={() => setShowTranscript(!showTranscript)} className="tap" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: 'none', background: 'transparent', padding: 0 }}>
          <div className="row gap-2"><Icon name="message" size={20} style={{ color: 'var(--ink-soft)' }} /><h3 style={{ fontSize: 18 }}>Transkript va talaffuz</h3></div>
          <Icon name="chevD" size={20} style={{ color: 'var(--muted)', transform: showTranscript ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
        </button>
        {showTranscript && (
          <div className="anim-fade-in" style={{ marginTop: 16 }}>
            <div className="row gap-4 wrap" style={{ marginBottom: 14 }}>
              {[['var(--pron-good)', 'Yaxshi'], ['var(--pron-mid)', 'Oʻrtacha'], ['var(--pron-low)', 'Mashq kerak']].map((l, i) => (
                <span key={i} className="row gap-2" style={{ fontSize: 12.5, color: 'var(--muted)' }}><span style={{ width: 12, height: 12, borderRadius: 4, background: l[0] }} />{l[1]}</span>
              ))}
            </div>
            <WordTranscript words={WORD_TRANSCRIPT} />
            <div style={{ marginTop: 14, padding: 12, background: 'var(--surface-2)', borderRadius: 'var(--r-sm)', fontSize: 13, color: 'var(--muted)' }} className="row gap-2">
              <Icon name="bulb" size={16} style={{ color: 'var(--amber)' }} /> Rangli yoki toʻlqinli soʻz ustiga bosing — izohni koʻrasiz.
            </div>
          </div>
        )}
      </Card>

      {/* Paywall nudge — only after value shown, when no free attempts left */}
      {noAttemptsLeft && (
        <Card style={{ marginBottom: 18, background: 'linear-gradient(135deg, oklch(0.96 0.05 80), var(--surface))', borderColor: 'oklch(0.85 0.1 80)' }}>
          <div className="row gap-4 wrap between">
            <div className="row gap-3">
              <div style={{ width: 46, height: 46, borderRadius: 13, background: 'var(--amber-tint)', color: 'oklch(0.55 0.14 70)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="star" size={24} fill /></div>
              <div className="col"><span style={{ fontWeight: 800, fontFamily: 'var(--font-display)', fontSize: 16 }}>Bepul urinishlar tugadi</span><span style={{ fontSize: 13.5, color: 'var(--muted)' }}>Cheksiz mashq uchun Premium oching</span></div>
            </div>
            <Button variant="dark" icon="sparkles" onClick={onUpgrade}>Premium</Button>
          </div>
        </Card>
      )}

      <div className="row gap-3 between">
        <Button variant="ghost" icon="refresh" onClick={onRetry}>Qayta urinish</Button>
        <Button iconR="chevR" onClick={onContinue}>Davom etish</Button>
      </div>
    </div>
  );
}

/* ---------------- Paywall ---------------- */
function Paywall({ onClose }) {
  const perks = [
    'Cheksiz speaking urinishlari', 'Batafsil AI talaffuz tahlili',
    'Shadowing va SRS takrorlash', 'Progress tarixi va radar', 'Oʻqituvchi guruhlariga kirish',
  ];
  return (
    <div className="focus-wrap" style={{ maxWidth: 520, marginInline: 'auto', textAlign: 'center', paddingTop: 12 }}>
      <Mascot size={104} mood="proud" />
      <h2 style={{ fontSize: 28, marginTop: 8 }}>Premium oching</h2>
      <p style={{ color: 'var(--muted)', fontSize: 15, marginTop: 6 }}>3 ta bepul urinishni tugatdingiz. Qoʻrqmang — progressingiz saqlanadi! Cheksiz mashq uchun Premium.</p>
      <Card style={{ marginTop: 22, textAlign: 'left' }}>
        <div className="col gap-3">
          {perks.map((p, i) => (
            <div key={i} className="row gap-3"><div style={{ width: 24, height: 24, borderRadius: 7, background: 'var(--success-tint)', color: 'var(--success)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="check" size={14} sw={3} /></div><span style={{ fontSize: 15, fontWeight: 600 }}>{p}</span></div>
          ))}
        </div>
        <div style={{ marginTop: 18, padding: 14, background: 'var(--surface-2)', borderRadius: 'var(--r-md)', textAlign: 'center' }}>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>Hozircha Premiumni</span>
          <div style={{ fontWeight: 800, fontFamily: 'var(--font-display)', fontSize: 16, marginTop: 2 }}>oʻqituvchingiz yoki admin beradi</div>
          <span style={{ fontSize: 12.5, color: 'var(--faint)' }}>Toʻlov tizimi (Payme/Click) tez orada</span>
        </div>
      </Card>
      <div className="col gap-2" style={{ marginTop: 18 }}>
        <Button full size="lg" icon="message">Oʻqituvchidan soʻrash</Button>
        <Button full variant="ghost" onClick={onClose}>Keyinroq</Button>
      </div>
    </div>
  );
}

Object.assign(window, { AnswerFlow, ResultV2, Paywall, Waveform, fmt, bandColor, WordTranscript });
