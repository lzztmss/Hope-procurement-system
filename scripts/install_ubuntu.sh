#!/usr/bin/env bash
set -euo pipefail

APP_NAME="xlx-elderly-ops"
APP_DIR="${APP_DIR:-/opt/${APP_NAME}}"
APP_USER="${APP_USER:-xlxops}"
DB_NAME="${DB_NAME:-xlx_ops}"
DB_USER="${DB_USER:-xlx_ops}"
DOMAIN="${DOMAIN:-}"
PACKAGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "请使用 root 执行：sudo bash scripts/install_ubuntu.sh"
  exit 1
fi

random_secret() {
  openssl rand -base64 48 | tr -d '\n'
}

DB_PASSWORD="${DB_PASSWORD:-$(random_secret)}"
SESSION_SECRET="${SESSION_SECRET:-$(random_secret)}"
INITIAL_ADMIN_PASSWORD="${INITIAL_ADMIN_PASSWORD:-$(random_secret | cut -c1-16)}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://${DOMAIN:-your-domain.example.com}}"

apt-get update
apt-get install -y nodejs npm postgresql postgresql-contrib nginx certbot python3-certbot-nginx openssl rsync

if ! id "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --home "${APP_DIR}" --shell /usr/sbin/nologin "${APP_USER}"
fi

install -d -o "${APP_USER}" -g "${APP_USER}" "${APP_DIR}"
rsync -a --delete \
  --exclude ".env" \
  --exclude "node_modules" \
  "${PACKAGE_DIR}/" "${APP_DIR}/"

sudo -u postgres psql <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';
  ELSE
    ALTER ROLE ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';
  END IF;
END
\$\$;
SELECT 'CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${DB_NAME}')\\gexec
SQL

cat > "${APP_DIR}/.env" <<EOF
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:5432/${DB_NAME}
SESSION_SECRET=${SESSION_SECRET}
INITIAL_ADMIN_PASSWORD=${INITIAL_ADMIN_PASSWORD}
HOST=127.0.0.1
PORT=8787
PUBLIC_BASE_URL=${PUBLIC_BASE_URL}
COOKIE_SECURE=true
SESSION_HOURS=12
PG_POOL_SIZE=10
EOF

chown "${APP_USER}:${APP_USER}" "${APP_DIR}/.env"
chmod 600 "${APP_DIR}/.env"

cd "${APP_DIR}"
npm install --omit=dev
node scripts/migrate_json_to_postgres.js

sed "s#__APP_DIR__#${APP_DIR}#g; s#__APP_USER__#${APP_USER}#g" deploy/systemd.service > /etc/systemd/system/${APP_NAME}.service
systemctl daemon-reload
systemctl enable "${APP_NAME}"
systemctl restart "${APP_NAME}"

echo ""
echo "安装完成。"
echo "初始管理员账号：admin"
echo "初始管理员密码：${INITIAL_ADMIN_PASSWORD}"
echo "下一步：配置域名 DNS 指向本服务器，然后按 docs/公网生产版安装部署说明.md 配置 Nginx 和 HTTPS。"
