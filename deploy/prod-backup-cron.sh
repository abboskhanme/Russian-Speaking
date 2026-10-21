#!/usr/bin/env bash
# The nightly backup that RUNS ON THE DROPLET: the database AND the audio, verified,
# and somebody is told when it fails.
#
# ── The bug this script exists to fix ──────────────────────────────────────────
# The cron it replaced was shaped like:
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
# **nothing is trusted until it is proven, nothing is deleted until the
# replacement is proven, and a failure is SAID OUT LOUD to a human.**
#
# ── What it backs up ───────────────────────────────────────────────────────────
#   DB     pg_dump -Fc → govori_<ts>.dump (+ .meta). Verified with pg_restore --list
#          and a real-user count before it gets its final name.
#   AUDIO  every object in S3_BUCKET (student recordings, media, avatars). pg_dump
#          does NOT cover these and they cannot be regenerated. Mirrored with `mc`
#          into a working copy, verified against the bucket's own listing, then
#          frozen as govori_<ts>.audio/ — a HARD-LINK snapshot, so a night's
#          snapshot costs only the objects that are new that night.
#
#   The two phases are independent: a broken audio mirror does not stop tonight's
#   database dump from being published, and vice versa. Either failing makes the
#   whole run fail (exit 1) and sends the alert.
#
# ── Install (run ON the droplet, once) ────────────────────────────────────────
#   install -m 0755 prod-backup-cron.sh /usr/local/bin/govori-backup
#   crontab -e   →   17 3 * * *  BACKUP_ALERT_WEBHOOK_URL=… BACKUP_HEARTBEAT_URL=… /usr/local/bin/govori-backup >> /var/log/govori-backup.log 2>&1
#
# ── Environment ───────────────────────────────────────────────────────────────
#   BACKUP_DIR      where backups land              (default /var/backups/govori)
#   KEEP_DAYS       retention window, DB and audio  (default 7)
#   MIN_BYTES       smallest credible dump          (default 100000)
#   OFFSITE_DEST    rsync target user@host:/path or s3://bucket/prefix
#                   (default empty → offsite skipped, reported as a WARN, never
#                   as success)
#   DB_CONTAINER    name the postgres container explicitly instead of guessing
#   BACKUP_AUDIO    1 = back up the audio bucket (default). 0 skips it, LOUDLY.
#   MINIO_CONTAINER name the minio container (default: the one running container
#                   labelled com.docker.compose.service=minio)
#   GOVORI_ENV_FILE the stack's .env, read for S3_BUCKET and the backup key —
#                   never sourced (default: <compose working dir>/.env, taken
#                   from the minio container's compose label)
#   MC_IMAGE        MinIO client image (default: the pin minio-init uses)
#   BACKUP_ALERT_WEBHOOK_URL  POSTed to on ANY failure. Works as-is with:
#                     Slack / Discord / Mattermost incoming webhooks (JSON body),
#                     a Telegram bot: https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<ID>,
#                     healthchecks.io: https://hc-ping.com/<uuid>/fail
#   BACKUP_HEARTBEAT_URL      GET on SUCCESS only — a dead-man's switch
#                     (healthchecks.io, Uptime Kuma push, Better Stack heartbeat).
#                     It catches the failure no script can report: the cron, the
#                     droplet or this script not running at all.
#
#   The audio key comes from the .env: S3_BACKUP_ACCESS_KEY / S3_BACKUP_SECRET_KEY,
#   the READ-ONLY user minio-init creates (policy govori-backup: list + get on
#   S3_BUCKET, nothing else). If those are unset it falls back to the app key
#   (S3_APP_*) with a WARN — that key can write and delete, which a backup has no
#   business holding. The MinIO root key is never used.
#
# Exit codes: 0 = a verified DB backup AND a verified audio snapshot exist from
# this run. Non-zero = at least one does not, and the alert has been sent.
# There is no third state, and in particular there is no "probably fine".

set -Eeuo pipefail          # -o pipefail is the whole point; do not remove it.
shopt -s inherit_errexit 2>/dev/null || true

