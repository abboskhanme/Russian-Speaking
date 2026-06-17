/* ============================================================
   GOVORI — Mock data
   ============================================================ */

const BRAND = {
  name: 'Govori',
  tagline: 'Rus tilida ravon gapir',
  ruName: 'Говори',
};

/* ---- Avatar color helper ---- */
const AVA_COLORS = [
  ['oklch(0.92 0.06 62)', 'oklch(0.45 0.16 47)'],
  ['oklch(0.92 0.05 152)', 'oklch(0.42 0.13 152)'],
  ['oklch(0.92 0.05 248)', 'oklch(0.45 0.13 248)'],
  ['oklch(0.93 0.05 305)', 'oklch(0.46 0.14 305)'],
  ['oklch(0.94 0.06 85)', 'oklch(0.48 0.13 70)'],
  ['oklch(0.92 0.05 28)', 'oklch(0.5 0.16 28)'],
];
function avaColor(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 9973;
  return AVA_COLORS[h % AVA_COLORS.length];
}
function initials(name) {
  const p = name.trim().split(/\s+/);
  return (p[0][0] + (p[1] ? p[1][0] : '')).toUpperCase();
}

/* ---- Users ---- */
const STUDENT = {
  id: 'u-stu', role: 'student', name: 'Madina Yusupova', short: 'Madina',
  level: 'B1', band: 6.0, streak: 12, points: 2840, rank: 4,
  goalBand: 7.0, joined: '2025-09', city: 'Toshkent',
};
const TEACHER = {
  id: 'u-tea', role: 'teacher', name: 'Dilnoza Karimova', short: 'Dilnoza',
  title: 'Katta oʻqituvchi', students: 38, joined: '2024-02',
};
const ADMIN = {
  id: 'u-adm', role: 'admin', name: 'Sardor Aliyev', short: 'Sardor',
  title: 'Platforma administratori',
};

/* ---- Courses (level-based) ---- */
const COURSES = [
  { id: 'c-a1', level: 'A1', ru: 'Начальный', uz: 'Boshlangʻich', lessons: 24, done: 24, hue: 152, locked: false },
  { id: 'c-a2', level: 'A2', ru: 'Элементарный', uz: 'Elementar', lessons: 28, done: 28, hue: 80, locked: false },
  { id: 'c-b1', level: 'B1', ru: 'Средний', uz: 'Oʻrta', lessons: 32, done: 19, hue: 47, locked: false },
  { id: 'c-b2', level: 'B2', ru: 'Выше среднего', uz: 'Oʻrtadan yuqori', lessons: 30, done: 0, hue: 248, locked: false },
  { id: 'c-c1', level: 'C1', ru: 'Продвинутый', uz: 'Ilgʻor', lessons: 26, done: 0, hue: 305, locked: true },
];

/* ---- Speaking tasks (IELTS-style parts) ---- */
const TASKS = [
  {
    id: 't-p1', part: 1, kind: 'interview',
    titleUz: 'Part 1 — Intervyu', titleRu: 'Интервью',
    descUz: 'Qisqa shaxsiy savollarga tabiiy javob bering. Har biriga ~30 soniya.',
    durationSec: 240, difficulty: 'B1', hue: 152, xp: 60,
    questions: [
      'Расскажите немного о себе.',
      'Где вы живёте и что вам нравится в вашем городе?',
      'Чем вы любите заниматься в свободное время?',
      'Любите ли вы путешествовать? Почему?',
    ],
  },
  {
    id: 't-p2', part: 2, kind: 'cue',
    titleUz: 'Part 2 — Cue card', titleRu: 'Монолог',
    descUz: '1 daqiqa tayyorlaning, soʻngra 1-2 daqiqa toʻxtovsiz gapiring.',
    durationSec: 120, prepSec: 60, difficulty: 'B1', hue: 47, xp: 90,
    cueRu: 'Опишите книгу, которая вам понравилась.',
    cueUz: 'Sizga yoqqan kitobni tasvirlab bering.',
    bullets: [
      'что это за книга и кто её автор',
      'о чём эта книга',
      'почему вы решили её прочитать',
      'и объясните, почему она вам понравилась',
    ],
  },
  {
    id: 't-p3', part: 3, kind: 'discussion',
    titleUz: 'Part 3 — Muhokama', titleRu: 'Дискуссия',
    descUz: 'Mavhum savollar boʻyicha fikringizni asoslab bering.',
    durationSec: 300, difficulty: 'B2', hue: 248, xp: 120,
    questions: [
      'Как изменились привычки чтения за последние годы?',
      'Почему некоторые люди предпочитают бумажные книги электронным?',
      'Какую роль играет чтение в образовании?',
    ],
  },
];

/* ---- Daily task ---- */
const DAILY = {
  taskId: 't-p2',
  titleUz: 'Bugungi topshiriq',
  promptUz: 'Sizga yoqqan kitobni tasvirlab bering',
  promptRu: 'Опишите книгу, которая вам понравилась',
  xp: 90,
};

