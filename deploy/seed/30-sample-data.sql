-- =====================================================================================
-- 30-sample-data.sql  —  Rich, relationally-consistent SAMPLE DATA for the Govori app.
--
-- Purpose: fill a local dev DB with a coherent, browsable dataset so every screen
-- (Home, Modules, a task, Progress, Leaderboard, Review, Notifications, and the teacher
-- Groups / Gradebook) shows REAL, interlinked content.
--
-- Runs AFTER 10-seed.sql.gz (demo dump) and 20-dev-users.sql, on a FRESH volume's initdb,
-- and is safe to re-apply to a running DB.
--
-- IDEMPOTENT: every row's primary key is a DETERMINISTIC uuid derived from a stable natural
-- key (md5('sample:<kind>:<key>')::uuid), and every INSERT is guarded with ON CONFLICT DO
-- NOTHING. Re-running changes nothing. All seeded people log in with password  Parol123!
-- (same bcrypt hash as 20-dev-users.sql). Seeded emails use the *.<name>@govori.uz scheme
-- and are distinct from the existing demo accounts, so nothing here collides.
--
-- VISIBILITY CONTRACT (backend-dotnet .../Govori.Catalog/CatalogService.cs):
--   * a module shows for a student iff  is_published  AND (visibility='public'
--     OR (visibility='group' AND the student is in a group whose teacher owns the module)).
--   * a task shows iff  is_published AND NOT is_deleted, ordered by (sort_order, created_at).
-- Every group module below is owned by the SAME teacher who owns the group its students join,
-- and every task's teacher_id = its module's teacher_id (also what the gradebook filters on).
-- =====================================================================================

SET client_min_messages = warning;

-- Shared bcrypt hash of "Parol123!" (reused from 20-dev-users.sql).
-- $2b$12$g75bPHh6YmJRoVn4NUDFBe6Qo6plRjc3xAgahpafi6HdBZrMQ7JJO


-- ─────────────────────────────────────────────────────────────────────────────
-- 1) USERS — 4 teachers + 10 students (realistic Uzbek names).
--    Natural key = email → ON CONFLICT (email) DO NOTHING.
--    AUTH IS PHONE + OTP: every user has a UNIQUE +998 phone (teachers +99890111220x,
--    students +9989110020xx). In dev (no Telegram token) log in as any of them with:
--      otp/request { phone } → otp/verify { phone, code: "000000" } → tokens.
--    (The bcrypt hash is legacy parity only; email/password login no longer exists.)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO users
  (id, email, password_hash, full_name, role, is_active, is_premium,
   preferred_language, xp, daily_goal, streak_freezes, current_streak, longest_streak,
   last_practice_date, phone, age, region, district, created_at, updated_at)
