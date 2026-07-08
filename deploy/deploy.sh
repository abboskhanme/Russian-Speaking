#!/usr/bin/env bash
# Near-zero-downtime redeploy for the B1S VM.
#
# Images are built in CI (GitHub Actions) and pushed to GHCR, so the VM NEVER
# builds — it only PULLS the finished images (seconds) and swaps the app
# containers. db/redis/minio are left running (`--no-deps`), so only the small
# backend/worker/web containers restart. Downtime is the swap window (~15-30s),
# not a multi-minute on-VM build.
#
# Usage (on the VM, from the repo root or anywhere):
#   ./deploy/deploy.sh              # deploy the latest images
#   IMAGE_TAG=<git-sha> ./deploy/deploy.sh   # pin/rollback to a specific build
set -euo pipefail

# Resolve the repo root (this script lives in <repo>/deploy/).
cd "$(dirname "$0")/.."

COMPOSE="docker compose -f docker-compose.prod.yml"
export IMAGE_TAG="${IMAGE_TAG:-latest}"

echo "[deploy] repo: $(pwd)  tag: ${IMAGE_TAG}"

# 1. Bring in any compose/nginx/.env changes committed alongside the code.
#    --ff-only so a dirty/diverged checkout fails loudly instead of merging.
echo "[deploy] git pull…"
git pull --ff-only

# 2. Pull the freshly built images (old containers keep serving during this).
echo "[deploy] pulling images…"
$COMPOSE pull backend worker web migrate

# 3. Run DB migrations with the NEW image, then exit. Migrations must be
#    backward-compatible (old code is still serving until step 4).
echo "[deploy] migrating…"
$COMPOSE run --rm migrate

# 4. Swap only the app containers to the new image. --no-deps leaves
#    db/redis/minio untouched; recreate is a few seconds per container.
echo "[deploy] swapping app containers…"
$COMPOSE up -d --no-deps backend worker web

# 5. Reclaim disk from the now-unused old image layers.
echo "[deploy] pruning old images…"
docker image prune -f >/dev/null || true

echo "[deploy] done. Health:"
$COMPOSE ps
