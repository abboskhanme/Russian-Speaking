#!/usr/bin/env bash
# dev-role.sh — flip a LOCAL dev account between student and teacher, so you can
# test the teacher panel from your OWN phone number without a second SIM.
#
#   ./dev-role.sh status
#   ./dev-role.sh teacher +998901234567
#   ./dev-role.sh student +998901234567
#
# Why this exists: Telegram OTP proves phone ownership via a contact share, so
# you cannot sign in as a demo teacher from your own Telegram. The only way to
# be a teacher on your own number is for YOUR account to hold the teacher role.
#
# "teacher" mode lends you EVERY row the donor teacher owns. The set is exactly the
# tables carrying a teacher_id column, and each one backs a different screen —
# missing any single one leaves a panel mysteriously empty:
#   groups          — the roster ("your students")
#   questions       — PracticeService.ListAsync scopes a teacher to answers to
#                     their OWN questions AND their OWN roster, so owning the
#                     group alone still yields an empty grading queue
#   assignments     — ListAssignmentsTeacherAsync filters on who CREATED the
#                     assignment, not on the question's owner, so without this a
#                     group's "Faol topshiriqlar" comes back empty
#   question_blocks — the Kontent > Modullar list
#   topics          — topic-scoped content
# Keep this list in sync with:
#   select table_name from information_schema.columns where column_name = 'teacher_id';
#
# Fully reversible: "student" hands everything back to the donor and restores the
# role. Nothing here touches prod — it talks to the local govori-db container.
#
# TEMPORARY dev aid — delete alongside TEACHER-PANEL-PLAN.md when the teacher
# panel is done.
set -euo pipefail

DB_CONTAINER="govori-db"
DB_USER="russpeak"
DB_NAME="russpeak"
# The demo teacher whose groups + questions get lent out.
DONOR_EMAIL="teacher1@demo.uz"

psql() { docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" "$@"; }

usage() {
  echo "usage: $0 {status|teacher <phone>|student <phone>}" >&2
  exit 2
}

[ $# -ge 1 ] || usage
MODE="$1"

if [ "$MODE" = "status" ]; then
  psql -c "
    select u.full_name, u.phone, u.role,
      (select count(*) from groups g where g.teacher_id = u.id) as groups,
      (select count(*) from questions q where q.teacher_id = u.id) as questions
    from users u
    where u.role in ('teacher','admin') or u.phone is not null
    order by u.role, u.created_at;"
  exit 0
fi

[ $# -eq 2 ] || usage
PHONE="$2"

case "$MODE" in
  teacher)
    psql -v ON_ERROR_STOP=1 -q <<SQL
BEGIN;
-- Oldest account wins, mirroring how login resolves a duplicated phone.
CREATE TEMP TABLE t AS
  SELECT id FROM users WHERE phone = '$PHONE' ORDER BY created_at LIMIT 1;
CREATE TEMP TABLE d AS SELECT id FROM users WHERE email = '$DONOR_EMAIL';

DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM t) THEN
    RAISE EXCEPTION 'No user with phone $PHONE — register on that number first.';
  END IF;
END \$\$;

UPDATE users SET role = 'teacher' WHERE id IN (SELECT id FROM t);
UPDATE groups          SET teacher_id = (SELECT id FROM t) WHERE teacher_id = (SELECT id FROM d);
UPDATE questions       SET teacher_id = (SELECT id FROM t) WHERE teacher_id = (SELECT id FROM d);
UPDATE assignments     SET teacher_id = (SELECT id FROM t) WHERE teacher_id = (SELECT id FROM d);
UPDATE question_blocks SET teacher_id = (SELECT id FROM t) WHERE teacher_id = (SELECT id FROM d);
UPDATE topics          SET teacher_id = (SELECT id FROM t) WHERE teacher_id = (SELECT id FROM d);
COMMIT;
SQL
    echo "✅ $PHONE is now a TEACHER (borrowed $DONOR_EMAIL's groups + questions)."
    echo "   Reload the app — no re-login needed; /api/auth/me re-reads the role."
    ;;

  student)
    psql -v ON_ERROR_STOP=1 -q <<SQL
BEGIN;
CREATE TEMP TABLE t AS
  SELECT id FROM users WHERE phone = '$PHONE' ORDER BY created_at LIMIT 1;
CREATE TEMP TABLE d AS SELECT id FROM users WHERE email = '$DONOR_EMAIL';

UPDATE groups          SET teacher_id = (SELECT id FROM d) WHERE teacher_id = (SELECT id FROM t);
UPDATE questions       SET teacher_id = (SELECT id FROM d) WHERE teacher_id = (SELECT id FROM t);
UPDATE assignments     SET teacher_id = (SELECT id FROM d) WHERE teacher_id = (SELECT id FROM t);
UPDATE question_blocks SET teacher_id = (SELECT id FROM d) WHERE teacher_id = (SELECT id FROM t);
UPDATE topics          SET teacher_id = (SELECT id FROM d) WHERE teacher_id = (SELECT id FROM t);
UPDATE users SET role = 'student' WHERE id IN (SELECT id FROM t);
COMMIT;
SQL
    echo "✅ $PHONE is back to STUDENT; $DONOR_EMAIL has its everything the donor teacher owns back."
    echo "   Reload the app."
    ;;

  *) usage ;;
esac
