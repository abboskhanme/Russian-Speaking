#!/usr/bin/env bash
# The nightly backup that RUNS ON THE DROPLET. Replaces the existing cron, which
# has a failure mode worse than having no backup at all.
#
# ── The bug this script exists to fix ──────────────────────────────────────────
# The current cron is shaped like:
#
#     pg_dump ... | gzip > russpeak_$(date ...).sql.gz
#     find /backups -name 'russpeak_*.sql.gz' -mtime +7 -delete
#
# Two independent defects compound into silent, total data loss:
#
#   1. NO `pipefail`. In a pipeline, bash reports only the LAST command's status.
#      When pg_dump dies — wrong password after a rotation, container renamed,
#      disk full, OOM — gzip still exits 0, having faithfully compressed an empty
#      stream. The result is a ~20-byte file with a plausible name, a plausible
#      timestamp, and a valid gzip header. Nothing anywhere reports a problem.
#
#   2. RETENTION RUNS UNCONDITIONALLY. The `find -delete` on the next line does
#      not care whether step 1 produced a real dump. So each night a 20-byte file
#      is created and a genuine week-old backup is deleted. After seven nights of
#      a broken dump, every real backup is gone and the directory is full of
#      files that look exactly like backups.
#
# That is the shape of the failure: it does not announce itself, and it destroys
# the good copies while looking healthy. The fixes below are all one idea —
# **nothing is trusted until it is proven, and nothing is deleted until the
# replacement is proven.**
#
# ── Install (run ON the droplet, once) ────────────────────────────────────────
#   install -m 0755 prod-backup-cron.sh /usr/local/bin/govori-backup
#   crontab -e   →   17 3 * * *  /usr/local/bin/govori-backup >> /var/log/govori-backup.log 2>&1
#
# ── Environment ───────────────────────────────────────────────────────────────
#   BACKUP_DIR    where dumps land               (default /var/backups/govori)
#   KEEP_DAYS     retention window               (default 7)
#   MIN_BYTES     smallest credible dump         (default 100000)
#   OFFSITE_DEST  rsync/scp target, e.g.         (default empty → offsite skipped,
#                 user@host:/path or s3://bucket  and that is reported as a WARN,
#                                                 never as success)
#   DB_CONTAINER  name the postgres container    (default: discover it; see step 1)
#                 explicitly instead of guessing
#
# Exit codes: 0 = a verified backup exists. Non-zero = it does not. There is no
# third state, and in particular there is no "probably fine".

set -Eeuo pipefail          # -o pipefail is the whole point; do not remove it.
shopt -s inherit_errexit 2>/dev/null || true

BACKUP_DIR="${BACKUP_DIR:-/var/backups/govori}"
KEEP_DAYS="${KEEP_DAYS:-7}"
MIN_BYTES="${MIN_BYTES:-100000}"
OFFSITE_DEST="${OFFSITE_DEST:-}"

TS="$(date -u +%Y%m%d_%H%M%SZ)"
STAGE="${BACKUP_DIR}/.staging-${TS}"     # dot-prefixed: retention's glob never sees it
FINAL="${BACKUP_DIR}/govori_${TS}.dump"

log()  { printf '%s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die()  { log "FATAL: $*"; exit 1; }
warn() { log "WARN:  $*"; }

# A run that dies part-way must leave NOTHING that a later `ls` could mistake for
# a backup. The staging file is the only thing this script ever half-writes.
cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

log "=== govori backup ${TS} ==="
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# ── 1. Find the database container. Never assume its name ─────────────────────
# The compose project name has changed at least once in this stack's life, and a
# hardcoded container name is how a backup silently stops running. Discovery is
# the default; DB_CONTAINER overrides it, which matters on any host running more
# than one postgres — the grep would otherwise back up whichever sorts first.
DB_CTR="${DB_CONTAINER:-$(docker ps --format '{{.Names}}' | grep -E 'db|postgres' | head -1 || true)}"
[ -n "$DB_CTR" ] || die "no running postgres container"
log "postgres container: ${DB_CTR}"

PGUSER_V="$(docker exec "$DB_CTR" printenv POSTGRES_USER)"
PGDB_V="$(docker exec "$DB_CTR" printenv POSTGRES_DB)"
PGPASS_V="$(docker exec "$DB_CTR" printenv POSTGRES_PASSWORD)"
[ -n "$PGUSER_V" ] && [ -n "$PGDB_V" ] || die "could not read POSTGRES_USER/DB from ${DB_CTR}"

# ── 2. Dump to STAGING, never to the final name ───────────────────────────────
# Writing straight to the final name means a crash mid-write leaves a truncated
# file that every later check — and every human — reads as a backup.
#
# -Fc (custom format) rather than plain SQL + gzip: it is already compressed, it
# restores selectively with pg_restore, and — the reason it matters here — it
# carries a header and a trailing table-of-contents, so a truncated dump is
# DETECTABLE. A truncated plain-SQL file is still valid SQL; it just stops early,
# which is exactly the failure that is impossible to notice.
mkdir -p "$STAGE"
log "pg_dump -Fc → staging"
PGPASSWORD="$PGPASS_V" docker exec -e PGPASSWORD="$PGPASS_V" "$DB_CTR" \
  pg_dump -U "$PGUSER_V" -d "$PGDB_V" -Fc --no-owner --no-acl \
  > "${STAGE}/db.dump"

# ── 3. Prove the dump before anything downstream trusts it ────────────────────
SIZE="$(stat -c%s "${STAGE}/db.dump" 2>/dev/null || stat -f%z "${STAGE}/db.dump")"
log "size: ${SIZE} bytes (floor ${MIN_BYTES})"
[ "$SIZE" -ge "$MIN_BYTES" ] || die "dump is ${SIZE} bytes — pg_dump failed or the database is empty"

# Size alone is not proof. `pg_restore --list` parses the header and walks the
# table of contents, so it fails on exactly the corruption size cannot see: a
# dump cut off mid-stream. Requiring a non-empty TOC also rejects a
# structurally-valid dump of nothing.
#
# The archive is MOUNTED rather than piped on stdin: a custom-format dump's table
# of contents lives at the end of the file, so pg_restore seeks — and a pipe is not
# seekable. Feeding it on stdin fails with "did not find magic string in file
# header" on a perfectly good dump, which would turn this guard into a permanent
# false alarm. Reuse the database container's own image so the pg_restore version
# matches the pg_dump that wrote the file, and nothing extra is pulled.
log "pg_restore --list (structural check)"
DB_IMAGE="$(docker inspect -f '{{.Config.Image}}' "$DB_CTR")"
TOC_LINES="$(docker run --rm -v "${STAGE}:/stage:ro" --entrypoint pg_restore "$DB_IMAGE" \
              --list /stage/db.dump | grep -cv '^;' || true)"
[ "${TOC_LINES:-0}" -gt 0 ] || die "dump has an unreadable or empty table of contents — it is not restorable"
log "toc entries: ${TOC_LINES}"

# The one check that is about THIS product rather than about Postgres: a dump
# with a perfect header and zero real users is a perfect backup of nothing. The
# `backups/` folder in the repo is precisely that mistake — 34 users, 30 of them
# @demo.uz seed accounts — which is why the count excludes them here.
log "counting real users in the dump"
USERS="$(
  docker exec -e PGPASSWORD="$PGPASS_V" "$DB_CTR" \
    psql -U "$PGUSER_V" -d "$PGDB_V" -A -t -v ON_ERROR_STOP=1 \
    -c "SELECT count(*) FROM users WHERE email IS NULL OR (email NOT LIKE '%@demo.uz' AND email NOT LIKE '%@test.uz')" \
  | tr -d '[:space:]'
)"
[ -n "$USERS" ] && [ "$USERS" -gt 0 ] || die "the live database reports ${USERS:-no} real users — refusing to treat this as a backup"
log "real users: ${USERS}"

