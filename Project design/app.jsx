/* ============================================================
   GOVORI — Root app v2 (+ extra screens)
   ============================================================ */

const USERS = { student: STUDENT, teacher: TEACHER, admin: ADMIN };
const DEFAULT_SCREEN = { student: 'home', teacher: 'overview', admin: 'dashboard' };
const OVERLAY = ['profile', 'settings', 'notifications', 'notfound'];

function App() {
  const [authed, setAuthed] = useState(false);
  const [role, setRole] = useState('student');
  const [screen, setScreen] = useState('home');
  const [lang, setLang] = useState('uz');
  const [attempts, setAttempts] = useState(ATTEMPTS);
  const [task, setTask] = useState(null);
  const [reviewSub, setReviewSub] = useState(null);

  const t = useMemo(() => (k => (I18N[lang] && I18N[lang][k]) || k), [lang]);

  const login = r => { setRole(r); setScreen(DEFAULT_SCREEN[r]); setAuthed(true); };
  const switchRole = r => { setRole(r); setScreen(DEFAULT_SCREEN[r]); setTask(null); setReviewSub(null); };
  const logout = () => { setAuthed(false); setScreen('home'); };
  const go = s => { if (s === '__logout') { logout(); return; } setScreen(s); setReviewSub(null); };

  const startTask = tk => {
    if (!attempts.premium && attempts.used >= attempts.total) { setScreen('paywall'); return; }
    setTask(tk); setScreen('answer');
  };
  const onAnswerDone = () => { setAttempts(a => ({ ...a, used: Math.min(a.total, a.used + 1) })); setScreen('result'); };

  if (!authed) {
    return <LangCtx.Provider value={{ lang, setLang, t }}><Auth onLogin={login} /></LangCtx.Provider>;
  }

  let content, titleKey = screen;

  if (OVERLAY.includes(screen)) {
    if (screen === 'profile') content = <ProfileScreen role={role} user={USERS[role]} />;
    else if (screen === 'settings') content = <SettingsScreen role={role} user={USERS[role]} go={go} />;
    else if (screen === 'notifications') content = <NotificationsPage />;
    else content = <NotFound go={go} home={DEFAULT_SCREEN[role]} />;
  } else if (role === 'student') {
    if (screen === 'home') content = <StudentHome go={go} startTask={startTask} attempts={attempts} />;
    else if (screen === 'practice') content = <StudentPractice startTask={startTask} />;
    else if (screen === 'progress') content = <StudentProgress />;
    else if (screen === 'assignments') content = <StudentAssignments startTask={startTask} />;
    else if (screen === 'answer' && task) { content = <AnswerFlow task={task} onExit={() => go('practice')} onDone={onAnswerDone} />; titleKey = 'practice'; }
    else if (screen === 'result' && task) { content = <ResultV2 task={task} attempts={attempts} onRetry={() => setScreen('answer')} onContinue={() => go('home')} onUpgrade={() => setScreen('paywall')} />; titleKey = 'practice'; }
    else if (screen === 'paywall') { content = <Paywall onClose={() => go('home')} />; titleKey = 'practice'; }
    else content = <StudentHome go={go} startTask={startTask} attempts={attempts} />;
  } else if (role === 'teacher') {
    if (reviewSub) { content = <ReviewDetail sub={reviewSub} onBack={() => setReviewSub(null)} />; titleKey = 'answers'; }
    else if (screen === 'overview') content = <TeacherOverview go={go} openAnswer={setReviewSub} />;
    else if (screen === 'assignments') content = <TeacherAssignments />;
    else if (screen === 'groups') content = <TeacherGroups />;
    else if (screen === 'answers') content = <TeacherAnswers openAnswer={setReviewSub} />;
    else if (screen === 'gradebook') content = <TeacherGradebook />;
    else if (screen === 'questions') content = <TeacherQuestions onCreate={() => go('createq')} />;
    else if (screen === 'topics') content = <TeacherTopics />;
    else if (screen === 'tstudents') content = <TeacherStudentsList />;
    else if (screen === 'createq') content = <CreateQuestion onBack={() => go('questions')} />;
    else content = <TeacherOverview go={go} openAnswer={setReviewSub} />;
  } else {
    if (screen === 'dashboard') content = <AdminDashboard />;
    else if (screen === 'students') content = <AdminStudents />;
    else if (screen === 'teachers') content = <AdminTeachers />;
    else if (screen === 'tests') content = <AdminTests />;
    else content = <AdminDashboard />;
  }

  return (
    <LangCtx.Provider value={{ lang, setLang, t }}>
      <Shell role={role} screen={screen} go={go} user={USERS[role]} onSwitch={switchRole} title={t(titleKey)} attempts={attempts} onLogout={logout}>
        {content}
      </Shell>
    </LangCtx.Provider>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
