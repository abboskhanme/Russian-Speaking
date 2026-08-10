#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# dev-refresh-fixture.sh — slide the DEV activity fixture forward so it is
# "today"-relative again. DEV ONLY. Never point this at prod.
#
# WHY THIS EXISTS. The seed is already relative: 30-sample-data.sql writes
# `now() - (0..5 days) - (0..7 hours)`, so on a fresh volume every answer lands
# inside the last six days. But the seed runs ONCE, on a fresh volume's initdb,
# and it is idempotent (ON CONFLICT DO NOTHING) — so re-running it changes
# nothing. Weeks later the newest answer is weeks old and every "this week"
# number on the teacher panel legitimately reads 0: Faol o'quvchi 0/6, Haftalik
# mashq 0 daq, Bu hafta baholandi 0, and the weekly chart is a flat axis.
#
# That is CORRECT behaviour, not a bug — which is exactly why it is annoying:
# there is nothing to fix in the code, and the only way to see those screens
# populated is to make the fixture current again.
#
# WHAT IT DOES. Computes one delta — how far the newest activity row is behind
# now — and adds the SAME delta to every timestamp on the activity tables.
#
#   * ONE delta for everything, so relative spacing and ordering are preserved
#     exactly. This matters beyond tidiness: an assignment counts as completed
#     only when a matching answer is NOT older than it, so shifting answers
#     without shifting assignments by the same amount would silently flip the
#     completion rate.
#   * Identity and content rows (users, groups, questions, modules) are left
#     alone. Sliding those would rewrite account history and "qo'shilgan" dates
#     to no benefit — answers still land after their student joined, because the
#     shift only ever moves rows FORWARD.
#   * The delta comes from the newest ANSWER's created_at — the column every
#     screen actually reads. Deriving it from the greatest timestamp of any kind
#     under-shifts, because bookkeeping columns like updated_at get touched by
#     ordinary testing and are already near now, which pins the delta and leaves
#     created_at days behind. Anything that would land in the future afterwards
#     (a reviewed_at, an updated_at) is clamped back to now.
#   * Runs in ONE transaction: either the whole fixture moves or none of it does.
#
# Safe to run repeatedly; a fixture that is already current shifts by ~0.
#
# Usage:  ./deploy/dev-refresh-fixture.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

DB_USER="${POSTGRES_USER:-russpeak}"
DB_NAME="${POSTGRES_DB:-russpeak}"
CONTAINER="${DB_CONTAINER:-govori-db}"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "✗ $CONTAINER is not running. Start the stack first: docker compose up -d" >&2
  exit 1
fi

psql_run() { docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" "$@"; }

echo "── before ───────────────────────────────────────────────"
psql_run -c "
SELECT max(created_at)::date AS newest_answer,
       count(*) FILTER (WHERE created_at > now() - interval '7 days') AS in_last_7_days,
       count(*) AS total
FROM submissions;"

# One delta for the whole fixture, taken from the newest ANSWER.
psql_run -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;

CREATE TEMP TABLE _shift ON COMMIT DROP AS
SELECT GREATEST(now() - COALESCE(max(created_at), now()), interval '0') AS d
FROM submissions;

\echo 'shifting the activity fixture forward by:'
SELECT d FROM _shift;

UPDATE submissions SET
  created_at  = created_at  + (SELECT d FROM _shift),
  updated_at  = updated_at  + (SELECT d FROM _shift),
  completed_at = completed_at + (SELECT d FROM _shift),
  reviewed_at  = reviewed_at  + (SELECT d FROM _shift),
  audio_deleted_at = audio_deleted_at + (SELECT d FROM _shift);

UPDATE transcripts SET
  created_at = created_at + (SELECT d FROM _shift),
  updated_at = updated_at + (SELECT d FROM _shift);

UPDATE evaluations SET
  created_at = created_at + (SELECT d FROM _shift),
  updated_at = updated_at + (SELECT d FROM _shift);

UPDATE xp_events SET
  created_at = created_at + (SELECT d FROM _shift),
  updated_at = updated_at + (SELECT d FROM _shift);

-- Same delta as submissions, or the "completed" rule (an answer not older than
-- its assignment) would start reporting differently.
UPDATE assignments SET
  created_at = created_at + (SELECT d FROM _shift),
  updated_at = updated_at + (SELECT d FROM _shift),
  due_at     = due_at     + (SELECT d FROM _shift);

UPDATE review_items SET
  created_at = created_at + (SELECT d FROM _shift),
  updated_at = updated_at + (SELECT d FROM _shift),
  due_at     = due_at     + (SELECT d FROM _shift);

UPDATE notifications SET
  created_at = created_at + (SELECT d FROM _shift),
  updated_at = updated_at + (SELECT d FROM _shift);

-- Clamp: a row whose bookkeeping column was already near now gets pushed past it
-- by the shift. Harmless for updated_at, but a reviewed_at in the future would be
-- counted by "Bu hafta baholandi" while reading as impossible in the data.
UPDATE submissions SET updated_at  = now() WHERE updated_at  > now();
UPDATE submissions SET reviewed_at = now() WHERE reviewed_at > now();
UPDATE transcripts  SET updated_at = now() WHERE updated_at > now();
UPDATE evaluations  SET updated_at = now() WHERE updated_at > now();
UPDATE xp_events    SET updated_at = now() WHERE updated_at > now();
UPDATE assignments  SET updated_at = now() WHERE updated_at > now();
UPDATE review_items SET updated_at = now() WHERE updated_at > now();
UPDATE notifications SET updated_at = now() WHERE updated_at > now();
-- due_at is deliberately NOT clamped: a deadline in the future is the point.

COMMIT;
SQL

echo "── after ────────────────────────────────────────────────"
psql_run -c "
SELECT max(created_at)::date AS newest_answer,
       count(*) FILTER (WHERE created_at > now() - interval '7 days') AS in_last_7_days,
       count(*) AS total
FROM submissions;"

echo "✓ fixture refreshed. The teacher panel's weekly numbers have data again."
