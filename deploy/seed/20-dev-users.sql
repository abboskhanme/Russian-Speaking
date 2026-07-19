-- Dev-only login accounts (DEV STACK ONLY — never mount this in prod).
-- Runs AFTER the demo dump (10-seed.sql.gz) on first init of an empty db volume.
-- All three share password:  Parol123!
--   student@govori.uz  ·  teacher@govori.uz  ·  admin@govori.uz
-- Hash = bcrypt $2b$12$ of "Parol123!" (same scheme as prod: BCrypt.Net-Next / python bcrypt).
INSERT INTO users (id, email, password_hash, full_name, role, is_active)
VALUES
  (gen_random_uuid(), 'student@govori.uz', '$2b$12$g75bPHh6YmJRoVn4NUDFBe6Qo6plRjc3xAgahpafi6HdBZrMQ7JJO', 'Talaba Demo', 'student', true),
  (gen_random_uuid(), 'teacher@govori.uz', '$2b$12$g75bPHh6YmJRoVn4NUDFBe6Qo6plRjc3xAgahpafi6HdBZrMQ7JJO', 'Ustoz Demo',  'teacher', true),
  (gen_random_uuid(), 'admin@govori.uz',   '$2b$12$g75bPHh6YmJRoVn4NUDFBe6Qo6plRjc3xAgahpafi6HdBZrMQ7JJO', 'Admin Demo',  'admin',   true)
ON CONFLICT (email) DO NOTHING;