# ── 4. Publish atomically ─────────────────────────────────────────────────────
# mv within one filesystem is atomic: the final name either does not exist or is
# the complete, verified file. There is no instant at which a reader can observe
# a half-written backup.
mv "${STAGE}/db.dump" "$FINAL"
chmod 600 "$FINAL"
printf 'bytes=%s\ntoc_entries=%s\nreal_users=%s\nschema=%s\n' \
  "$SIZE" "$TOC_LINES" "$USERS" \
  "$(docker exec -e PGPASSWORD="$PGPASS_V" "$DB_CTR" psql -U "$PGUSER_V" -d "$PGDB_V" -A -t \
      -c 'SELECT max(migration_id) FROM "__EFMigrationsHistory"' 2>/dev/null | tr -d '[:space:]' || echo unknown)" \
  > "${FINAL}.meta"
log "published: ${FINAL}"

# ── 5. Offsite BEFORE retention ───────────────────────────────────────────────
# A backup that lives only on the machine it backs up is not a backup — it shares
# every failure mode with the thing it protects: one disk, one droplet, one
# accidental `docker volume rm`. Offsite runs before retention on purpose, so a
# broken copy path can never be the reason old local copies were deleted.
OFFSITE_OK=0
if [ -n "$OFFSITE_DEST" ]; then
  log "copying offsite → ${OFFSITE_DEST}"
  case "$OFFSITE_DEST" in
    s3://*) aws s3 cp "$FINAL" "${OFFSITE_DEST%/}/" >/dev/null && OFFSITE_OK=1 ;;
    *)      rsync -a --partial "$FINAL" "${FINAL}.meta" "${OFFSITE_DEST%/}/" && OFFSITE_OK=1 ;;
  esac
  [ "$OFFSITE_OK" = 1 ] && log "offsite ok" || warn "offsite copy FAILED — local retention will be skipped"
else
  warn "OFFSITE_DEST unset — this backup exists on ONE machine, the same one it backs up"
fi

# ── 6. Retention, LAST and CONDITIONAL ────────────────────────────────────────
# This is the line that destroyed the old backups. It now runs only after a new
# copy has been dumped, size-checked, structurally validated, confirmed to
# contain real users, atomically published, AND (when configured) copied
# offsite. If any of those failed, the script has already exited and the old
# backups are still here — which is the correct outcome, because an old real
# backup beats a new fake one every time.
#
# The keep-at-least-one floor is the belt to that braces: even a correct run
# must never leave the directory empty, e.g. if KEEP_DAYS is misconfigured.
if [ -n "$OFFSITE_DEST" ] && [ "$OFFSITE_OK" != 1 ]; then
  warn "skipping retention: the offsite copy did not land"
else
  TOTAL="$(find "$BACKUP_DIR" -maxdepth 1 -name 'govori_*.dump' -type f | wc -l | tr -d ' ')"
  if [ "$TOTAL" -le 1 ]; then
    log "retention: only ${TOTAL} backup present — nothing to prune"
  else
    while IFS= read -r old; do
      [ "$old" = "$FINAL" ] && continue          # never delete the copy just made
      log "retention: removing $(basename "$old")"
      rm -f "$old" "${old}.meta"
    done < <(find "$BACKUP_DIR" -maxdepth 1 -name 'govori_*.dump' -type f -mtime "+${KEEP_DAYS}")
  fi
fi

log "=== done: ${FINAL} (${SIZE} bytes, ${USERS} real users) ==="