BACKUP_DIR="${BACKUP_DIR:-/var/backups/govori}"
KEEP_DAYS="${KEEP_DAYS:-7}"
MIN_BYTES="${MIN_BYTES:-100000}"
OFFSITE_DEST="${OFFSITE_DEST:-}"
BACKUP_AUDIO="${BACKUP_AUDIO:-1}"
MC_IMAGE="${MC_IMAGE:-pgsty/mc:RELEASE.2026-10-18T00-00-00Z}"
BACKUP_ALERT_WEBHOOK_URL="${BACKUP_ALERT_WEBHOOK_URL:-}"
BACKUP_HEARTBEAT_URL="${BACKUP_HEARTBEAT_URL:-}"

TS="$(date -u +%Y%m%d_%H%M%SZ)"
STAGE="${BACKUP_DIR}/.staging-${TS}"     # dot-prefixed: retention's glob never sees it
FINAL="${BACKUP_DIR}/govori_${TS}.dump"
AUDIO_WORK="${BACKUP_DIR}/.audio-mirror"  # the mc mirror working copy (see backup_audio)
AUDIO_SNAP="${BACKUP_DIR}/govori_${TS}.audio"
RUN_TMP="$(mktemp -d)"                    # failure reasons, written by the phase subshells
HOST_NAME="$(hostname 2>/dev/null || echo unknown-host)"

log()  { printf '%s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
warn() { log "WARN:  $*"; }
# die records WHY before it exits, because the alert is sent by the parent after the
# phase subshell is gone; an alert that only says "exit 1" sends a human to the logs
# at 3am for information this line already had.
die()  { log "FATAL: $*"; printf '%s\n' "$*" >> "${RUN_TMP}/failures"; exit 1; }

# ── Alerting ──────────────────────────────────────────────────────────────────
# A backup that fails silently is the bug at the top of this file with extra
# steps. Delivery is best-effort (retried, time-boxed) and its own failure is
# logged, but it can never turn a good backup into a failed run or vice versa.
json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"; s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"; s="${s//$'\r'/}"; s="${s//$'\t'/ }"
  printf '%s' "$s"
}

send_alert() {   # send_alert <text>
  local text="$1"
  if [ -z "$BACKUP_ALERT_WEBHOOK_URL" ]; then
    warn "################################################################"
    warn "BACKUP_ALERT_WEBHOOK_URL is unset — NOBODY has been told that:"
    warn "  ${text//$'\n'/ | }"
    warn "################################################################"
    return 0
  fi
  local rc=0
  case "$BACKUP_ALERT_WEBHOOK_URL" in
    *api.telegram.org/bot*)
      # The Bot API takes chat_id from the URL's query string and text as a form field.
      curl -fsS -m 20 --retry 3 --retry-delay 5 -o /dev/null \
        --data-urlencode "text=${text}" "$BACKUP_ALERT_WEBHOOK_URL" || rc=$? ;;
    *)
      # "text" for Slack/Mattermost, "content" for Discord; healthchecks.io logs the body.
      local body
      body="$(printf '{"text":"%s","content":"%s"}' "$(json_escape "$text")" "$(json_escape "$text")")"
      curl -fsS -m 20 --retry 3 --retry-delay 5 -o /dev/null \
        -H 'Content-Type: application/json' --data "$body" "$BACKUP_ALERT_WEBHOOK_URL" || rc=$? ;;
  esac
  if [ "$rc" = 0 ]; then log "alert sent"; else warn "alert delivery FAILED (curl exit ${rc}) — check BACKUP_ALERT_WEBHOOK_URL"; fi
}

send_heartbeat() {
  if [ -z "$BACKUP_HEARTBEAT_URL" ]; then
    warn "BACKUP_HEARTBEAT_URL is unset — if this cron stops running altogether, nothing will notice"
    return 0
  fi
  if curl -fsS -m 20 --retry 3 --retry-delay 5 -o /dev/null "$BACKUP_HEARTBEAT_URL"; then
    log "heartbeat sent"
  else
    warn "heartbeat delivery FAILED — the monitor will report a missed backup that did in fact succeed"
  fi
}

