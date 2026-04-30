#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/lanpo-coffee-ops"
REPO_URL="https://github.com/TaiLaiCai/lanpo-coffee-ops.git"
PORT="${PORT:-3000}"

if [ "$(id -u)" -ne 0 ]; then
  exec sudo -E bash "$0" "$@"
fi

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

apt-get update
apt-get install -y git nginx

if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  rm -rf "$APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"
npm install --omit=dev

if [ ! -f "$APP_DIR/.env" ]; then
  echo "请输入 OpenAI API Key。输入时不会显示："
  read -r -s OPENAI_API_KEY
  echo
  cat > "$APP_DIR/.env" <<ENV
OPENAI_API_KEY=$OPENAI_API_KEY
OPENAI_MODEL=gpt-5.2
PORT=$PORT
ENV
fi

cat > /etc/systemd/system/lanpo-coffee-ops.service <<SERVICE
[Unit]
Description=Lanpo Coffee Multi-Agent Operations Dashboard
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=/usr/bin/node $APP_DIR/server.js
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
SERVICE

cat > /etc/nginx/sites-available/sandlabs.cn <<NGINX
server {
  listen 80;
  server_name sandlabs.cn www.sandlabs.cn;

  location / {
    proxy_pass http://127.0.0.1:$PORT;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}
NGINX

ln -sf /etc/nginx/sites-available/sandlabs.cn /etc/nginx/sites-enabled/sandlabs.cn

systemctl daemon-reload
systemctl enable --now lanpo-coffee-ops
systemctl restart lanpo-coffee-ops
nginx -t
systemctl reload nginx

echo "部署完成："
curl -fsS http://127.0.0.1:$PORT/api/health
echo