/* ---- IELTS-style criteria ---- */
const CRITERIA = [
  { key: 'fluency', uz: 'Ravonlik', ru: 'Беглость', score: 6.0 },
  { key: 'lexical', uz: 'Soʻz boyligi', ru: 'Лексика', score: 6.5 },
  { key: 'grammar', uz: 'Grammatika', ru: 'Грамматика', score: 5.5 },
  { key: 'pronun',  uz: 'Talaffuz', ru: 'Произношение', score: 6.0 },
];

/* ---- AI feedback sample (after a recording) ---- */
const AI_FEEDBACK = {
  band: 6.0,
  durationSec: 78,
  wordsPerMin: 96,
  fillers: 4,
  criteria: CRITERIA,
  transcript: [
    { t: 'Я хочу рассказать о книге, которая очень ', tag: null },
    { t: 'понравилась мне', tag: null },
    { t: '. Этот книга', tag: 'grammar', note: 'Эта книга (род)' },
    { t: ' называется «Альхимик». ', tag: null },
    { t: 'Эээ', tag: 'filler', note: 'Toʻxtalish soʻzi' },
    { t: ', она о молодом пастухе, который ', tag: null },
    { t: 'ищет', tag: 'good', note: 'Yaxshi feʻl tanlovi' },
    { t: ' свою мечту. Мне нравится, потому что ', tag: null },
    { t: 'я чувствую вдохновение', tag: 'good', note: 'Boy ibora' },
    { t: '.', tag: null },
  ],
  strengths: [
    'Ясная структура ответа — javobingiz aniq tuzilgan',
    'Yaxshi bogʻlovchilar: «потому что», «который»',
  ],
  improve: [
    { uz: 'Rod (jins) kelishigi', ru: 'этот книга → эта книга', sev: 'grammar' },
    { uz: 'Toʻxtalishlarni kamaytiring', ru: '4 раза «ээ» / «ну»', sev: 'fluency' },
    { uz: 'Urgʻu: «мечтА» toʻgʻri', ru: 'мечтА, не мЕчта', sev: 'pronun' },
  ],
};

/* ---- Progress history (band over weeks) ---- */
const PROGRESS = [
  { w: '1-hafta', band: 5.0 }, { w: '2', band: 5.0 }, { w: '3', band: 5.5 },
  { w: '4', band: 5.5 }, { w: '5', band: 6.0 }, { w: '6', band: 5.5 },
  { w: '7', band: 6.0 }, { w: '8', band: 6.5 },
];
const WEEK_ACTIVITY = [
  { d: 'Du', min: 18 }, { d: 'Se', min: 25 }, { d: 'Ch', min: 0 },
  { d: 'Pa', min: 32 }, { d: 'Ju', min: 15 }, { d: 'Sh', min: 40 }, { d: 'Ya', min: 22 },
];

/* ---- Vocabulary ---- */
const VOCAB = [
  { ru: 'впечатление', uz: 'taassurot', ex: 'Книга произвела сильное впечатление.', learned: true },
  { ru: 'вдохновение', uz: 'ilhom', ex: 'Эта история даёт вдохновение.', learned: true },
  { ru: 'путешествие', uz: 'sayohat', ex: 'Я люблю путешествия по горам.', learned: true },
  { ru: 'преимущество', uz: 'afzallik', ex: 'Главное преимущество — удобство.', learned: false },
  { ru: 'окружающая среда', uz: 'atrof-muhit', ex: 'Мы должны беречь окружающую среду.', learned: false },
  { ru: 'развивать', uz: 'rivojlantirmoq', ex: 'Нужно развивать навыки.', learned: false },
];

/* ---- Leaderboard ---- */
const LEADERBOARD = [
  { name: 'Jasur Toshmatov', pts: 3920, lvl: 'B2', streak: 21, you: false },
  { name: 'Kamola Rahimova', pts: 3410, lvl: 'B1', streak: 9, you: false },
  { name: 'Aziz Nematov', pts: 3050, lvl: 'B2', streak: 14, you: false },
  { name: 'Madina Yusupova', pts: 2840, lvl: 'B1', streak: 12, you: true },
  { name: 'Nigora Saidova', pts: 2610, lvl: 'A2', streak: 7, you: false },
  { name: 'Bekzod Olimov', pts: 2300, lvl: 'B1', streak: 4, you: false },
  { name: 'Sevara Yusupova', pts: 2150, lvl: 'A2', streak: 18, you: false },
];

/* ---- Badges ---- */
const BADGES = [
  { id: 'b1', uz: '7 kun ketma-ket', icon: 'flame', got: true, hue: 28 },
  { id: 'b2', uz: 'Birinchi 6.0 ball', icon: 'star', got: true, hue: 80 },
  { id: 'b3', uz: '50 mashq', icon: 'mic', got: true, hue: 47 },
  { id: 'b4', uz: '100 ta yangi soʻz', icon: 'book', got: false, hue: 152 },
  { id: 'b5', uz: 'Part 3 ustasi', icon: 'trophy', got: false, hue: 305 },
  { id: 'b6', uz: '30 kun streak', icon: 'flame', got: false, hue: 248 },
];