VALUES
  -- Teachers
  (md5('sample:user:aziz.karimov@govori.uz')::uuid,     'aziz.karimov@govori.uz',     '$2b$12$g75bPHh6YmJRoVn4NUDFBe6Qo6plRjc3xAgahpafi6HdBZrMQ7JJO', 'Aziz Karimov',      'teacher', true, true,  'uz', 0, 1, 0, 0, 0, NULL, '+998901112201', 34, 'Toshkent',   'Chilonzor',  now(), now()),
  (md5('sample:user:dilnoza.yusupova@govori.uz')::uuid, 'dilnoza.yusupova@govori.uz', '$2b$12$g75bPHh6YmJRoVn4NUDFBe6Qo6plRjc3xAgahpafi6HdBZrMQ7JJO', 'Dilnoza Yusupova',  'teacher', true, true,  'uz', 0, 1, 0, 0, 0, NULL, '+998901112202', 29, 'Toshkent',   'Yunusobod',  now(), now()),
  (md5('sample:user:sherzod.rashidov@govori.uz')::uuid, 'sherzod.rashidov@govori.uz', '$2b$12$g75bPHh6YmJRoVn4NUDFBe6Qo6plRjc3xAgahpafi6HdBZrMQ7JJO', 'Sherzod Rashidov',  'teacher', true, true,  'uz', 0, 1, 0, 0, 0, NULL, '+998901112203', 41, 'Samarqand',  'Registon',   now(), now()),
  (md5('sample:user:nodira.tosheva@govori.uz')::uuid,   'nodira.tosheva@govori.uz',   '$2b$12$g75bPHh6YmJRoVn4NUDFBe6Qo6plRjc3xAgahpafi6HdBZrMQ7JJO', 'Nodira Tosheva',    'teacher', true, true,  'uz', 0, 1, 0, 0, 0, NULL, '+998901112204', 37, 'Toshkent',   'Mirzo Ulugbek', now(), now()),
  -- Students (xp / streak varied → meaningful leaderboard; Sevara is premium)
  (md5('sample:user:jasur.abdullayev@govori.uz')::uuid,  'jasur.abdullayev@govori.uz',  '$2b$12$g75bPHh6YmJRoVn4NUDFBe6Qo6plRjc3xAgahpafi6HdBZrMQ7JJO', 'Jasur Abdullayev',  'student', true, false, 'uz', 245, 3, 1, 6,  9, CURRENT_DATE,          '+998911002001', 19, 'Toshkent',  'Chilonzor',   now(), now()),
  (md5('sample:user:malika.ibragimova@govori.uz')::uuid, 'malika.ibragimova@govori.uz', '$2b$12$g75bPHh6YmJRoVn4NUDFBe6Qo6plRjc3xAgahpafi6HdBZrMQ7JJO', 'Malika Ibragimova', 'student', true, false, 'uz', 120, 2, 0, 3,  5, CURRENT_DATE,          '+998911002002', 21, 'Toshkent',  'Yakkasaroy',  now(), now()),
  (md5('sample:user:bekzod.nazarov@govori.uz')::uuid,    'bekzod.nazarov@govori.uz',    '$2b$12$g75bPHh6YmJRoVn4NUDFBe6Qo6plRjc3xAgahpafi6HdBZrMQ7JJO', 'Bekzod Nazarov',    'student', true, false, 'uz', 55,  1, 0, 1,  2, CURRENT_DATE - 1,      '+998911002003', 18, 'Andijon',   'Andijon',     now(), now()),
  (md5('sample:user:sevara.umarova@govori.uz')::uuid,    'sevara.umarova@govori.uz',    '$2b$12$g75bPHh6YmJRoVn4NUDFBe6Qo6plRjc3xAgahpafi6HdBZrMQ7JJO', 'Sevara Umarova',    'student', true, true,  'uz', 320, 4, 2, 11, 14, CURRENT_DATE,          '+998911002004', 22, 'Toshkent',  'Yunusobod',   now(), now()),
  (md5('sample:user:otabek.sultonov@govori.uz')::uuid,   'otabek.sultonov@govori.uz',   '$2b$12$g75bPHh6YmJRoVn4NUDFBe6Qo6plRjc3xAgahpafi6HdBZrMQ7JJO', 'Otabek Sultonov',   'student', true, false, 'uz', 80,  2, 0, 2,  4, CURRENT_DATE - 2,      '+998911002005', 20, 'Farg''ona', 'Farg''ona',   now(), now()),
  (md5('sample:user:kamola.ergasheva@govori.uz')::uuid,  'kamola.ergasheva@govori.uz',  '$2b$12$g75bPHh6YmJRoVn4NUDFBe6Qo6plRjc3xAgahpafi6HdBZrMQ7JJO', 'Kamola Ergasheva',  'student', true, false, 'uz', 175, 3, 1, 5,  7, CURRENT_DATE,          '+998911002006', 23, 'Buxoro',    'Buxoro',      now(), now()),
  (md5('sample:user:farrux.yuldashev@govori.uz')::uuid,  'farrux.yuldashev@govori.uz',  '$2b$12$g75bPHh6YmJRoVn4NUDFBe6Qo6plRjc3xAgahpafi6HdBZrMQ7JJO', 'Farrux Yuldashev',  'student', true, false, 'uz', 70,  2, 0, 2,  3, CURRENT_DATE - 1,      '+998911002007', 24, 'Namangan',  'Namangan',    now(), now()),
  (md5('sample:user:nilufar.qodirova@govori.uz')::uuid,  'nilufar.qodirova@govori.uz',  '$2b$12$g75bPHh6YmJRoVn4NUDFBe6Qo6plRjc3xAgahpafi6HdBZrMQ7JJO', 'Nilufar Qodirova',  'student', true, false, 'uz', 150, 3, 0, 4,  6, CURRENT_DATE,          '+998911002008', 20, 'Samarqand', 'Registon',    now(), now()),
  (md5('sample:user:sardor.mirzayev@govori.uz')::uuid,   'sardor.mirzayev@govori.uz',   '$2b$12$g75bPHh6YmJRoVn4NUDFBe6Qo6plRjc3xAgahpafi6HdBZrMQ7JJO', 'Sardor Mirzayev',   'student', true, false, 'uz', 140, 3, 1, 4,  5, CURRENT_DATE,          '+998911002009', 25, 'Toshkent',  'Sergeli',     now(), now()),
  (md5('sample:user:gulnora.saidova@govori.uz')::uuid,   'gulnora.saidova@govori.uz',   '$2b$12$g75bPHh6YmJRoVn4NUDFBe6Qo6plRjc3xAgahpafi6HdBZrMQ7JJO', 'Gulnora Saidova',   'student', true, false, 'uz', 45,  1, 0, 1,  2, CURRENT_DATE - 3,      '+998911002010', 19, 'Xorazm',    'Urganch',     now(), now())