# A run that dies part-way must leave NOTHING that a later `ls` could mistake for
# a backup. Staging and the half-built snapshot are the only things this script
# ever half-writes. An abort outside a phase (the EXIT path with no verdict yet)
# still alerts — "the backup script crashed" is a failed backup.
VERDICT_SENT=0
cleanup() {
  local rc=$?
  rm -rf "$STAGE" "${AUDIO_SNAP}.partial"
  if [ "$rc" != 0 ] && [ "$VERDICT_SENT" = 0 ]; then
    send_alert "[GOVORI BACKUP FAILED] on ${HOST_NAME} (${TS}): the script aborted (exit ${rc}) — see /var/log/govori-backup.log"
  fi
  rm -rf "$RUN_TMP"
}
trap cleanup EXIT

# Run one phase in a subshell with errexit ON, and survive its failure.
# The verdict comes back in a VARIABLE, not the exit status, and run_phase must be
# called as a plain command: `if run_phase …`, `run_phase … || …` or `( phase ) || …`
# would all put the phase in a context where bash IGNORES `set -e` — for everything
# inside, including the subshell, even though it says `set -e` itself — so a failing
# pg_dump or mv would carry on into "publish". (Checked: under `f || …`, a `false`
# inside f's `( set -e; … )` does not stop it.)
PHASE_RC=0
run_phase() {   # run_phase <name> <function>   → sets PHASE_RC
  local name="$1" fn="$2"
  set +e
  (
    set -e
    trap 'log "FATAL: ${name}: command failed at line ${LINENO}"; printf "%s: unexpected failure at line %s\n" "$name" "$LINENO" >> "${RUN_TMP}/failures"' ERR
    "$fn"
  )
  PHASE_RC=$?
  set -e
  if [ "$PHASE_RC" = 0 ]; then log "${name}: OK"; else log "${name}: FAILED (exit ${PHASE_RC})"; fi
}

# ── Offsite (shared) ──────────────────────────────────────────────────────────
# A backup that lives only on the machine it backs up is not a backup — it shares
# every failure mode with the thing it protects: one disk, one droplet, one
# accidental `docker volume rm`.
offsite_files() {   # offsite_files <file>…  — returns 0 on success, 1 on failure
  case "$OFFSITE_DEST" in
    s3://*) local f; for f in "$@"; do aws s3 cp "$f" "${OFFSITE_DEST%/}/" >/dev/null || return 1; done ;;
    *)      rsync -a --partial "$@" "${OFFSITE_DEST%/}/" || return 1 ;;
  esac
}

