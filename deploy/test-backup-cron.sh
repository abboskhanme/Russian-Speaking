#!/usr/bin/env bash
# Proves `prod-backup-cron.sh` refuses to destroy good backups when the dump is bad.
#
# The defect this guards against is not hypothetical: the cron it replaces created a
# ~20-byte "backup" whenever pg_dump failed, then deleted a genuine week-old one on
# the next line — every night, silently, until nothing real was left. A fix to that
# is worth exactly as much as the test that shows it holds, so this script builds a
# throwaway Postgres, feeds the backup script a database that CANNOT produce a valid
# dump, and asserts the old backups are still there afterwards.
#
# Cases 5–12 cover the audio half and the alerting: they boot the REAL prod
# `minio` + `minio-init` services from docker-compose.prod.yml under a scratch
# project, volumes and network, so the read-only backup user under test is the one
# minio-init actually creates — then back the bucket up, change it, break it, and
# restore it with deploy/restore.sh. A tiny HTTP receiver stands in for the alert
# webhook and the heartbeat monitor.
#
# Runs entirely in local Docker. Production is never contacted, and no existing
# container, volume or bucket is touched — everything is named govori-*test-<pid>.
#
# Usage: ./deploy/test-backup-cron.sh
#
# Linux host: run it directly. Docker Desktop (Mac/Windows): the scripts bind-mount
# their temp dirs into sibling containers and curl the receiver by IP, so run it
# from a Linux container that shares the daemon and a same-path temp dir:
#   docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
#     -v /tmp/govori-bt:/tmp/govori-bt -e TMPDIR=/tmp/govori-bt \
#     -v "$PWD":/repo:ro -w /repo docker:27.5.1-cli \
#     sh -c 'apk add -q bash coreutils findutils grep curl && bash deploy/test-backup-cron.sh'

set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="${HERE}/prod-backup-cron.sh"
RESTORE="${HERE}/restore.sh"
PROD_COMPOSE="${HERE}/../docker-compose.prod.yml"
CTR="govori-backup-test-$$"
WORK="$(mktemp -d)"

# Audio fixtures (cases 5+).
PROJ="govori-bkptest-$$"
NET="govori-bkptest-net-$$"
MVOL="govori-bkptest-minio-$$"
PVOL="govori-bkptest-pg-$$"
RCV="govori-bkptest-hook-$$"
MC_IMAGE="pgsty/mc:RELEASE.2026-10-18T00-00-00Z"

PASS=0
FAIL=0
ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$*"; PASS=$((PASS + 1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$*"; FAIL=$((FAIL + 1)); }

cleanup() {
  docker rm -f "$CTR" "$RCV" >/dev/null 2>&1 || true
  # Leave the network before `down`, or compose cannot remove it.
  if [ -f /.dockerenv ]; then docker network disconnect "$NET" "$(hostname)" >/dev/null 2>&1 || true; fi
  if [ -f "${WORK}/stack.env" ]; then
    docker compose -p "$PROJ" --env-file "${WORK}/stack.env" -f "$PROD_COMPOSE" down --remove-orphans >/dev/null 2>&1 || true
  fi
  docker network rm "$NET" >/dev/null 2>&1 || true
  docker volume rm -f "$MVOL" "$PVOL" >/dev/null 2>&1 || true
  # The backup writes as root from inside containers; remove with root too.
  docker run --rm -v "${WORK}:/w" alpine sh -c 'rm -rf /w/* /w/.[!.]*' >/dev/null 2>&1 || true
  rm -rf "$WORK" 2>/dev/null || true
}
trap cleanup EXIT

echo "==> Booting a scratch Postgres 16 (${CTR})"
docker run -d --name "$CTR" \
  -e POSTGRES_PASSWORD=t -e POSTGRES_USER=t -e POSTGRES_DB=t \
  postgres:16-alpine >/dev/null
until docker exec "$CTR" pg_isready -U t -q 2>/dev/null; do sleep 1; done

psql_t() { docker exec -e PGPASSWORD=t "$CTR" psql -U t -d t -q -c "$1" >/dev/null; }