ON CONFLICT (email) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2) TOPICS (+ a couple of images) — teacher-owned image banks.
--    Natural key = (teacher_id, name) → ON CONFLICT (teacher_id, name).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO topics (id, teacher_id, name, created_at, updated_at)
VALUES
  (md5('sample:topic:aziz:byt')::uuid,       (SELECT id FROM users WHERE email='aziz.karimov@govori.uz'),     'Быт и повседневность', now(), now()),
  (md5('sample:topic:dilnoza:gorod')::uuid,  (SELECT id FROM users WHERE email='dilnoza.yusupova@govori.uz'), 'Город и путешествия',  now(), now()),
  (md5('sample:topic:sherzod:rabota')::uuid, (SELECT id FROM users WHERE email='sherzod.rashidov@govori.uz'), 'Работа и учёба',       now(), now()),
  (md5('sample:topic:nodira:ielts')::uuid,   (SELECT id FROM users WHERE email='nodira.tosheva@govori.uz'),   'IELTS темы',           now(), now())
ON CONFLICT (teacher_id, name) DO NOTHING;

INSERT INTO topic_images (id, topic_id, image_key, created_at, updated_at)
VALUES
  (md5('sample:topicimg:byt:1')::uuid,   md5('sample:topic:aziz:byt')::uuid,      'seed/topics/byt-kitchen.jpg',  now(), now()),
  (md5('sample:topicimg:byt:2')::uuid,   md5('sample:topic:aziz:byt')::uuid,      'seed/topics/byt-market.jpg',   now(), now()),
  (md5('sample:topicimg:gorod:1')::uuid, md5('sample:topic:dilnoza:gorod')::uuid, 'seed/topics/gorod-square.jpg', now(), now())
ON CONFLICT (id) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3) GROUPS + 4) GROUP MEMBERS. Built from small temp rosters so the FKs stay obvious.
-- ─────────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS _seed_groups;
CREATE TEMP TABLE _seed_groups (slug text, teacher_email text, name text, join_code text);
INSERT INTO _seed_groups VALUES
  ('gA', 'aziz.karimov@govori.uz',     'A1 · Разговорная речь (namuna)', 'SMPLA1'),
  ('gB', 'dilnoza.yusupova@govori.uz', 'A2 · Путешествия (namuna)',      'SMPLB2'),
  ('gC', 'sherzod.rashidov@govori.uz', 'B1 · Работа (namuna)',           'SMPLC3'),
  ('gD', 'nodira.tosheva@govori.uz',   'B2 · IELTS Speaking (namuna)',   'SMPLD4');

INSERT INTO groups (id, teacher_id, name, join_code, created_at, updated_at)
SELECT md5('sample:group:'||g.slug)::uuid,
       (SELECT id FROM users WHERE email=g.teacher_email),
       g.name, g.join_code, now(), now()
FROM _seed_groups g
ON CONFLICT (join_code) DO NOTHING;

-- Rosters (some students belong to two groups: sevara/otabek A+B, kamola/farrux B+C, sardor C+D).
DROP TABLE IF EXISTS _seed_members;
CREATE TEMP TABLE _seed_members (group_slug text, student_email text);
INSERT INTO _seed_members VALUES
  ('gA','jasur.abdullayev@govori.uz'), ('gA','malika.ibragimova@govori.uz'), ('gA','bekzod.nazarov@govori.uz'),
  ('gA','sevara.umarova@govori.uz'),   ('gA','otabek.sultonov@govori.uz'),
  ('gB','sevara.umarova@govori.uz'),   ('gB','otabek.sultonov@govori.uz'),
  ('gB','kamola.ergasheva@govori.uz'), ('gB','farrux.yuldashev@govori.uz'),
  ('gC','kamola.ergasheva@govori.uz'), ('gC','farrux.yuldashev@govori.uz'),
  ('gC','nilufar.qodirova@govori.uz'), ('gC','sardor.mirzayev@govori.uz'),
  ('gD','sardor.mirzayev@govori.uz'),  ('gD','gulnora.saidova@govori.uz');

INSERT INTO group_members (id, group_id, student_id, created_at, updated_at)
SELECT md5('sample:gm:'||m.group_slug||':'||m.student_email)::uuid,
       md5('sample:group:'||m.group_slug)::uuid,
       (SELECT id FROM users WHERE email=m.student_email),
       now(), now()
