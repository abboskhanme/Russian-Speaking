#!/usr/bin/env bash
# =============================================================================
# BUILD-IMAGES — build the three production images on this machine, for the
# droplet's platform, and optionally stream them to it. INSTALL.md step 4b.
# =============================================================================
#
# WHY THIS EXISTS
#   The step-4b one-liner it replaces had two failures that only show up on the
#   droplet, after the 2 GB copy:
#     * An arm64 laptop builds arm64 images. An amd64 droplet then refuses every
#       container with `exec format error`. The platform must be chosen, not
#       inherited from whatever machine happens to run the build.
#     * docker-compose.prod.yml will not even render without the prod secrets
#       (`${POSTGRES_PASSWORD:?…}` and friends), which a laptop does not and
#       should not have. None of them reach an image — compose only needs them to
#       parse the file — so this script feeds placeholders through a throwaway
#       env file and never reads the repo's dev `.env`.
#
#   The one value that DOES reach an image is GOOGLE_CLIENT_ID: Vite inlines it
#   into the bundle. It is taken from the caller's environment, explicitly, so a
#   dev value cannot leak in from a local `.env`.
#
# USAGE (on your own machine, repo root, clean working tree)
#   bash deploy/build-images.sh                          # build + verify only
#   bash deploy/build-images.sh --ship root@<droplet>    # … then docker load there
#   bash deploy/build-images.sh --out /path/images.tar.gz
#   GOOGLE_CLIENT_ID=<id> bash deploy/build-images.sh --ship root@<droplet>
#
# ENVIRONMENT
#   PLATFORM          default linux/amd64 (the droplet's, not this machine's)
#   GOOGLE_CLIENT_ID  default empty = Google Sign-In absent from the bundle
#
# The tag is the current commit. The droplet must have the SAME commit checked
# out and `IMAGE_TAG=<that sha>` in its `.env`; the script prints the line.
# =============================================================================
set -euo pipefail

die()  { echo "FATAL: $*" >&2; exit 1; }
info() { echo "==> $*"; }

cd "$(dirname "$0")/.."

SHIP=""
OUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --ship) SHIP="${2:?--ship needs user@host}"; shift 2 ;;
    --out)  OUT="${2:?--out needs a file path}"; shift 2 ;;
    -h|--help) sed -n 2,34p "$0"; exit 0 ;;
    *) die "unknown argument: $1 (see --help)" ;;
  esac
done
[ -n "$SHIP" ] && [ -n "$OUT" ] && die "--ship and --out are alternatives; pick one"

PLATFORM="${PLATFORM:-linux/amd64}"
WANT_ARCH="${PLATFORM#*/}"

# A dirty tree would produce an image whose tag names code it does not contain.
git diff --quiet HEAD -- || die "uncommitted changes — commit them first; the tag must name the code"
[ -z "$(git ls-files --others --exclude-standard -- backend-dotnet frontend)" ] \
  || die "untracked files under backend-dotnet/ or frontend/ would be built into the image — commit or remove them"
TAG="$(git rev-parse --short HEAD)"
[ -n "$TAG" ] || die "could not read the commit sha"

ENV_TMP="$(mktemp)"
trap 'rm -f "$ENV_TMP"' EXIT
# Placeholders for interpolation only. Nothing here is a secret and nothing here
# is baked into an image.
cat > "$ENV_TMP" <<EOF
IMAGE_TAG=$TAG
GOVORI_SERVER_NAME=build-only.invalid
POSTGRES_USER=build-only
POSTGRES_DB=build-only
POSTGRES_PASSWORD=build-only
MINIO_ROOT_USER=build-only
MINIO_ROOT_PASSWORD=build-only
SECRET_KEY=build-only
GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID:-}
EOF

[ -n "${GOOGLE_CLIENT_ID:-}" ] \
  || echo "note: GOOGLE_CLIENT_ID is empty — this bundle has no Google Sign-In (phone + Telegram OTP only)"

info "building govori/{api,worker,web}:$TAG for $PLATFORM"
DOCKER_DEFAULT_PLATFORM="$PLATFORM" \
  docker compose -f docker-compose.prod.yml --env-file "$ENV_TMP" build api worker web

IMAGES=(govori/api:"$TAG" govori/worker:"$TAG" govori/web:"$TAG")
for img in "${IMAGES[@]}"; do
  arch="$(docker image inspect --format '{{.Architecture}}' "$img" 2>/dev/null)" \
    || die "$img was not produced by the build"
  [ -n "$arch" ] || die "could not read the architecture of $img"
  [ "$arch" = "$WANT_ARCH" ] || die "$img is $arch, wanted $WANT_ARCH"
  echo "    $img  $arch"
done

if [ -n "$OUT" ]; then
  info "writing $OUT"
  docker save "${IMAGES[@]}" | gzip > "$OUT"
  ls -lh "$OUT"
elif [ -n "$SHIP" ]; then
  info "streaming to $SHIP (~1 GB compressed)"
  docker save "${IMAGES[@]}" | gzip | ssh "$SHIP" 'gunzip | docker load'
  for img in "${IMAGES[@]}"; do
    remote_arch="$(ssh "$SHIP" "docker image inspect --format '{{.Architecture}}' $img" 2>/dev/null)" \
      || die "$img is not on $SHIP after the load"
    [ "$remote_arch" = "$WANT_ARCH" ] || die "$img on $SHIP reports '$remote_arch', wanted $WANT_ARCH"
  done
  info "all three images are on $SHIP"
fi

echo
echo "On the droplet: check out $TAG and set in .env:"
echo "    IMAGE_TAG=$TAG"
