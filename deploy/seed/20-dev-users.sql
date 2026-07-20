-- Dev-only login accounts (DEV STACK ONLY — never mount this in prod).
-- Runs AFTER the demo dump (10-seed.sql.gz) on first init of an empty db volume.
--
-- AUTH IS PHONE + OTP (Telegram). In dev, no Telegram token is set, so the API uses the dev
-- delivery stub: it accepts the FIXED code 000000 for ANY phone. So to log in as a dev user:
--   POST /api/auth/otp/request  { "phone": "<one of the phones below>" }
--   POST /api/auth/otp/verify   { "phone": "<same phone>", "code": "000000" }  → tokens
-- Each dev user has a UNIQUE +998 phone. (The legacy bcrypt password Parol123! is kept in the
-- hash only for historical parity; email/password login no longer exists.)
--   student@govori.uz  +998901112233  ·  teacher@govori.uz  +998901112234  ·  admin@govori.uz  +998901112235
-- Idempotent: DO UPDATE backfills the phone onto pre-existing rows (dev users seeded before the
-- phone-OTP rewrite had a NULL phone).
INSERT INTO users (id, email, password_hash, full_name, role, is_active, phone)
VALUES
  (gen_random_uuid(), 'student@govori.uz', '$2b$12$g75bPHh6YmJRoVn4NUDFBe6Qo6plRjc3xAgahpafi6HdBZrMQ7JJO', 'Talaba Demo', 'student', true, '+998901112233'),
  (gen_random_uuid(), 'teacher@govori.uz', '$2b$12$g75bPHh6YmJRoVn4NUDFBe6Qo6plRjc3xAgahpafi6HdBZrMQ7JJO', 'Ustoz Demo',  'teacher', true, '+998901112234'),
  (gen_random_uuid(), 'admin@govori.uz',   '$2b$12$g75bPHh6YmJRoVn4NUDFBe6Qo6plRjc3xAgahpafi6HdBZrMQ7JJO', 'Admin Demo',  'admin',   true, '+998901112235')
ON CONFLICT (email) DO UPDATE SET phone = EXCLUDED.phone;