FROM _seed_members m
ON CONFLICT (group_id, student_id) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5) QUESTION_BLOCKS (modules) — 6, all published; 5 group + 1 official public.
--    Each group module is owned by the teacher of the group its students belong to.
-- ─────────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS _seed_blocks;
CREATE TEMP TABLE _seed_blocks (
  slug text, teacher_email text, name text, topic text, level text, ru_style text,
  visibility text, sort_order int);
INSERT INTO _seed_blocks VALUES
  ('kundalik', 'aziz.karimov@govori.uz',     'Разговорная речь · Быт',      'Быт',          'A1', 'living', 'group',  1),
  ('tanishuv', 'aziz.karimov@govori.uz',     'Знакомство и семья',          'Знакомство',   'A2', 'living', 'group',  2),
  ('sayohat',  'dilnoza.yusupova@govori.uz', 'Путешествия и город',         'Путешествия',  'A2', 'living', 'group',  1),
  ('ish',      'sherzod.rashidov@govori.uz', 'Работа и профессия',          'Работа',       'B1', 'formal', 'group',  1),
  ('ielts',    'nodira.tosheva@govori.uz',   'IELTS Speaking · Part 1',     'IELTS',        'B2', 'formal', 'group',  1),
  ('ochiq',    'aziz.karimov@govori.uz',     'Открытые упражнения · Старт', 'Начальный',    'A1', 'living', 'public', 1);

INSERT INTO question_blocks
  (id, teacher_id, name, topic, level, ru_style, sort_order, visibility, is_published, created_at, updated_at)
SELECT md5('sample:block:'||b.slug)::uuid,
       (SELECT id FROM users WHERE email=b.teacher_email),
       b.name, b.topic, b.level, b.ru_style, b.sort_order, b.visibility, true, now(), now()
FROM _seed_blocks b
ON CONFLICT (id) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────────
-- 6) QUESTIONS (tasks) — 20 text tasks across the 6 modules, published, ascending
--    sort_order. teacher_id / is_public inherited from the parent module.
-- ─────────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS _seed_tasks;
CREATE TEMP TABLE _seed_tasks (
  block_slug text, task_n int, title text, prompt text, prep int, alimit int);
INSERT INTO _seed_tasks VALUES
  -- kundalik (A1, Aziz, group) — 4 tasks
  ('kundalik', 1, 'Утро',            'Расскажите, как обычно проходит ваше утро. Во сколько вы встаёте и что делаете?', 15, 60),
  ('kundalik', 2, 'Покупки',         'Опишите, как вы делаете покупки в магазине. Что вы обычно покупаете?',            15, 60),
  ('kundalik', 3, 'Погода',          'Какая сегодня погода? Опишите её и скажите, нравится ли она вам.',                15, 60),
  ('kundalik', 4, 'Выходной день',   'Как вы провели последние выходные? Расскажите подробно.',                        20, 75),
  -- tanishuv (A2, Aziz, group) — 3 tasks
  ('tanishuv', 1, 'О себе',          'Представьтесь: как вас зовут, сколько вам лет и чем вы занимаетесь.',             15, 60),
  ('tanishuv', 2, 'Моя семья',       'Расскажите о своей семье: кто в неё входит и чем они занимаются.',               20, 75),
  ('tanishuv', 3, 'Мой друг',        'Опишите вашего лучшего друга: как он выглядит и какой у него характер.',          20, 75),
  -- sayohat (A2, Dilnoza, group) — 3 tasks
  ('sayohat',  1, 'Мой город',       'Расскажите о городе, в котором вы живёте. Что в нём есть интересного?',           20, 75),
  ('sayohat',  2, 'Любимое место',   'Опишите ваше любимое место в городе и объясните, почему оно вам нравится.',       20, 75),
  ('sayohat',  3, 'Путешествие мечты','Куда бы вы хотели поехать и почему? Расскажите о путешествии мечты.',            25, 90),
  -- ish (B1, Sherzod, group) — 3 tasks
  ('ish',      1, 'Моя профессия',   'Расскажите о вашей работе или будущей профессии. Почему вы её выбрали?',          25, 90),
  ('ish',      2, 'Рабочий день',    'Опишите ваш типичный рабочий или учебный день от начала до конца.',               25, 90),
  ('ish',      3, 'Планы на будущее','Каким вы видите себя через пять лет? Расскажите о ваших планах.',                 30, 120),
  -- ielts (B2, Nodira, group) — 3 tasks
  ('ielts',    1, 'Hometown',        'Describe your hometown. What do you like and dislike about it? (IELTS Part 1)',   30, 120),
  ('ielts',    2, 'Hobbies',         'Talk about your hobbies and free-time activities. (IELTS Part 1)',                30, 120),
  ('ielts',    3, 'Daily routine',   'Describe a typical day in your life. (IELTS Part 1)',                             30, 120),
  -- ochiq (A1, Aziz, PUBLIC) — 4 tasks (freemium gate: first 3 free, 4th premium-locked)
  ('ochiq',    1, 'Приветствие',     'Поздоровайтесь и коротко представьтесь.',                                        10, 45),
  ('ochiq',    2, 'Числа',           'Посчитайте вслух от одного до десяти.',                                          10, 45),
  ('ochiq',    3, 'Цвета',           'Назовите пять цветов и по одному предмету каждого цвета.',                       10, 45),
  ('ochiq',    4, 'Дни недели',      'Назовите дни недели по порядку и скажите, какой сегодня день.',                  10, 45);

