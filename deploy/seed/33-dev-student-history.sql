-- 33-dev-student-history.sql — graded attempts for the dev login student@govori.uz.
-- Runs on a FRESH volume only (after 10-seed/15/20/30, BEFORE 35 — see docker-compose.yml).
-- DEV ONLY — do not mount for prod.
--
-- 35- gives the dump's students an 8-week history, but the dev login user from 20- is
-- inserted with gen_random_uuid() and has none — so on a fresh database "Talaba Demo" has
-- no results, and the e2e golden path (student-golden-path.spec.ts, step 4: open a graded
-- attempt) fails. It only ever passed on long-lived dev volumes with manual history.
--
-- Three graded attempts on questions 35- already uses (they come from the demo dump).
-- Idempotent: fixed ids + ON CONFLICT DO NOTHING; the student is looked up by email.
BEGIN;
WITH s AS (SELECT id FROM users WHERE email = 'student@govori.uz'),
attempts (sub_id, eval_id, question_id, duration, days_ago, flu, pro, lex, gra, band, lvl) AS (
  VALUES
    ('5e1d0001-0000-4000-8000-000000000001'::uuid, '5e1d0002-0000-4000-8000-000000000001'::uuid, '2025cbb7-64c5-4ed4-abbf-f2229bb1b23b'::uuid, 48,  9, 64, 58, 61, 55, 62, 63),
    ('5e1d0001-0000-4000-8000-000000000002'::uuid, '5e1d0002-0000-4000-8000-000000000002'::uuid, '4710821b-14cd-43c0-848a-68798c90df4f'::uuid, 55,  4, 70, 63, 66, 60, 67, 68),
    ('5e1d0001-0000-4000-8000-000000000003'::uuid, '5e1d0002-0000-4000-8000-000000000003'::uuid, '27acb5c7-3e03-4ec1-9650-ba979fbc4066'::uuid, 51,  1, 74, 68, 70, 63, 71, 72)
),
subs AS (
  INSERT INTO submissions (id, student_id, question_id, audio_key, status, audio_duration_sec, created_at, updated_at)
  SELECT a.sub_id, s.id, a.question_id, 'sample/' || a.sub_id || '.webm', 'done', a.duration,
         now() - make_interval(days => a.days_ago), now() - make_interval(days => a.days_ago)
  FROM attempts a CROSS JOIN s
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO evaluations (id, submission_id, fluency_score, pronunciation_score, lexical_score, grammar_score, overall_band, level_score, created_at, updated_at)
SELECT a.eval_id, a.sub_id, a.flu, a.pro, a.lex, a.gra, a.band, a.lvl,
       now() - make_interval(days => a.days_ago), now() - make_interval(days => a.days_ago)
FROM attempts a
WHERE a.sub_id IN (SELECT id FROM subs)
ON CONFLICT (id) DO NOTHING;
COMMIT;
