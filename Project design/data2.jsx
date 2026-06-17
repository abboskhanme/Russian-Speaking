/* ============================================================
   GOVORI — Data v2 (additions)
   ============================================================ */

/* ---- i18n (nav + chrome only; learning content stays Russian) ---- */
const I18N = {
  uz: {
    home: 'Bosh sahifa', practice: 'Praktika', progress: 'Progress',
    overview: 'Obzor', assignments: 'Topshiriqlar', groups: 'Guruhlar', answers: 'Javoblar', gradebook: 'Jurnal',
    students: "O'quvchilar", teachers: "O'qituvchilar", tests: 'Testlar', dashboard: 'Boshqaruv',
    search: 'Qidirish...', attemptsLeft: 'urinish qoldi', premium: 'Premium', free: 'Bepul',
    streak: 'kun', record: 'Yozish', send: 'Yuborish', retry: 'Qayta urinish', continue: 'Davom etish',
    strengths: 'Kuchli tomonlar', improve: 'Yaxshilash uchun', transcript: 'Transkript', showAll: 'Hammasini',
    profile: 'Profil', settings: 'Sozlamalar', notifications: 'Bildirishnomalar', notfound: '404',
    questions: 'Savollar bazasi', topics: 'Mavzular', tstudents: "O'quvchilarim", createq: 'Yangi savol',
  },
  ru: {
    home: 'Главная', practice: 'Практика', progress: 'Прогресс',
    overview: 'Обзор', assignments: 'Задания', groups: 'Группы', answers: 'Ответы', gradebook: 'Журнал',
    students: 'Ученики', teachers: 'Учителя', tests: 'Тесты', dashboard: 'Панель',
    search: 'Поиск...', attemptsLeft: 'попыток осталось', premium: 'Премиум', free: 'Бесплатно',
    streak: 'дней', record: 'Записать', send: 'Отправить', retry: 'Заново', continue: 'Продолжить',
    strengths: 'Сильные стороны', improve: 'Что улучшить', transcript: 'Транскрипт', showAll: 'Показать все',
    profile: 'Профиль', settings: 'Настройки', notifications: 'Уведомления', notfound: '404',
    questions: 'База вопросов', topics: 'Темы', tstudents: 'Мои ученики', createq: 'Новый вопрос',
  },
  en: {
    home: 'Home', practice: 'Practice', progress: 'Progress',
    overview: 'Overview', assignments: 'Assignments', groups: 'Groups', answers: 'Answers', gradebook: 'Gradebook',
    students: 'Students', teachers: 'Teachers', tests: 'Tests', dashboard: 'Dashboard',
    search: 'Search...', attemptsLeft: 'attempts left', premium: 'Premium', free: 'Free',
    streak: 'days', record: 'Record', send: 'Submit', retry: 'Retry', continue: 'Continue',
    strengths: 'Strengths', improve: 'To improve', transcript: 'Transcript', showAll: 'Show all',
    profile: 'Profile', settings: 'Settings', notifications: 'Notifications', notfound: '404',
    questions: 'Question bank', topics: 'Topics', tstudents: 'My students', createq: 'New question',
  },
};

/* ---- Per-word pronunciation transcript ---- */
/* pron: good | mid | low ; issue: grammar | filler */
const WORD_TRANSCRIPT = [
  { w: 'Я', pron: 'good' }, { w: 'хочу', pron: 'good' }, { w: 'рассказать', pron: 'mid' },
  { w: 'о', pron: 'good' }, { w: 'книге,', pron: 'good' }, { w: 'которая', pron: 'mid' },
  { w: 'мне', pron: 'good' }, { w: 'очень', pron: 'good' }, { w: 'понравилась.', pron: 'good' },
  { w: 'Этот', pron: 'low', issue: 'grammar', note: 'Эта книга — женский род' }, { w: 'книга', pron: 'good' },
  { w: 'называется', pron: 'mid' }, { w: '«Алхимик».', pron: 'mid' },
  { w: 'Эээ,', pron: 'low', issue: 'filler', note: 'Слово-паразит' }, { w: 'она', pron: 'good' },
  { w: 'о', pron: 'good' }, { w: 'молодом', pron: 'mid' }, { w: 'пастухе,', pron: 'low', note: 'Ударение: пастухЕ' },
  { w: 'который', pron: 'good' }, { w: 'ищет', pron: 'good' }, { w: 'свою', pron: 'good' }, { w: 'мечту.', pron: 'mid' },
  { w: 'Мне', pron: 'good' }, { w: 'нравится', pron: 'good' }, { w: 'эта', pron: 'good' }, { w: 'история,', pron: 'good' },
  { w: 'потому', pron: 'good' }, { w: 'что', pron: 'good' }, { w: 'она', pron: 'good' }, { w: 'вдохновляет.', pron: 'mid' },
];

/* ---- Criterion improve micro-actions ---- */
const CRIT_IMPROVE = {
  fluency: 'Pauzalarni qisqartiring — fikrni «потому что», «во-первых» bilan bogʼlang.',
  lexical: 'Sinonimlar qoʻshing: «хороший» → «замечательный», «увлекательный».',
  grammar: 'Rod kelishigini takrorlang: «этот / эта / это».',
  pronun: 'Urgʻuni mashq qiling: мечтА, пастухЕ.',
};