# A database big enough to clear the size floor, with real (non-demo) users, so the
# happy path is genuinely happy rather than passing by accident.
#
# The filler has to be INCOMPRESSIBLE. `repeat('x', 4000)` looks like a big row and
# is not one: pg_dump -Fc compresses it to nothing, the dump lands under the size
# floor, and the happy-path case fails for a reason that has nothing to do with the
# behaviour under test. Random hex is the cheap way to buy real bytes.
echo "==> Seeding a plausible database"
psql_t "CREATE EXTENSION IF NOT EXISTS pgcrypto"
psql_t "CREATE TABLE users (id serial primary key, email text, blob text)"
# gen_random_bytes is VOLATILE, so it is evaluated once PER ROW. That matters: an
# aggregate subquery here would be evaluated once for the whole INSERT, every row
# would carry identical bytes, and pg_dump would compress the lot back under the
# floor — making the happy-path case fail for a reason unrelated to what is tested.
# (gen_random_bytes caps at 1024 bytes per call, hence the concatenation.)
psql_t "INSERT INTO users (email, blob)
        SELECT 'user' || g || '@govorim.uz',
               encode(gen_random_bytes(1024), 'base64') || encode(gen_random_bytes(1024), 'base64') ||
               encode(gen_random_bytes(1024), 'base64') || encode(gen_random_bytes(1024), 'base64') ||
               encode(gen_random_bytes(1024), 'base64') || encode(gen_random_bytes(1024), 'base64') ||
               encode(gen_random_bytes(1024), 'base64') || encode(gen_random_bytes(1024), 'base64')
        FROM generate_series(1, 60) g"
psql_t "INSERT INTO users (email, blob)
        SELECT 'seed' || g || '@demo.uz', 'x' FROM generate_series(1, 30) g"

run_backup() {   # run_backup <backup-dir> [extra env assignments…]
  local dir="$1"; shift
  # BACKUP_AUDIO=0 unless a case says otherwise: cases 1–4 are about the database.
  env DB_CONTAINER="$CTR" BACKUP_DIR="$dir" KEEP_DAYS=7 OFFSITE_DEST="" BACKUP_AUDIO=0 \
    BACKUP_ALERT_WEBHOOK_URL="" BACKUP_HEARTBEAT_URL="" "$@" \
    bash "$SCRIPT" >"${WORK}/last.log" 2>&1
}

count_dumps() { find "$1" -maxdepth 1 -name 'govori_*.dump' -type f 2>/dev/null | wc -l | tr -d ' '; }

# ─────────────────────────────────────────────────────────────────────────────
echo
echo "==> 1. Happy path: a real database produces a real, verified backup"
D1="${WORK}/case1"; mkdir -p "$D1"
if run_backup "$D1"; then
  [ "$(count_dumps "$D1")" = "1" ] && ok "published exactly one dump" || bad "expected 1 dump, got $(count_dumps "$D1")"
  DUMP="$(find "$D1" -name 'govori_*.dump' | head -1)"
  SZ="$(stat -f%z "$DUMP" 2>/dev/null || stat -c%s "$DUMP")"
  [ "$SZ" -ge 100000 ] && ok "dump is ${SZ} bytes, above the floor" || bad "dump is only ${SZ} bytes"
  grep -q 'real_users=60' "${DUMP}.meta" \
    && ok "meta counts 60 real users, excluding the 30 @demo.uz seeds" \
    || bad "meta reports $(grep real_users "${DUMP}.meta" 2>/dev/null || echo nothing) — the demo filter is wrong"
  find "$D1" -maxdepth 1 -name '.staging-*' | grep -q . \
    && bad "staging directory survived a successful run" \
    || ok "staging cleaned up"
else
  bad "the happy path exited non-zero"; sed 's/^/      /' "${WORK}/last.log"
fi