/* ---- Teacher: submissions to review ---- */
const SUBMISSIONS = [
  { id: 's1', student: 'Jasur Toshmatov', task: 'Part 2 — Cue card', topic: 'Опишите книгу', dur: 92, when: '15 daq oldin', status: 'pending', autoBand: 6.5 },
  { id: 's2', student: 'Nigora Saidova', task: 'Part 1 — Intervyu', topic: 'Свободное время', dur: 188, when: '1 soat oldin', status: 'pending', autoBand: 5.5 },
  { id: 's3', student: 'Bekzod Olimov', task: 'Part 3 — Muhokama', topic: 'Привычки чтения', dur: 245, when: '3 soat oldin', status: 'pending', autoBand: 6.0 },
  { id: 's4', student: 'Kamola Rahimova', task: 'Part 2 — Cue card', topic: 'Путешествие', dur: 110, when: 'Kecha', status: 'reviewed', autoBand: 6.5, band: 7.0 },
  { id: 's5', student: 'Aziz Nematov', task: 'Part 1 — Intervyu', topic: 'Мой город', dur: 175, when: 'Kecha', status: 'reviewed', autoBand: 6.0, band: 6.0 },
];

/* ---- Teacher: students ---- */
const TEACHER_STUDENTS = [
  { name: 'Jasur Toshmatov', lvl: 'B2', band: 6.5, last: 'Bugun', progress: 78, trend: 'up' },
  { name: 'Kamola Rahimova', lvl: 'B1', band: 7.0, last: 'Kecha', progress: 64, trend: 'up' },
  { name: 'Aziz Nematov', lvl: 'B2', band: 6.0, last: '2 kun', progress: 55, trend: 'flat' },
  { name: 'Madina Yusupova', lvl: 'B1', band: 6.0, last: 'Bugun', progress: 59, trend: 'up' },
  { name: 'Nigora Saidova', lvl: 'A2', band: 5.5, last: 'Bugun', progress: 41, trend: 'up' },
  { name: 'Bekzod Olimov', lvl: 'B1', band: 5.5, last: '4 kun', progress: 38, trend: 'down' },
];

/* ---- Admin KPIs ---- */
const ADMIN_KPI = [
  { uz: 'Jami oʻquvchilar', val: '1,284', delta: '+8.2%', up: true, hue: 47 },
  { uz: 'Faol (bu hafta)', val: '892', delta: '+12%', up: true, hue: 152 },
  { uz: 'Kunlik mashqlar', val: '3,410', delta: '+5.4%', up: true, hue: 248 },
  { uz: 'Oʻrtacha ball', val: '6.1', delta: '+0.3', up: true, hue: 80 },
];
const ADMIN_ENROLL = [
  { m: 'Yan', v: 620 }, { m: 'Fev', v: 710 }, { m: 'Mar', v: 760 },
  { m: 'Apr', v: 880 }, { m: 'May', v: 1010 }, { m: 'Iyun', v: 1284 },
];
const ADMIN_LEVELS = [
  { lvl: 'A1', n: 312, hue: 152 }, { lvl: 'A2', n: 358, hue: 80 },
  { lvl: 'B1', n: 364, hue: 47 }, { lvl: 'B2', n: 188, hue: 248 },
  { lvl: 'C1', n: 62, hue: 305 },
];
const ADMIN_USERS = [
  { name: 'Madina Yusupova', role: 'Oʻquvchi', lvl: 'B1', status: 'active', joined: '2025-09-12' },
  { name: 'Dilnoza Karimova', role: 'Oʻqituvchi', lvl: '—', status: 'active', joined: '2024-02-03' },
  { name: 'Jasur Toshmatov', role: 'Oʻquvchi', lvl: 'B2', status: 'active', joined: '2025-06-21' },
  { name: 'Aziz Nematov', role: 'Oʻquvchi', lvl: 'B2', status: 'inactive', joined: '2025-03-15' },
  { name: 'Shaxnoza Tursunova', role: 'Oʻqituvchi', lvl: '—', status: 'active', joined: '2024-11-08' },
  { name: 'Bekzod Olimov', role: 'Oʻquvchi', lvl: 'B1', status: 'active', joined: '2025-10-02' },
];

Object.assign(window, {
  BRAND, STUDENT, TEACHER, ADMIN, COURSES, TASKS, DAILY, CRITERIA, AI_FEEDBACK,
  PROGRESS, WEEK_ACTIVITY, VOCAB, LEADERBOARD, BADGES, SUBMISSIONS, TEACHER_STUDENTS,
  ADMIN_KPI, ADMIN_ENROLL, ADMIN_LEVELS, ADMIN_USERS, avaColor, initials,
});