# ═════════════════════════════════════════════════════════════════════════════
# PHASE 1 — the database
# ═════════════════════════════════════════════════════════════════════════════
backup_db() {
  # ── 1. Find the database container. Never assume its name ───────────────────
  # The compose project name has changed at least once in this stack's life, and a
  # hardcoded container name is how a backup silently stops running. Discovery is
  # the default; DB_CONTAINER overrides it, which matters on any host running more
  # than one postgres — the grep would otherwise back up whichever sorts first.
  local DB_CTR
  DB_CTR="${DB_CONTAINER:-$(docker ps --format '{{.Names}}' | grep -E 'db|postgres' | head -1 || true)}"
  [ -n "$DB_CTR" ] || die "no running postgres container"
  log "postgres container: ${DB_CTR}"

  local PGUSER_V PGDB_V PGPASS_V
  PGUSER_V="$(docker exec "$DB_CTR" printenv POSTGRES_USER)"
  PGDB_V="$(docker exec "$DB_CTR" printenv POSTGRES_DB)"
  PGPASS_V="$(docker exec "$DB_CTR" printenv POSTGRES_PASSWORD)"
  [ -n "$PGUSER_V" ] && [ -n "$PGDB_V" ] || die "could not read POSTGRES_USER/DB from ${DB_CTR}"

  # ── 2. Dump to STAGING, never to the final name ─────────────────────────────
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
  docker exec -e PGPASSWORD="$PGPASS_V" "$DB_CTR" \
    pg_dump -U "$PGUSER_V" -d "$PGDB_V" -Fc --no-owner --no-acl \
    > "${STAGE}/db.dump"

  # ── 3. Prove the dump before anything downstream trusts it ──────────────────
  local SIZE
  SIZE="$(stat -c%s "${STAGE}/db.dump" 2>/dev/null || stat -f%z "${STAGE}/db.dump")"
  log "size: ${SIZE} bytes (floor ${MIN_BYTES})"
  [ "$SIZE" -ge "$MIN_BYTES" ] || die "DB dump is ${SIZE} bytes — pg_dump failed or the database is empty"

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
  local DB_IMAGE TOC_LINES
  DB_IMAGE="$(docker inspect -f '{{.Config.Image}}' "$DB_CTR")"
  TOC_LINES="$(docker run --rm -v "${STAGE}:/stage:ro" --entrypoint pg_restore "$DB_IMAGE" \
                --list /stage/db.dump | grep -cv '^;' || true)"
  [ "${TOC_LINES:-0}" -gt 0 ] || die "DB dump has an unreadable or empty table of contents — it is not restorable"
  log "toc entries: ${TOC_LINES}"

  # The one check that is about THIS product rather than about Postgres: a dump
  # with a perfect header and zero real users is a perfect backup of nothing. The
  # `backups/` folder in the repo is precisely that mistake — 34 users, 30 of them
  # @demo.uz seed accounts — which is why the count excludes them here.
  log "counting real users in the dump"
  local USERS
  USERS="$(
    docker exec -e PGPASSWORD="$PGPASS_V" "$DB_CTR" \
      psql -U "$PGUSER_V" -d "$PGDB_V" -A -t -v ON_ERROR_STOP=1 \
      -c "SELECT count(*) FROM users WHERE email IS NULL OR (email NOT LIKE '%@demo.uz' AND email NOT LIKE '%@test.uz')" \
    | tr -d '[:space:]'
  )"
  [ -n "$USERS" ] && [ "$USERS" -gt 0 ] || die "the live database reports ${USERS:-no} real users — refusing to treat this as a backup"
  log "real users: ${USERS}"

  # ── 4. Publish atomically ───────────────────────────────────────────────────
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

  # ── 5. Offsite BEFORE retention ─────────────────────────────────────────────
  # Offsite runs before retention on purpose, so a broken copy path can never be
  # the reason old local copies were deleted.
  local OFFSITE_OK=0
  if [ -n "$OFFSITE_DEST" ]; then
    log "copying the dump offsite → ${OFFSITE_DEST}"
    if offsite_files "$FINAL" "${FINAL}.meta"; then OFFSITE_OK=1; log "offsite ok"
    else warn "offsite copy of the dump FAILED — local DB retention will be skipped"; fi
  else
    warn "OFFSITE_DEST unset — this backup exists on ONE machine, the same one it backs up"
  fi

  # ── 6. Retention, LAST and CONDITIONAL ──────────────────────────────────────
  # This is the line that destroyed the old backups. It now runs only after a new
  # copy has been dumped, size-checked, structurally validated, confirmed to
  # contain real users, atomically published, AND (when configured) copied
  # offsite. If any of those failed, this phase has already exited and the old
  # backups are still here — which is the correct outcome, because an old real
  # backup beats a new fake one every time.
  #
  # The keep-at-least-one floor is the belt to that braces: even a correct run
  # must never leave the directory empty, e.g. if KEEP_DAYS is misconfigured.
  if [ -n "$OFFSITE_DEST" ] && [ "$OFFSITE_OK" != 1 ]; then
    warn "skipping DB retention: the offsite copy did not land"
  else
    local TOTAL old
    TOTAL="$(find "$BACKUP_DIR" -maxdepth 1 -name 'govori_*.dump' -type f | wc -l | tr -d ' ')"
    if [ "$TOTAL" -le 1 ]; then
      log "retention: only ${TOTAL} DB backup present — nothing to prune"
    else
      while IFS= read -r old; do
        [ "$old" = "$FINAL" ] && continue          # never delete the copy just made
        log "retention: removing $(basename "$old")"
        rm -f "$old" "${old}.meta"
      done < <(find "$BACKUP_DIR" -maxdepth 1 -name 'govori_*.dump' -type f -mtime "+${KEEP_DAYS}")
    fi
  fi

  printf 'db: %s (%s bytes, %s real users)\n' "$(basename "$FINAL")" "$SIZE" "$USERS" >> "${RUN_TMP}/summary"
}