INSERT INTO questions
  (id, teacher_id, type, title, prompt_text, level, prep_time_sec, answer_time_limit_sec,
   is_published, is_deleted, is_public, block_id, ru_style, instruction_text, topic, sort_order,
   created_at, updated_at)
SELECT md5('sample:q:'||t.block_slug||':'||t.task_n)::uuid,
       qb.teacher_id, 'text'::question_type, t.title, t.prompt, qb.level, t.prep, t.alimit,
       true, false, (qb.visibility = 'public'), qb.id, qb.ru_style,
       'Нажмите «Запись», подготовьтесь и говорите чётко.', qb.topic, t.task_n,
       now(), now()
FROM _seed_tasks t
JOIN question_blocks qb ON qb.id = md5('sample:block:'||t.block_slug)::uuid
ON CONFLICT (id) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────────
-- 7) RESULTS — done submissions + transcript + evaluation + xp_event for each.
--    The completion matrix leaves some tasks unattempted so sequential-lock / next-task
--    / freemium-lock states are all exercised in the UI. Scores are derived
--    deterministically from a hash of the row (0..100 scale, matching the app).
-- ─────────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS _seed_results;
CREATE TEMP TABLE _seed_results (student_email text, block_slug text, task_n int);
INSERT INTO _seed_results VALUES
  -- kundalik (Group A)
  ('jasur.abdullayev@govori.uz','kundalik',1), ('jasur.abdullayev@govori.uz','kundalik',2), ('jasur.abdullayev@govori.uz','kundalik',3),
  ('malika.ibragimova@govori.uz','kundalik',1),('malika.ibragimova@govori.uz','kundalik',2),
  ('bekzod.nazarov@govori.uz','kundalik',1),
  ('sevara.umarova@govori.uz','kundalik',1),   ('sevara.umarova@govori.uz','kundalik',2),   ('sevara.umarova@govori.uz','kundalik',3),   ('sevara.umarova@govori.uz','kundalik',4),
  ('otabek.sultonov@govori.uz','kundalik',1),
  -- tanishuv (Group A)
  ('jasur.abdullayev@govori.uz','tanishuv',1),
  ('sevara.umarova@govori.uz','tanishuv',1),   ('sevara.umarova@govori.uz','tanishuv',2),
  -- ochiq (public)
  ('jasur.abdullayev@govori.uz','ochiq',1),    ('jasur.abdullayev@govori.uz','ochiq',2),    ('jasur.abdullayev@govori.uz','ochiq',3),
  ('sevara.umarova@govori.uz','ochiq',1),      ('sevara.umarova@govori.uz','ochiq',2),      ('sevara.umarova@govori.uz','ochiq',3),
  ('malika.ibragimova@govori.uz','ochiq',1),
  -- sayohat (Group B)
  ('sevara.umarova@govori.uz','sayohat',1),    ('sevara.umarova@govori.uz','sayohat',2),
  ('kamola.ergasheva@govori.uz','sayohat',1),  ('kamola.ergasheva@govori.uz','sayohat',2),
  ('farrux.yuldashev@govori.uz','sayohat',1),
  ('otabek.sultonov@govori.uz','sayohat',1),
  -- ish (Group C)
  ('kamola.ergasheva@govori.uz','ish',1),
  ('nilufar.qodirova@govori.uz','ish',1),      ('nilufar.qodirova@govori.uz','ish',2),
  ('sardor.mirzayev@govori.uz','ish',1),
  -- ielts (Group D)
  ('sardor.mirzayev@govori.uz','ielts',1),     ('sardor.mirzayev@govori.uz','ielts',2),
  ('gulnora.saidova@govori.uz','ielts',1);

