#!/usr/bin/env bash
# =====================================================================
# Build (and push) DocSign docker images — reusable.
#
# Usage:
#   ./build-images.sh [server|client|all] [options]
#
# Options:
#   --tag TAG          Image tag (default: timestamp mm-hh-dd-mm-yyyy)
#   --basename PATH    Client subpath, e.g. /docsign (default: /docsign)
#                      Use "/" for a root-domain deploy (needs its own tag!)
#   --platform PLAT    Build platform (default: linux/amd64)
#   --no-push          Build only, do not push to Docker Hub
#   --update-env       Also update SERVER_TAG/CLIENT_TAG in deploy/.env.example
#   -h, --help         Show this help
#
# Examples:
#   ./build-images.sh server --update-env
#   ./build-images.sh client --basename /docsign --update-env
#   ./build-images.sh all --tag 23-09-22-09-2026 --update-env
#   ./build-images.sh client --basename / --tag root-23-09-22-09-2026
#
# Requirements: repo root as build context, `docker buildx`, Docker Hub login
# (`docker login`) for --push (default on).
# =====================================================================
set -euo pipefail

# --- Repo root = folder containing this script ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR"
cd "$REPO_ROOT"

# --- Defaults ---
REPO="qceank/docsign_custom"
TARGET="all"
TAG="$(date +%M-%H-%d-%m-%Y)"
BASENAME="/docsign"
PLATFORM="linux/amd64"
PUSH=true
UPDATE_ENV=false

usage() { sed -n '2,/^# ===/p' "$SCRIPT_DIR/$(basename "${BASH_SOURCE[0]}")" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    server|client|all) TARGET="$1"; shift ;;
    --tag) TAG="$2"; shift 2 ;;
    --tag=*) TAG="${1#*=}"; shift ;;
    --basename) BASENAME="$2"; shift 2 ;;
    --basename=*) BASENAME="${1#*=}"; shift ;;
    --platform) PLATFORM="$2"; shift 2 ;;
    --platform=*) PLATFORM="${1#*=}"; shift ;;
    --no-push) PUSH=false; shift ;;
    --update-env) UPDATE_ENV=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 1 ;;
  esac
done

PUSH_FLAG=()
if [[ "$PUSH" == true ]]; then PUSH_FLAG=(--push); fi

build_one() { # $1 = server|client
  local name="$1" image="${REPO}-${1}:${TAG}" extra=()
  if [[ "$name" == "client" ]]; then extra+=(--build-arg "BASENAME=${BASENAME}"); fi
  echo "==> Building ${image} (platform=${PLATFORM}, BASENAME=${BASENAME}, push=${PUSH})"
  # shellcheck disable=SC2068
  docker buildx build --platform "$PLATFORM" \
    -f "apps/OpenSign$([ "$name" == server ] && echo Server || echo )/Dockerhubfile" \
    ${extra[@]+"${extra[@]}"} \
    -t "$image" ${PUSH_FLAG[@]+"${PUSH_FLAG[@]}"} .
  echo "==> Done: ${image}"
}

case "$TARGET" in
  server|client) build_one "$TARGET" ;;
  all) build_one server; build_one client ;;
esac

if [[ "$UPDATE_ENV" == true ]]; then
  ENV_EXAMPLE="$REPO_ROOT/deploy/.env.example"
  [[ "$TARGET" == "server" || "$TARGET" == "all" ]] && \
    sed -i.bak "s/^SERVER_TAG=.*/SERVER_TAG=${TAG}/" "$ENV_EXAMPLE"
  [[ "$TARGET" == "client" || "$TARGET" == "all" ]] && \
    sed -i.bak "s/^CLIENT_TAG=.*/CLIENT_TAG=${TAG}/" "$ENV_EXAMPLE"
  rm -f "${ENV_EXAMPLE}.bak"
  echo "==> deploy/.env.example updated (TAG=${TAG})"
  echo "    On the deploy host: update SERVER_TAG/CLIENT_TAG in .env, then"
  echo "    docker compose pull && docker compose up -d --force-recreate"
else
  echo "==> Tip: re-run with --update-env to sync deploy/.env.example,"
  echo "    or set TAG=${TAG} in the deploy host .env manually."
fi