# ═════════════════════════════════════════════════════════════════════════════
# PHASE 2 — the audio (MinIO bucket)
# ═════════════════════════════════════════════════════════════════════════════
# Read one key out of the env file WITHOUT sourcing it — a production .env holds
# API keys with `$`, backticks and quotes in them, and `source` would execute them.
envval() {
  local v
  v="$(grep -E "^${1}=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true)"
  v="${v%$'\r'}"; v="${v%\"}"; v="${v#\"}"; v="${v%\'}"; v="${v#\'}"
  printf '%s' "$v"
}

count_files() { find "$1" -type f ! -name '*.part.minio' 2>/dev/null | wc -l | tr -d ' '; }

backup_audio() {
  # ── 1. Which MinIO, which bucket, which key ─────────────────────────────────
  # Found by its compose service LABEL rather than a name grep: `minio-init` also
  # contains "minio", and on a host that once ran another stack, so may an old
  # container. More than one candidate is a refusal, not a coin toss.
  local MINIO_CTR
  if [ -n "${MINIO_CONTAINER:-}" ]; then
    MINIO_CTR="$MINIO_CONTAINER"
  else
    local found
    found="$(docker ps --filter 'label=com.docker.compose.service=minio' --format '{{.Names}}')"
    [ -n "$found" ] || die "no running minio container (label com.docker.compose.service=minio); set MINIO_CONTAINER"
    [ "$(printf '%s\n' "$found" | wc -l | tr -d ' ')" = 1 ] \
      || die "several minio containers are running ($(printf '%s' "$found" | tr '\n' ' ')) — set MINIO_CONTAINER to the production one"
    MINIO_CTR="$found"
  fi
  log "minio container: ${MINIO_CTR}"

  ENV_FILE="${GOVORI_ENV_FILE:-}"
  if [ -z "$ENV_FILE" ]; then
    local wd
    wd="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$MINIO_CTR" 2>/dev/null || true)"
    [ -n "$wd" ] || die "cannot tell where ${MINIO_CTR}'s .env lives; set GOVORI_ENV_FILE"
    ENV_FILE="${wd}/.env"
  fi
  [ -r "$ENV_FILE" ] || die "env file ${ENV_FILE} is not readable; set GOVORI_ENV_FILE"

  local BUCKET AK SK
  BUCKET="$(envval S3_BUCKET)"
  [ -n "$BUCKET" ] || die "S3_BUCKET is not set in ${ENV_FILE}"
  AK="$(envval S3_BACKUP_ACCESS_KEY)"; SK="$(envval S3_BACKUP_SECRET_KEY)"
  if [ -n "$AK" ] && [ -n "$SK" ]; then
    log "audio key: ${AK} (read-only backup user)"
  else
    AK="$(envval S3_APP_ACCESS_KEY)"; SK="$(envval S3_APP_SECRET_KEY)"
    [ -n "$AK" ] && [ -n "$SK" ] || die "neither S3_BACKUP_ACCESS_KEY/SECRET nor S3_APP_ACCESS_KEY/SECRET is set in ${ENV_FILE}"
    warn "S3_BACKUP_ACCESS_KEY unset — mirroring with the APP key, which can also write and delete. Add the read-only backup user (docs/09-DOCKER.md)."
  fi

  local NET
  NET="$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' "$MINIO_CTR" | head -1)"
  [ -n "$NET" ] || die "${MINIO_CTR} is on no docker network"

  # Every mc call runs in a throwaway container on the stack's network: MinIO has
  # no published port in production, and nothing needs installing on the host.
  # Credentials travel as environment variables (`-e NAME` copies the value
  # without it appearing on the docker command line).
  mc_run() {   # mc_run <mount-or-empty> <shell snippet using $SRC_BUCKET>
    local mount="$1" snippet="$2"
    local -a vol=()
    [ -n "$mount" ] && vol=(-v "$mount")
    MC_EP="http://${MINIO_CTR}:9000" MC_AK="$AK" MC_SK="$SK" SRC_BUCKET="$BUCKET" \
    docker run --rm --network "$NET" --security-opt no-new-privileges:true \
      -e MC_EP -e MC_AK -e MC_SK -e SRC_BUCKET "${vol[@]}" \
      --entrypoint /bin/sh "$MC_IMAGE" -c \
      'mc alias set src "$MC_EP" "$MC_AK" "$MC_SK" >/dev/null && '"$snippet"
  }

  # ── 2. What the bucket says it holds, BEFORE mirroring ──────────────────────
  # A listing failure (wrong key, wrong bucket, MinIO down) must stop the phase
  # here. If it reached `mirror --remove` as an EMPTY source, the working copy
  # would be emptied to match.
  log "listing s3://${BUCKET}"
  local LISTING N_SRC
  # shellcheck disable=SC2016  # expanded by the sh inside the mc container
  LISTING="$(mc_run "" 'mc ls --recursive --json "src/$SRC_BUCKET"')" \
    || die "cannot list bucket ${BUCKET} with key ${AK} — wrong key, missing policy, or MinIO is down"
  N_SRC="$(printf '%s\n' "$LISTING" | grep -c '"type":"file"' || true)"
  log "bucket objects: ${N_SRC}"

  mkdir -p "${AUDIO_WORK}/${BUCKET}"
  chmod 700 "$AUDIO_WORK"
  local N_PREV
  N_PREV="$(count_files "${AUDIO_WORK}/${BUCKET}")"
  # An empty bucket on a stack that had audio yesterday is an incident, not a
  # quiet night. Refuse rather than mirror the emptiness.
  if [ "$N_SRC" = 0 ] && [ "$N_PREV" -gt 0 ]; then
    die "bucket ${BUCKET} lists 0 objects but the last backup held ${N_PREV} — refusing to mirror an empty bucket over it. Investigate the bucket."
  fi

  # ── 3. Mirror into the WORKING COPY ─────────────────────────────────────────
  # The source is only ever READ: the key is read-only, and mc mirror writes to its
  # target, which is a directory under BACKUP_DIR. Nothing here can touch a prod
  # object.
  #
  # `--remove` deletes from the WORKING COPY files whose object is gone from the
  # bucket. That is deliberate, for two reasons:
  #   * Recordings are biometric data with a 90-day retention policy (docs/02
  #     §2.8). A backup that never forgets would keep every deleted recording
  #     forever and quietly defeat that policy.
  #   * It does not shorten what can be recovered. Every previous night's snapshot
  #     is a separate set of hard links (step 5), so an object deleted from prod —
  #     by accident or by the retention job — is still in each snapshot taken
  #     while it existed, for KEEP_DAYS.
  # mc writes each file under a temporary name and renames it into place, so a
  # re-copied object gets a NEW inode and never rewrites the bytes an older
  # snapshot still links to.
  log "mc mirror s3://${BUCKET} → working copy"
  # shellcheck disable=SC2016  # expanded by the sh inside the mc container
  mc_run "${AUDIO_WORK}:/backup" 'mc mirror --overwrite --remove --quiet "src/$SRC_BUCKET" "/backup/$SRC_BUCKET"' >/dev/null \
    || die "mc mirror of bucket ${BUCKET} failed"

  # ── 4. Prove the copy against the listing ───────────────────────────────────
  # Objects uploaded while the mirror ran only make the copy BIGGER than the
  # listing; objects the retention job deleted meanwhile can make it smaller, so a
  # 1% shortfall is tolerated and anything beyond it is a failed copy.
  local N_LOCAL BYTES
  N_LOCAL="$(count_files "${AUDIO_WORK}/${BUCKET}")"
  BYTES="$(du -sb "${AUDIO_WORK}/${BUCKET}" 2>/dev/null | cut -f1 || echo 0)"
  log "working copy: ${N_LOCAL} files, ${BYTES} bytes"
  if [ "$N_SRC" -gt 0 ]; then
    [ $(( N_LOCAL * 100 )) -ge $(( N_SRC * 99 )) ] \
      || die "audio copy holds ${N_LOCAL} files but the bucket listed ${N_SRC} — the mirror is incomplete"
    # Every object in this product is a real file with content; a zero-byte copy is
    # a transfer that failed without saying so.
    local EMPTY
    EMPTY="$(find "${AUDIO_WORK}/${BUCKET}" -type f -size 0 ! -name '*.part.minio' | wc -l | tr -d ' ')"
    [ "$EMPTY" = 0 ] || die "${EMPTY} audio files in the copy are zero bytes"
  else
    log "the bucket is empty — expected only on a brand-new install"
  fi

  # ── 5. Freeze tonight's state as a hard-link snapshot, atomically ───────────
  # Built under .partial and renamed, for the same reason as the DB dump: the final
  # name either does not exist or is complete.
  cp -al "${AUDIO_WORK}" "${AUDIO_SNAP}.partial"
  printf 'bucket=%s\nobjects_listed=%s\nfiles=%s\nbytes=%s\nkey=%s\n' \
    "$BUCKET" "$N_SRC" "$N_LOCAL" "$BYTES" "$AK" > "${AUDIO_SNAP}.partial/.backup-meta"
  mv "${AUDIO_SNAP}.partial" "$AUDIO_SNAP"
  chmod 700 "$AUDIO_SNAP"
  log "published: ${AUDIO_SNAP}"

  # ── 6. Offsite, BEFORE retention ────────────────────────────────────────────
  # Incremental and additive: the offsite copy is the working copy synced WITHOUT
  # deletes, so a prod deletion can never propagate offsite. (Pruning it is the
  # offsite store's own lifecycle rule — see docs/09-DOCKER.md.)
  local OFFSITE_OK=0
  if [ -n "$OFFSITE_DEST" ]; then
    log "syncing audio offsite → ${OFFSITE_DEST%/}/audio/"
    case "$OFFSITE_DEST" in
      s3://*) aws s3 sync "${AUDIO_WORK}/${BUCKET}" "${OFFSITE_DEST%/}/audio/${BUCKET}/" --only-show-errors && OFFSITE_OK=1 ;;
      *)      rsync -a --partial "${AUDIO_WORK}/" "${OFFSITE_DEST%/}/audio/" && OFFSITE_OK=1 ;;
    esac
    if [ "$OFFSITE_OK" = 1 ]; then log "audio offsite ok"; else warn "audio offsite sync FAILED — local audio retention will be skipped"; fi
  fi

  # ── 7. Retention: same window and same keep-one floor as the dumps ──────────
  if [ -n "$OFFSITE_DEST" ] && [ "$OFFSITE_OK" != 1 ]; then
    warn "skipping audio retention: the offsite copy did not land"
  else
    local old
    while IFS= read -r old; do
      [ "$old" = "$AUDIO_SNAP" ] && continue
      log "retention: removing $(basename "$old")"
      rm -rf "$old"
    done < <(find "$BACKUP_DIR" -maxdepth 1 -name 'govori_*.audio' -type d -mtime "+${KEEP_DAYS}")
  fi

  printf 'audio: %s (%s files, %s bytes)\n' "$(basename "$AUDIO_SNAP")" "$N_LOCAL" "$BYTES" >> "${RUN_TMP}/summary"
}