-- Materialise ids, student, timestamps and a stable per-row seed once.
DROP TABLE IF EXISTS _seed_sub;
CREATE TEMP TABLE _seed_sub AS
SELECT
  r.student_email, r.block_slug, r.task_n,
  md5('sample:sub:'||r.student_email||':'||r.block_slug||':'||r.task_n)::uuid AS sub_id,
  md5('sample:q:'||r.block_slug||':'||r.task_n)::uuid                          AS question_id,
  (SELECT id FROM users WHERE email = r.student_email)                         AS student_id,
  (hashtext('sample:sub:'||r.student_email||':'||r.block_slug||':'||r.task_n) & 2147483647) AS seed
FROM _seed_results r;

-- Derived, human-plausible values (kept in a second temp table so all four inserts agree).
DROP TABLE IF EXISTS _seed_scored;
CREATE TEMP TABLE _seed_scored AS
SELECT s.*,
  (now() - ((s.seed % 6) || ' days')::interval - (((s.seed/6) % 8) || ' hours')::interval) AS ts,
  round((58 + (s.seed % 33) + ((s.seed/17) % 10) / 10.0)::numeric, 1)::float8 AS overall,   -- 58.0..90.9
  round((52 + ((s.seed/2)  % 44) + ((s.seed/19) % 10)/10.0)::numeric, 1)::float8 AS fluency,
  round((55 + ((s.seed/3)  % 42) + ((s.seed/23) % 10)/10.0)::numeric, 1)::float8 AS lexical,
  round((50 + ((s.seed/5)  % 46) + ((s.seed/29) % 10)/10.0)::numeric, 1)::float8 AS grammar,
  round((55 + ((s.seed/7)  % 40) + ((s.seed/31) % 10)/10.0)::numeric, 1)::float8 AS pron,
  round((60 + ((s.seed/11) % 38))::numeric, 1)::float8                              AS relevance,
  round((30 + (s.seed % 90))::numeric, 1)::float8                                   AS dur
FROM _seed_sub s;

INSERT INTO submissions
  (id, student_id, question_id, audio_key, audio_duration_sec, status, completed_at,
   reference_text, created_at, updated_at)
SELECT sub_id, student_id, question_id, 'seed/audio/'||sub_id||'.webm', dur,
       'done'::submission_status, ts, NULL, ts, ts
FROM _seed_scored
ON CONFLICT (id) DO NOTHING;

INSERT INTO transcripts
  (id, submission_id, text, language, word_timestamps, stt_model, pronunciation, created_at, updated_at)
SELECT md5('sample:tr:'||sub_id::text)::uuid, sub_id,
       'Здравствуйте. Я хочу рассказать об этой теме. Думаю, это очень интересно и полезно для меня.',
       'ru',
       '[{"w":"здравствуйте","start":0.0,"end":0.7},{"w":"я","start":0.8,"end":0.9},{"w":"хочу","start":0.9,"end":1.3},{"w":"рассказать","start":1.3,"end":2.0}]'::jsonb,
       'seed-stt-v1',
       ('{"overall": '||round(pron)::int||', "words": [{"w":"здравствуйте","score":'||((seed%20)+78)||'},{"w":"рассказать","score":'||((seed%25)+70)||'}]}')::jsonb,
       ts, ts
FROM _seed_scored
ON CONFLICT (submission_id) DO NOTHING;

INSERT INTO evaluations
  (id, submission_id, fluency_score, lexical_score, grammar_score, pronunciation_score,
   overall_band, relevance_score, level_score, naturalness_score, speech_rate_score,
   feedback, corrections, llm_model, created_at, updated_at)
SELECT md5('sample:eval:'||sub_id::text)::uuid, sub_id,
       fluency, lexical, grammar, pron,
       overall, relevance, overall,                          -- level_score = overall → drives EffectiveBand
       round((55 + (seed % 40))::numeric,1)::float8,          -- naturalness
       round((60 + ((seed/3) % 35))::numeric,1)::float8,     -- speech_rate
       ('{"summary": "Хороший ответ. Речь понятна, продолжайте практиковаться и следите за падежами.",'
         ||'"strengths": ["Понятная речь", "Достаточный словарный запас"],'
         ||'"improvements": ["Падежи существительных", "Темп речи"],'
         ||'"vocabulary_suggestions": ["впечатление", "поэтому", "например"]}')::jsonb,
       '[{"type":"word_order","original":"я ходил вчера в магазин","corrected":"вчера я ходил в магазин","explanation":"Обстоятельство времени лучше в начале."}]'::jsonb,
       'seed-grader-v1', ts, ts
FROM _seed_scored
ON CONFLICT (submission_id) DO NOTHING;

