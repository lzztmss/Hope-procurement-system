#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${APP_DIR}/.env"
BACKUP_FILE="${1:-}"

if [[ -z "${BACKUP_FILE}" || ! -f "${BACKUP_FILE}" ]]; then
  echo "用法：bash scripts/restore_db.sh backups/xlx_ops_YYYYMMDD-HHMMSS.sql.gz"
  exit 1
fi

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

echo "恢复会覆盖当前数据库，请先确认已经停止服务并完成当前备份。"
read -r -p "输入 RESTORE 继续：" confirm
if [[ "${confirm}" != "RESTORE" ]]; then
  echo "已取消"
  exit 1
fi

gunzip -c "${BACKUP_FILE}" | psql "${DATABASE_URL}"
echo "恢复完成"