# ═════════════════════════════════════════════════════════════════════════════
log "=== govori backup ${TS} ==="
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
[ -n "$BACKUP_ALERT_WEBHOOK_URL" ] || warn "BACKUP_ALERT_WEBHOOK_URL is unset — a failed backup will be reported to this log file only"

FAILED=""
run_phase db backup_db
[ "$PHASE_RC" = 0 ] || FAILED="${FAILED} db"
if [ "$BACKUP_AUDIO" = 1 ]; then
  run_phase audio backup_audio
  [ "$PHASE_RC" = 0 ] || FAILED="${FAILED} audio"
else
  warn "BACKUP_AUDIO=${BACKUP_AUDIO} — the audio bucket is NOT being backed up. Student recordings cannot be regenerated."
fi

VERDICT_SENT=1
if [ -n "$FAILED" ]; then
  REASONS="$(cat "${RUN_TMP}/failures" 2>/dev/null || true)"
  DONE="$(cat "${RUN_TMP}/summary" 2>/dev/null || true)"
  send_alert "[GOVORI BACKUP FAILED] on ${HOST_NAME} (${TS}) — failed:${FAILED}
${REASONS:-see /var/log/govori-backup.log}${DONE:+
still published: ${DONE}}"
  log "=== FAILED:${FAILED} ==="
  exit 1
fi

send_heartbeat
log "=== done ==="
sed 's/^/    /' "${RUN_TMP}/summary"
