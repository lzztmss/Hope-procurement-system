#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-${APP_DIR}/backups}"
ENV_FILE="${APP_DIR}/.env"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL 未配置"
  exit 1
fi

mkdir -p "${BACKUP_DIR}"
STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="${BACKUP_DIR}/xlx_ops_${STAMP}.sql.gz"

pg_dump "${DATABASE_URL}" | gzip > "${TARGET}"
find "${BACKUP_DIR}" -name 'xlx_ops_*.sql.gz' -mtime +30 -delete

echo "${TARGET}"
