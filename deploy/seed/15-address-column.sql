-- Additive registration "Manzil" column.
--
-- The demo dump (10-seed.sql.gz) creates `users` WITHOUT the free-text street/house/apartment
-- field, so this ALTER must run AFTER the dump and BEFORE the dev/sample seeds (20-dev-users.sql,
-- 30-sample-data.sql) that insert users — hence the 15- prefix (Postgres initdb runs files in
-- lexical order). Idempotent (IF NOT EXISTS) so it is safe on any DB, seeded or live. Region and
-- district already exist in the dump; only `address` is new.
ALTER TABLE users ADD COLUMN IF NOT EXISTS address varchar;