-- One XP event per graded answer (weekly leaderboard + Home XP feed). amount ≈ round(band/4).
INSERT INTO xp_events (id, student_id, submission_id, amount, reason, created_at, updated_at)
SELECT md5('sample:xp:'||sub_id::text)::uuid, student_id, sub_id,
       GREATEST(1, round(overall/4.0)::int), 'submission', ts, ts
FROM _seed_scored
ON CONFLICT (id) DO NOTHING;

-- A few streak / practice bonus XP events for the most active students (enriches the feed).
INSERT INTO xp_events (id, student_id, submission_id, amount, reason, created_at, updated_at)
VALUES
  (md5('sample:xpbonus:sevara:1')::uuid, (SELECT id FROM users WHERE email='sevara.umarova@govori.uz'), NULL, 10, 'streak',   now() - interval '1 day',  now()),
  (md5('sample:xpbonus:sevara:2')::uuid, (SELECT id FROM users WHERE email='sevara.umarova@govori.uz'), NULL, 5,  'practice', now() - interval '2 days', now()),
  (md5('sample:xpbonus:jasur:1')::uuid,  (SELECT id FROM users WHERE email='jasur.abdullayev@govori.uz'),NULL, 10, 'streak',   now() - interval '1 day',  now()),
  (md5('sample:xpbonus:kamola:1')::uuid, (SELECT id FROM users WHERE email='kamola.ergasheva@govori.uz'),NULL, 5,  'practice', now() - interval '3 days', now())
ON CONFLICT (id) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────────
-- 8) ASSIGNMENTS — teacher → whole-group (one row per member, group_id set).
-- ─────────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS _seed_assign;
CREATE TEMP TABLE _seed_assign (group_slug text, teacher_email text, block_slug text, task_n int, due_days int);
INSERT INTO _seed_assign VALUES
  ('gA', 'aziz.karimov@govori.uz',     'kundalik', 4, 7),
  ('gB', 'dilnoza.yusupova@govori.uz', 'sayohat',  3, 5);

INSERT INTO assignments (id, teacher_id, student_id, question_id, group_id, due_at, created_at, updated_at)
SELECT md5('sample:assign:'||a.group_slug||':'||a.block_slug||':'||a.task_n||':'||m.student_email)::uuid,
       (SELECT id FROM users WHERE email=a.teacher_email),
       (SELECT id FROM users WHERE email=m.student_email),
       md5('sample:q:'||a.block_slug||':'||a.task_n)::uuid,
       md5('sample:group:'||a.group_slug)::uuid,
       now() + (a.due_days||' days')::interval, now(), now()
FROM _seed_assign a
JOIN _seed_members m ON m.group_slug = a.group_slug
ON CONFLICT (id) DO NOTHING;

-- Link Sevara's completed kundalik #4 answer to her group-A assignment (feeds the class board).
UPDATE submissions
   SET assignment_id = md5('sample:assign:gA:kundalik:4:sevara.umarova@govori.uz')::uuid
 WHERE id = md5('sample:sub:sevara.umarova@govori.uz:kundalik:4')::uuid
   AND assignment_id IS NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- 9) REVIEW_ITEMS — SRS items due now for a couple of students.
-- ─────────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS _seed_reviews;
CREATE TEMP TABLE _seed_reviews (student_email text, block_slug text, task_n int, dim text, ivl int, due_expr text);
INSERT INTO _seed_reviews VALUES
  ('jasur.abdullayev@govori.uz','kundalik',1,'grammar',       0, '-1 day'),
  ('jasur.abdullayev@govori.uz','kundalik',2,'fluency',       0, '-2 hours'),
  ('kamola.ergasheva@govori.uz','sayohat', 1,'lexical',       1, '-3 hours'),
  ('nilufar.qodirova@govori.uz','ish',     2,'grammar',       0, '-5 hours'),
  ('sardor.mirzayev@govori.uz', 'ish',     1,'pronunciation', 0, '6 hours');

INSERT INTO review_items (id, student_id, question_id, weakness_dim, interval_index, due_at, completed, created_at, updated_at)
SELECT md5('sample:review:'||v.student_email||':'||v.block_slug||':'||v.task_n)::uuid,
       (SELECT id FROM users WHERE email=v.student_email),
       md5('sample:q:'||v.block_slug||':'||v.task_n)::uuid,
       v.dim, v.ivl, now() + v.due_expr::interval, false, now(), now()
