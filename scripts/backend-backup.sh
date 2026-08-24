#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
ENV_FILE=${ENV_FILE:-"$PROJECT_ROOT/.env.deploy"}
BACKUP_DIR=${1:-"$PROJECT_ROOT/backups"}

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing deployment environment file: $ENV_FILE" >&2
  exit 1
fi

umask 077
mkdir -p "$BACKUP_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
FINAL_PATH="$BACKUP_DIR/ielts-meow-$STAMP.dump"
TEMP_PATH="$FINAL_PATH.partial"

cleanup() {
  rm -f -- "$TEMP_PATH"
}
trap cleanup EXIT HUP INT TERM

docker compose \
  --project-directory "$PROJECT_ROOT" \
  --env-file "$ENV_FILE" \
  -f "$PROJECT_ROOT/compose.yaml" \
  exec -T postgres sh -eu -c \
  'pg_dump --format=custom --compress=9 --no-owner --no-acl --username="$POSTGRES_USER" "$POSTGRES_DB"' \
  > "$TEMP_PATH"

test -s "$TEMP_PATH"
mv -- "$TEMP_PATH" "$FINAL_PATH"
trap - EXIT HUP INT TERM

echo "Backup: $FINAL_PATH"
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$FINAL_PATH"
fi