/* ---- Achievements ---- */
const ACHIEVEMENTS = [
  { id: 'a1', uz: 'Birinchi javob', icon: 'mic', got: true, hue: 47, date: '12-sen' },
  { id: 'a2', uz: '7 kunlik seriya', icon: 'flame', got: true, hue: 28, date: '20-sen' },
  { id: 'a3', uz: 'Band 6.0 ochildi', icon: 'star', got: true, hue: 80, date: '4-okt' },
  { id: 'a4', uz: '50 ta mashq', icon: 'target', got: true, hue: 152, date: '18-okt' },
  { id: 'a5', uz: '100 yangi soʻz', icon: 'book', got: false, hue: 248, prog: 64 },
  { id: 'a6', uz: 'Band 7.0', icon: 'trophy', got: false, hue: 305, prog: 86 },
  { id: 'a7', uz: '30 kunlik seriya', icon: 'flame', got: false, hue: 18, prog: 40 },
  { id: 'a8', uz: 'Shadowing ustasi', icon: 'headphones', got: false, hue: 200, prog: 25 },
];

/* ---- Shadowing phrases (listen & repeat) ---- */
const SHADOW = [
  { ru: 'Доброе утро! Как ваши дела?', uz: 'Xayrli tong! Ishlaringiz qalay?', len: 3, pron: 92 },
  { ru: 'Я бы хотел заказать столик на двоих.', uz: 'Ikki kishilik stol band qilmoqchiman.', len: 4, pron: 78 },
  { ru: 'Извините, как пройти до метро?', uz: 'Kechirasiz, metroga qanday borish mumkin?', len: 4, pron: null },
  { ru: 'Это было незабываемое путешествие.', uz: 'Bu unutilmas sayohat edi.', len: 3, pron: null },
];

/* ---- Review / SRS items (weak skills) ---- */
const REVIEW_ITEMS = [
  { skill: 'Grammatika', uz: 'Rod kelishigi (этот/эта/это)', due: 'Bugun', reps: 2, hue: 28 },
  { skill: 'Talaffuz', uz: 'Urgʻu: мечтА, пастухЕ', due: 'Bugun', reps: 1, hue: 305 },
  { skill: 'Lugʻat', uz: '«увлекательный» soʻzini ishlatish', due: 'Ertaga', reps: 3, hue: 248 },
  { skill: 'Ravonlik', uz: 'Toʻxtalishlarsiz 30 soniya gapirish', due: '2 kun', reps: 0, hue: 47 },
];

/* ---- Teacher: groups ---- */
const GROUPS = [
  {
    id: 'g1', name: 'B1 — Kechki guruh', students: 12, assignments: 4, hue: 47,
    members: [
      { name: 'Jasur Toshmatov', done: true, band: 6.5 }, { name: 'Kamola Rahimova', done: true, band: 7.0 },
      { name: 'Aziz Nematov', done: false, band: 6.0 }, { name: 'Madina Yusupova', done: true, band: 6.0 },
      { name: 'Bekzod Olimov', done: false, band: 5.5 }, { name: 'Nigora Saidova', done: true, band: 5.5 },
    ],
  },
  { id: 'g2', name: 'A2 — Ertalabki guruh', students: 9, assignments: 3, hue: 152, members: [] },
  { id: 'g3', name: 'B2 — Intensiv', students: 7, assignments: 6, hue: 248, members: [] },
];

/* ---- Teacher: gradebook ---- */
const GRADEBOOK = {
  cols: ['Part 1', 'Part 2', 'Part 3', 'Shadowing'],
  rows: [
    { name: 'Jasur Toshmatov', scores: [6.5, 7.0, 6.0, 8.0] },
    { name: 'Kamola Rahimova', scores: [7.0, 6.5, 7.0, 7.5] },
    { name: 'Aziz Nematov', scores: [6.0, 6.0, null, 7.0] },
    { name: 'Madina Yusupova', scores: [6.0, 6.0, 5.5, 6.5] },
    { name: 'Nigora Saidova', scores: [5.5, 5.5, null, 6.0] },
    { name: 'Bekzod Olimov', scores: [5.5, null, 5.0, 5.5] },
  ],
};

/* ---- Teacher: question types (create) ---- */
const QUESTION_TYPES = [
  { id: 'text', uz: 'Matnli savol', icon: 'message', hue: 47, desc: 'Oddiy matn savol — eng tez' },
  { id: 'image', uz: 'Rasmli savol', icon: 'eye', hue: 152, desc: 'Rasmni tasvirlash topshirigʼi' },
  { id: 'video', uz: 'Video savol', icon: 'play', hue: 248, desc: 'Videoga reaksiya / takrorlash' },
];

/* ---- Admin: teachers + tests ---- */
const ADMIN_TEACHERS = [
  { name: 'Dilnoza Karimova', groups: 3, students: 38, status: 'active', joined: '2024-02-03' },
  { name: 'Shaxnoza Tursunova', groups: 2, students: 24, status: 'active', joined: '2024-11-08' },
  { name: 'Rustam Qodirov', groups: 1, students: 11, status: 'inactive', joined: '2025-05-19' },
];
const ADMIN_TESTS = [
  { title: 'Part 1 — Знакомство', part: 1, qs: 8, uses: 412, hue: 152 },
  { title: 'Part 2 — Любимая книга', part: 2, qs: 1, uses: 286, hue: 47 },
  { title: 'Part 3 — Технологии и общество', part: 3, qs: 5, uses: 158, hue: 248 },
  { title: 'Shadowing — Повседневные фразы', part: 0, qs: 20, uses: 530, hue: 80 },
];

/* ---- Free attempts / premium state ---- */
const ATTEMPTS = { used: 1, total: 3, premium: false };

Object.assign(window, {
  I18N, WORD_TRANSCRIPT, CRIT_IMPROVE, ACHIEVEMENTS, SHADOW, REVIEW_ITEMS,
  GROUPS, GRADEBOOK, QUESTION_TYPES, ADMIN_TEACHERS, ADMIN_TESTS, ATTEMPTS,
});