FROM _seed_reviews v
ON CONFLICT (id) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────────
-- 10) NOTIFICATIONS — 2-3 per several users, mix read/unread.
-- ─────────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS _seed_notifs;
CREATE TEMP TABLE _seed_notifs (user_email text, idx int, ntype text, title text, body text, link text, is_read boolean);
INSERT INTO _seed_notifs VALUES
  ('jasur.abdullayev@govori.uz', 1, 'assignment', 'Новое задание',        'Учитель Aziz назначил вам задание «Выходной день».',            '/tasks',    false),
  ('jasur.abdullayev@govori.uz', 2, 'grade',      'Ответ оценён',         'Ваш ответ «Утро» получил оценку. Посмотрите отзыв.',           '/progress', true),
  ('jasur.abdullayev@govori.uz', 3, 'streak',     'Серия продолжается!',  'Вы занимались 6 дней подряд. Так держать!',                    NULL,        false),
  ('sevara.umarova@govori.uz',   1, 'grade',      'Модуль завершён',      'Поздравляем! Вы прошли модуль «Разговорная речь · Быт».',      '/modules',  false),
  ('sevara.umarova@govori.uz',   2, 'system',     'Премиум активирован',  'Вам открыт полный доступ ко всем модулям.',                    NULL,        true),
  ('kamola.ergasheva@govori.uz', 1, 'assignment', 'Новое задание',        'Учитель Dilnoza назначила задание «Путешествие мечты».',        '/tasks',    false),
  ('kamola.ergasheva@govori.uz', 2, 'review',     'Пора повторить',       'У вас есть задания для повторения. Загляните в раздел «Повторение».', '/review', false),
  ('malika.ibragimova@govori.uz',1, 'grade',      'Ответ оценён',         'Ваш ответ «Покупки» получил новую оценку.',                    '/progress', true),
  ('malika.ibragimova@govori.uz',2, 'streak',     'Не теряйте серию',     'Позанимайтесь сегодня, чтобы сохранить свою серию.',           NULL,        false),
  ('aziz.karimov@govori.uz',     1, 'system',     'Новый ученик',         'Jasur присоединился к вашей группе A1.',                        '/groups',   false),
  ('aziz.karimov@govori.uz',     2, 'system',     'Сдано задание',        'Sevara выполнила задание в группе A1.',                         '/groups',   true);

INSERT INTO notifications (id, user_id, type, title, body, link, is_read, created_at, updated_at)
SELECT md5('sample:notif:'||n.user_email||':'||n.idx)::uuid,
       (SELECT id FROM users WHERE email=n.user_email),
       n.ntype, n.title, n.body, n.link, n.is_read,
       now() - (n.idx || ' hours')::interval, now()
FROM _seed_notifs n
ON CONFLICT (id) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────────
-- 11) SHADOWING_PHRASES — a handful for the "Eshit va takrorla" screen.
-- ─────────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS _seed_phrases;
CREATE TEMP TABLE _seed_phrases (n int, author_email text, text text, level text);
INSERT INTO _seed_phrases VALUES
  (1, 'aziz.karimov@govori.uz',     'Здравствуйте, как ваши дела?',                          'A1'),
  (2, 'aziz.karimov@govori.uz',     'Меня зовут Пётр, а как вас зовут?',                     'A1'),
  (3, 'dilnoza.yusupova@govori.uz', 'Я хотел бы заказать столик на двоих, пожалуйста.',      'A2'),
  (4, 'sherzod.rashidov@govori.uz', 'Не могли бы вы повторить это ещё раз, помедленнее?',    'A2'),
  (5, 'nodira.tosheva@govori.uz',   'Честно говоря, я не совсем с этим согласен.',           'B1'),
  (6, 'nodira.tosheva@govori.uz',   'Это во многом зависит от обстоятельств.',               'B1');

INSERT INTO shadowing_phrases (id, created_by, text, level, is_active, created_at, updated_at)
SELECT md5('sample:phrase:'||p.n)::uuid,
       (SELECT id FROM users WHERE email=p.author_email),
       p.text, p.level, true, now(), now()
FROM _seed_phrases p
ON CONFLICT (id) DO NOTHING;


-- Clean up temp scaffolding (also auto-dropped at session end).
DROP TABLE IF EXISTS _seed_groups;
DROP TABLE IF EXISTS _seed_members;
DROP TABLE IF EXISTS _seed_blocks;
DROP TABLE IF EXISTS _seed_tasks;
DROP TABLE IF EXISTS _seed_results;
DROP TABLE IF EXISTS _seed_sub;
DROP TABLE IF EXISTS _seed_scored;
DROP TABLE IF EXISTS _seed_assign;
DROP TABLE IF EXISTS _seed_reviews;
DROP TABLE IF EXISTS _seed_notifs;
DROP TABLE IF EXISTS _seed_phrases;
