#!/usr/bin/env sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: RESTORE_CONFIRMATION=RESTORE $0 /absolute/path/to/backup.dump" >&2
  exit 1
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
ENV_FILE=${ENV_FILE:-"$PROJECT_ROOT/.env.deploy"}
BACKUP_FILE=$1

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing deployment environment file: $ENV_FILE" >&2
  exit 1
fi
if [ ! -f "$BACKUP_FILE" ] || [ ! -s "$BACKUP_FILE" ]; then
  echo "Backup file is missing or empty: $BACKUP_FILE" >&2
  exit 1
fi
if [ "${RESTORE_CONFIRMATION:-}" != "RESTORE" ]; then
  echo "Restore replaces the current database." >&2
  echo "Run again with RESTORE_CONFIRMATION=RESTORE after checking the target." >&2
  exit 1
fi

compose() {
  docker compose \
    --project-directory "$PROJECT_ROOT" \
    --env-file "$ENV_FILE" \
    -f "$PROJECT_ROOT/compose.yaml" \
    "$@"
}

ENV_FILE="$ENV_FILE" "$SCRIPT_DIR/backend-backup.sh" "$PROJECT_ROOT/backups/pre-restore"

compose stop backend

restart_backend() {
  compose up -d backend
}
trap restart_backend EXIT HUP INT TERM

compose exec -T postgres sh -eu -c \
  'dropdb --force --if-exists --username="$POSTGRES_USER" "$POSTGRES_DB"; createdb --username="$POSTGRES_USER" "$POSTGRES_DB"'

compose exec -T postgres sh -eu -c \
  'pg_restore --exit-on-error --no-owner --no-acl --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' \
  < "$BACKUP_FILE"

restart_backend
trap - EXIT HUP INT TERM
echo "Restore complete. Verify /health and sign-in before removing any backup."