# ─────────────────────────────────────────────────────────────────────────────
# The real test. An old, GOOD backup is sitting in the directory and is old enough
# for the retention window to want it gone. The dump then fails. The old backup must
# survive: that is the whole difference between this script and the one it replaces.
echo
echo "==> 2. Failed dump must NOT delete the existing good backup"
D2="${WORK}/case2"; mkdir -p "$D2"
GOOD="${D2}/govori_20200101_000000Z.dump"
head -c 200000 /dev/urandom > "$GOOD"
printf 'bytes=200000\nreal_users=50\n' > "${GOOD}.meta"
touch -t 200001010000 "$GOOD"          # 20+ years old: far outside KEEP_DAYS=7

# Force the dump to be rejected by raising the size floor above any dump this
# database can produce. Same code path as a truncated pg_dump: the guard fires,
# the script dies, and retention is never reached.
if run_backup "$D2" MIN_BYTES=999999999; then
  bad "the script exited 0 on a dump it should have rejected"
else
  ok "rejected the undersized dump (exit non-zero)"
fi
[ -f "$GOOD" ] && ok "the 20-year-old good backup is STILL THERE" || bad "the good backup was deleted — this is the original bug"
[ "$(count_dumps "$D2")" = "1" ] && ok "no fake backup was published" || bad "a rejected dump reached the final name"
find "$D2" -maxdepth 1 -name '.staging-*' | grep -q . \
  && bad "a failed run left staging behind for a later run to mistake for a backup" \
  || ok "failed run left nothing behind"

# ─────────────────────────────────────────────────────────────────────────────
# A structurally perfect dump of a database with no real users is a perfect backup
# of nothing. The repo's own `backups/` folder is exactly that mistake.
echo
echo "==> 3. A dump with no real users is refused"
psql_t "UPDATE users SET email = 'x' || id || '@demo.uz'"
D3="${WORK}/case3"; mkdir -p "$D3"
touch "${D3}/govori_20200101_000000Z.dump"
if run_backup "$D3"; then
  bad "accepted a database whose only users are @demo.uz seeds"
else
  ok "refused a users-table containing nothing but seed accounts"
fi
psql_t "UPDATE users SET email = 'user' || id || '@govorim.uz' WHERE id <= 60"

# ─────────────────────────────────────────────────────────────────────────────
# Retention is allowed to prune — but only after everything above has passed, and
# never down to zero.
echo
echo "==> 4. Retention prunes old backups on a GOOD run, and never to zero"
D4="${WORK}/case4"; mkdir -p "$D4"
OLD="${D4}/govori_20200101_000000Z.dump"
: > "$OLD"; touch -t 200001010000 "$OLD"
if run_backup "$D4"; then
  [ -f "$OLD" ] && bad "the stale backup survived a fully verified run" || ok "pruned the stale backup"
  [ "$(count_dumps "$D4")" = "1" ] && ok "the fresh verified backup remains" || bad "retention emptied the directory"
else
  bad "case 4 run failed"; sed 's/^/      /' "${WORK}/last.log"
fi

# ═════════════════════════════════════════════════════════════════════════════
# Alerting and audio
# ═════════════════════════════════════════════════════════════════════════════
echo
echo "==> Booting the prod minio (+ minio-init below) under project ${PROJ}, and a webhook receiver"
docker volume create "$MVOL" >/dev/null
docker volume create "$PVOL" >/dev/null
BUCKET="govori-audio-test"
cat > "${WORK}/stack.env" <<EOF
POSTGRES_DB=t
POSTGRES_USER=t
POSTGRES_PASSWORD=t
SECRET_KEY=backup-test-only-not-a-real-secret-key-0123456789
IMAGE_TAG=backup-test
GOVORI_SERVER_NAME=localhost
S3_PUBLIC_URL=http://localhost
S3_BUCKET=${BUCKET}
MINIO_ROOT_USER=bkptest-root
MINIO_ROOT_PASSWORD=bkptest-root-secret
S3_APP_ACCESS_KEY=bkptest-app
S3_APP_SECRET_KEY=bkptest-app-secret
S3_BACKUP_ACCESS_KEY=bkptest-backup
S3_BACKUP_SECRET_KEY=bkptest-backup-secret
MINIO_VOLUME=${MVOL}
PG_VOLUME=${PVOL}
REDIS_VOLUME=${PROJ}-redis
NETWORK_NAME=${NET}
EOF
# Compose creates (and on `down` removes) the network; everything else joins it.
pdc() { docker compose -p "$PROJ" --env-file "${WORK}/stack.env" -f "$PROD_COMPOSE" "$@"; }
pdc up -d --wait minio >"${WORK}/up.log" 2>&1 || { echo "could not start the scratch minio"; cat "${WORK}/up.log"; exit 1; }
MINIO_CTR="$(pdc ps -q minio | xargs docker inspect -f '{{.Name}}' | sed 's#^/##')"

# busybox httpd + one CGI script that appends "METHOD PATH BODY" to /tmp/hits.
mkdir -p "${WORK}/www/cgi-bin"
cat > "${WORK}/www/cgi-bin/hook" <<'CGI'
#!/bin/sh
body="$(head -c "${CONTENT_LENGTH:-0}")"
echo "$REQUEST_METHOD $REQUEST_URI $body" >> /tmp/hits
printf 'Content-Type: text/plain\r\n\r\nok\n'
CGI
chmod 755 "${WORK}/www/cgi-bin/hook"
docker run -d --name "$RCV" --network "$NET" --network-alias hook -v "${WORK}/www:/src:ro" busybox:1.36.1 \
  sh -c 'mkdir -p /www/cgi-bin && cp /src/cgi-bin/hook /www/cgi-bin/hook && chmod 755 /www/cgi-bin/hook &&
         touch /tmp/hits && exec httpd -f -p 8080 -h /www' >/dev/null
if [ -f /.dockerenv ]; then
  docker network connect "$NET" "$(hostname)"
  HOOK="http://hook:8080/cgi-bin/hook"
else
  HOOK="http://$(docker inspect -f "{{(index .NetworkSettings.Networks \"${NET}\").IPAddress}}" "$RCV"):8080/cgi-bin/hook"
fi
hits()       { docker exec "$RCV" cat /tmp/hits; }
reset_hits() { docker exec "$RCV" sh -c ': > /tmp/hits'; }

echo
echo "==> 5. minio-init (the real prod script) creates a READ-ONLY backup user"
if pdc run --rm minio-init >"${WORK}/init.log" 2>&1; then
  grep -q "backup user 'bkptest-backup' holds only policy govori-backup" "${WORK}/init.log" \
    && ok "minio-init created the backup user with policy govori-backup" \
    || { bad "minio-init did not report the backup user"; sed 's/^/      /' "${WORK}/init.log"; }
else
  bad "minio-init failed"; sed 's/^/      /' "${WORK}/init.log"
fi
# A second run must converge, not fail — the same idempotence the app user has.
pdc run --rm minio-init >/dev/null 2>&1 && ok "minio-init re-run is idempotent" || bad "minio-init failed on a re-run"

mc_as() {   # mc_as <user> <secret> <shell…>   (the scratch dir is mounted at /w)
  local u="$1" s="$2"; shift 2
  docker run --rm --network "$NET" -v "${WORK}:/w" -e U="$u" -e S="$s" --entrypoint /bin/sh "$MC_IMAGE" \
    -c 'mc alias set m http://minio:9000 "$U" "$S" >/dev/null && '"$*"
}
mkdir -p "${WORK}/seed/answers/u1" "${WORK}/seed/answers/u2" "${WORK}/seed/media"
for f in answers/u1/a1.webm answers/u1/a2.webm answers/u2/b1.webm media/m1.mp3 media/m2.mp3; do
  head -c 4096 /dev/urandom > "${WORK}/seed/${f}"
done
mc_as bkptest-app bkptest-app-secret 'mc cp --quiet --recursive /w/seed/ "m/'"$BUCKET"'/"' >/dev/null \
  && ok "the app key can write (5 objects seeded)" || bad "seeding with the app key failed"

# shellcheck disable=SC2016
mc_as bkptest-backup bkptest-backup-secret 'mc ls --recursive "m/'"$BUCKET"'"' >/dev/null 2>&1 \
  && ok "the backup key can list the bucket" || bad "the backup key cannot list the bucket"
mc_as bkptest-backup bkptest-backup-secret 'mc cp /w/seed/media/m1.mp3 "m/'"$BUCKET"'/evil.mp3"' >/dev/null 2>&1 \
  && bad "the backup key could WRITE an object" || ok "the backup key cannot write"
mc_as bkptest-backup bkptest-backup-secret 'mc rm "m/'"$BUCKET"'/media/m1.mp3"' >/dev/null 2>&1 \
  && bad "the backup key could DELETE an object" || ok "the backup key cannot delete"

audio_backup() {   # audio_backup <dir> [env…]
  local dir="$1"; shift
  run_backup "$dir" BACKUP_AUDIO=1 MINIO_CONTAINER="$MINIO_CTR" GOVORI_ENV_FILE="${WORK}/stack.env" "$@"
}
snapshots()  { find "$1" -maxdepth 1 -name 'govori_*.audio' -type d | sort; }
files_in()   { find "$1" -type f ! -name '.backup-meta' | wc -l | tr -d ' '; }

# ─────────────────────────────────────────────────────────────────────────────
echo
echo "==> 6. Full run: DB + audio, verified, heartbeat on success, no alert"
DA="${WORK}/audio"; mkdir -p "$DA"
reset_hits
if audio_backup "$DA" BACKUP_ALERT_WEBHOOK_URL="${HOOK}/alert" BACKUP_HEARTBEAT_URL="${HOOK}/heartbeat"; then
  SNAP1="$(snapshots "$DA" | tail -1)"
  [ -n "$SNAP1" ] && ok "published $(basename "$SNAP1")" || bad "no audio snapshot published"
  [ "$(files_in "${SNAP1}/${BUCKET}")" = 5 ] && ok "snapshot holds all 5 objects" || bad "snapshot holds $(files_in "${SNAP1}/${BUCKET}") files, expected 5"
  diff -r "${WORK}/seed" "${SNAP1}/${BUCKET}" >/dev/null && ok "every byte matches what was uploaded" || bad "snapshot content differs from the bucket"
  grep -q '^files=5$' "${SNAP1}/.backup-meta" && grep -q '^key=bkptest-backup$' "${SNAP1}/.backup-meta" \
    && ok "meta records 5 files, taken with the read-only key" || bad "meta: $(tr '\n' ' ' < "${SNAP1}/.backup-meta")"
  [ "$(count_dumps "$DA")" = 1 ] && ok "the DB dump was published alongside" || bad "no DB dump next to the audio"
  hits | grep -q '^GET /cgi-bin/hook/heartbeat' && ok "heartbeat pinged on success" || bad "no heartbeat: $(hits)"
  hits | grep -q '/alert' && bad "an alert was sent for a successful run" || ok "no alert on success"
else
  bad "the full run exited non-zero"; sed 's/^/      /' "${WORK}/last.log"
fi

# ─────────────────────────────────────────────────────────────────────────────
# The property that makes hard-link snapshots safe: a later mirror that deletes or
# REWRITES an object must not reach back into an older snapshot.
echo
echo "==> 7. The bucket changes; yesterday's snapshot does not"
cp -r "${WORK}/seed" "${WORK}/seed-v1"
head -c 4096 /dev/urandom > "${WORK}/seed/answers/u1/a2.webm"            # rewritten
head -c 4096 /dev/urandom > "${WORK}/seed/answers/u2/b2.webm"            # added
rm "${WORK}/seed/media/m2.mp3"                                           # deleted
mc_as bkptest-app bkptest-app-secret 'mc cp --quiet /w/seed/answers/u1/a2.webm "m/'"$BUCKET"'/answers/u1/a2.webm" && mc cp --quiet /w/seed/answers/u2/b2.webm "m/'"$BUCKET"'/answers/u2/b2.webm" && mc rm --quiet "m/'"$BUCKET"'/media/m2.mp3"' >/dev/null
sleep 1   # a new second, so a new snapshot name
if audio_backup "$DA"; then
  SNAP2="$(snapshots "$DA" | tail -1)"
  [ "$SNAP2" != "$SNAP1" ] && ok "a second snapshot was published" || bad "no second snapshot"
  diff -r "${WORK}/seed" "${SNAP2}/${BUCKET}" >/dev/null && ok "the new snapshot matches the changed bucket (5 files)" || bad "the new snapshot does not match the bucket"
  diff -r "${WORK}/seed-v1" "${SNAP1}/${BUCKET}" >/dev/null \
    && ok "the OLD snapshot still holds the deleted object and the old bytes of the rewritten one" \
    || bad "the old snapshot was modified by the next mirror — hard links are unsafe"
else
  bad "the second run failed"; sed 's/^/      /' "${WORK}/last.log"
fi

# ─────────────────────────────────────────────────────────────────────────────
echo
echo "==> 8. A broken audio key fails the run and alerts — and the DB is still backed up"
sed 's/^S3_BACKUP_SECRET_KEY=.*/S3_BACKUP_SECRET_KEY=wrong-secret-123/' "${WORK}/stack.env" > "${WORK}/bad.env"
DUMPS_BEFORE="$(count_dumps "$DA")"
WC_BEFORE="$(files_in "${DA}/.audio-mirror")"
reset_hits
if audio_backup "$DA" GOVORI_ENV_FILE="${WORK}/bad.env" BACKUP_ALERT_WEBHOOK_URL="${HOOK}/alert" BACKUP_HEARTBEAT_URL="${HOOK}/heartbeat"; then
  bad "exited 0 with an audio key that cannot list the bucket"
else
  ok "exited non-zero"
fi
[ "$(count_dumps "$DA")" = $((DUMPS_BEFORE + 1)) ] && ok "tonight's DB dump was still published" || bad "the audio failure cost the DB backup too"
[ "$(files_in "${DA}/.audio-mirror")" = "$WC_BEFORE" ] && ok "the audio working copy is untouched" || bad "a failed listing changed the working copy"
hits | grep -q '^POST /cgi-bin/hook/alert .*GOVORI BACKUP FAILED.*failed: audio' \
  && ok "alert POSTed, naming the audio phase" || bad "no (or wrong) alert: $(hits)"
hits | grep -q 'cannot list bucket' && ok "the alert says why" || bad "the alert does not carry the reason"
hits | grep -q 'wrong-secret-123' && bad "the alert leaked the secret" || ok "the alert carries no secret"
hits | grep -q heartbeat && bad "heartbeat pinged on a failed run" || ok "no heartbeat on failure"

# ─────────────────────────────────────────────────────────────────────────────
echo
echo "==> 9. An emptied bucket is refused, not mirrored over the backup"
mc_as bkptest-app bkptest-app-secret 'mc rm --quiet --recursive --force "m/'"$BUCKET"'/"' >/dev/null
WC_BEFORE="$(files_in "${DA}/.audio-mirror")"
if audio_backup "$DA"; then
  bad "mirrored an empty bucket over a populated backup"
else
  grep -q 'refusing to mirror an empty bucket' "${WORK}/last.log" && ok "refused, and said why" || bad "failed for another reason: $(grep FATAL "${WORK}/last.log" | head -2)"
fi
[ "$(files_in "${DA}/.audio-mirror")" = "$WC_BEFORE" ] && ok "working copy still holds ${WC_BEFORE} files" || bad "the working copy was emptied"
grep -q 'NOBODY has been told' "${WORK}/last.log" && ok "with no webhook set, the log says nobody was told" || bad "no loud warning without a webhook"

# ─────────────────────────────────────────────────────────────────────────────
echo
echo "==> 10. restore.sh --audio: verify, then put the objects back (additively)"
if bash "$RESTORE" --audio "$SNAP1" >"${WORK}/restore.log" 2>&1; then
  ok "verify-only passed on snapshot 1"
else
  bad "verify-only failed"; sed 's/^/      /' "${WORK}/restore.log"
fi
# Something uploaded AFTER the disaster must survive the restore.
head -c 4096 /dev/urandom > "${WORK}/live-only.webm"
mc_as bkptest-app bkptest-app-secret 'mc cp --quiet /w/live-only.webm "m/'"$BUCKET"'/answers/live-only.webm"' >/dev/null
if COMPOSE_FILE="$PROD_COMPOSE" ENV_FILE="${WORK}/stack.env" COMPOSE_PROJECT_NAME="$PROJ" \
   bash "$RESTORE" --audio "$SNAP1" --into-stack --yes >"${WORK}/restore.log" 2>&1; then
  ok "into-stack restore exited 0"
else
  bad "into-stack restore failed"; sed 's/^/      /' "${WORK}/restore.log"
fi
rm -rf "${WORK}/back"; mkdir -p "${WORK}/back"
mc_as bkptest-backup bkptest-backup-secret 'mc cp --quiet --recursive "m/'"$BUCKET"'/" /w/back/' >/dev/null
cmp -s "${WORK}/back/answers/live-only.webm" "${WORK}/live-only.webm" && ok "an object uploaded after the backup survived the restore" || bad "the restore removed a live object"
rm -f "${WORK}/back/answers/live-only.webm"
diff -r "${WORK}/seed-v1" "${WORK}/back" >/dev/null && ok "all 5 objects from snapshot 1 are back, byte for byte" || bad "restored bucket differs from snapshot 1"

# ─────────────────────────────────────────────────────────────────────────────
echo
echo "==> 11. A snapshot that lost a file is refused"
docker run --rm -v "${WORK}:/w" alpine sh -c "cp -a /w/audio/$(basename "$SNAP1") /w/tampered && rm /w/tampered/${BUCKET}/media/m1.mp3"
if bash "$RESTORE" --audio "${WORK}/tampered" >"${WORK}/restore.log" 2>&1; then
  bad "verified a snapshot missing a file"
else
  grep -q 'recorded 5' "${WORK}/restore.log" && ok "refused: 4 files where 5 were recorded" || bad "refused for another reason: $(tail -2 "${WORK}/restore.log")"
fi

# ─────────────────────────────────────────────────────────────────────────────
echo
echo "==> 12. Audio retention prunes old snapshots on a good run, keeping the new one"
# Re-fill the bucket (case 9 emptied it) so the run succeeds.
mc_as bkptest-app bkptest-app-secret 'mc cp --quiet --recursive /w/seed/ "m/'"$BUCKET"'/"' >/dev/null
touch -t 200001010000 "$SNAP1"
sleep 1
if audio_backup "$DA"; then
  [ -d "$SNAP1" ] && bad "a 20-year-old snapshot survived retention" || ok "pruned the stale snapshot"
  [ -d "$SNAP2" ] && ok "kept the recent one" || bad "pruned a snapshot inside KEEP_DAYS"
else
  bad "case 12 run failed"; sed 's/^/      /' "${WORK}/last.log"
fi

# ─────────────────────────────────────────────────────────────────────────────
# A failure the script did not anticipate (no `|| die` on it) must still stop the
# phase. This is the errexit-in-a-tested-context trap: run the phase from `if` or
# `||` and bash silently ignores `set -e` inside it. A fake `mv` makes the publish
# step fail; if errexit were off, the run would carry on and write a .meta for a
# dump that never got its final name.
echo
echo "==> 13. An unexpected command failure stops the phase (errexit really is on)"
D13="${WORK}/case13"; mkdir -p "$D13"
# Outside WORK: a bind-mounted temp dir may be noexec, and PATH lookup silently skips it.
FAKEBIN="$(TMPDIR=/tmp mktemp -d)"
printf '#!/bin/sh\necho "fake mv: refusing" >&2\nexit 1\n' > "${FAKEBIN}/mv"
chmod +x "${FAKEBIN}/mv"
reset_hits
if run_backup "$D13" PATH="${FAKEBIN}:${PATH}" BACKUP_ALERT_WEBHOOK_URL="${HOOK}/alert"; then
  bad "exited 0 although publishing the dump failed"
else
  ok "exited non-zero"
fi
find "$D13" -maxdepth 1 -name 'govori_*' | grep -q . \
  && bad "the phase carried on past the failed mv: $(ls "$D13")" || ok "nothing was published after the failure"
hits | grep -q 'unexpected failure at line' && ok "the alert names the failing line" || bad "alert: $(hits)"
rm -rf "$FAKEBIN"

echo
printf '==> %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
