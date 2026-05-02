#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/lanpo-coffee-ops"
REPO_URL="https://github.com/TaiLaiCai/lanpo-coffee-ops.git"
PORT="${PORT:-3000}"
DOMAIN="${DOMAIN:-sandlabs.cn}"
WWW_DOMAIN="${WWW_DOMAIN:-www.sandlabs.cn}"

if [ "$(id -u)" -ne 0 ]; then
  if [ -f "$0" ]; then
    exec sudo -E bash "$0" "$@"
  fi

  echo "请使用 sudo 运行部署脚本，例如："
  echo "curl -fsSL https://raw.githubusercontent.com/TaiLaiCai/lanpo-coffee-ops/main/scripts/deploy-sandlabs.sh | sudo bash"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

NODE_BIN="$(command -v node)"
NPM_BIN="$(command -v npm)"

apt-get update
apt-get install -y certbot curl git nginx python3 python3-certbot-nginx

if ! command -v uv >/dev/null 2>&1; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi

export PATH="/root/.local/bin:$PATH"

if ! command -v mini-agent >/dev/null 2>&1; then
  uv tool install git+https://github.com/MiniMax-AI/Mini-Agent.git
else
  uv tool upgrade mini-agent || true
fi

if ! command -v openclaw >/dev/null 2>&1; then
  "$NPM_BIN" install -g openclaw@latest
fi

if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  rm -rf "$APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"
npm install --omit=dev

if [ ! -f "$APP_DIR/.env" ] || ! grep -Eq '^(MINIMAX_API_KEY|OPENAI_API_KEY)=' "$APP_DIR/.env"; then
  echo "请输入 MiniMax API Key。输入时不会显示："
  read -r -s MINIMAX_API_KEY
  echo
  cat > "$APP_DIR/.env" <<ENV
MINIMAX_API_KEY=$MINIMAX_API_KEY
MINIMAX_BASE_URL=https://api.minimaxi.com/v1
MINIMAX_MODEL=MiniMax-M2.7
OPENCLAW_MODEL=MiniMax-M2.7
OPENCLAW_DATA_URL=http://127.0.0.1:18791
OPENCLAW_PRODUCT_URL=http://127.0.0.1:18792
OPENCLAW_MEDIA_URL=http://127.0.0.1:18793
OPENCLAW_GROWTH_URL=http://127.0.0.1:18794
OPENCLAW_MANAGER_URL=http://127.0.0.1:18795
AGENTS_ADMIN_PASSWORD=6666
DAILY_BRIEF_TIME=09:00
MEMBER_WAKEUP_TIME=MON 10:00
# WECHAT_OUTBOUND_WEBHOOK=
# WECHAT_VERIFY_TOKEN=
PORT=$PORT
ENV
fi

if ! grep -Eq '^AGENTS_ADMIN_PASSWORD=' "$APP_DIR/.env"; then
  printf '\nAGENTS_ADMIN_PASSWORD=6666\n' >> "$APP_DIR/.env"
fi

if ! grep -Eq '^OPENCLAW_' "$APP_DIR/.env"; then
  cat >> "$APP_DIR/.env" <<ENV

OPENCLAW_MODEL=MiniMax-M2.7
OPENCLAW_DATA_URL=http://127.0.0.1:18791
OPENCLAW_PRODUCT_URL=http://127.0.0.1:18792
OPENCLAW_MEDIA_URL=http://127.0.0.1:18793
OPENCLAW_GROWTH_URL=http://127.0.0.1:18794
OPENCLAW_MANAGER_URL=http://127.0.0.1:18795
ENV
fi

if ! grep -Eq '^DAILY_BRIEF_TIME=' "$APP_DIR/.env"; then
  printf '\nDAILY_BRIEF_TIME=09:00\nMEMBER_WAKEUP_TIME=MON 10:00\n' >> "$APP_DIR/.env"
fi

MINI_AGENT_CONFIG_DIR="/root/.mini-agent/config"
MINI_AGENT_CONFIG="$MINI_AGENT_CONFIG_DIR/config.yaml"
mkdir -p "$MINI_AGENT_CONFIG_DIR"
MINIMAX_API_KEY_FOR_CONFIG="$(grep -E '^MINIMAX_API_KEY=' "$APP_DIR/.env" | tail -n 1 | cut -d= -f2- || true)"
MINIMAX_BASE_URL_FOR_CONFIG="$(grep -E '^MINIMAX_BASE_URL=' "$APP_DIR/.env" | tail -n 1 | cut -d= -f2- || true)"
MINIMAX_MODEL_FOR_CONFIG="$(grep -E '^MINIMAX_MODEL=' "$APP_DIR/.env" | tail -n 1 | cut -d= -f2- || true)"
MINI_AGENT_API_BASE="${MINIMAX_BASE_URL_FOR_CONFIG%/}"
MINI_AGENT_API_BASE="${MINI_AGENT_API_BASE%/v1}"

cat > "$MINI_AGENT_CONFIG" <<YAML
api_key: "$MINIMAX_API_KEY_FOR_CONFIG"
api_base: "${MINI_AGENT_API_BASE:-https://api.minimaxi.com}"
model: "${MINIMAX_MODEL_FOR_CONFIG:-MiniMax-M2.7}"
max_steps: 100
workspace_dir: "$APP_DIR"
YAML

chmod 600 "$MINI_AGENT_CONFIG"

cat > /etc/systemd/system/lanpo-coffee-ops.service <<SERVICE
[Unit]
Description=Lanpo Coffee Multi-Agent Operations Dashboard
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/root/.local/bin
ExecStart=$NODE_BIN $APP_DIR/server.js
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
SERVICE

cat > /etc/nginx/sites-available/sandlabs.cn <<NGINX
server {
  listen 80;
  server_name $DOMAIN $WWW_DOMAIN;

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

if ! nginx -T 2>/dev/null | grep -q "ssl_certificate .*${DOMAIN}"; then
  echo "正在为 $DOMAIN 配置 HTTPS 证书..."
  if certbot --nginx -d "$DOMAIN" -d "$WWW_DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect; then
    nginx -t
    systemctl reload nginx
  else
    echo "HTTPS 证书申请失败，HTTP 配置已保留。请确认："
    echo "1. $DOMAIN 和 $WWW_DOMAIN 的 DNS A 记录指向这台服务器"
    echo "2. 服务器安全组/防火墙已开放 80 和 443"
    echo "3. 域名拼写是 sandlabs.cn，不是 sandlasbs.cn"
  fi
fi

echo "部署完成："
for attempt in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health"; then
    echo
    exit 0
  fi

  sleep 1
done

echo
echo "Node Agent 服务没有在 20 秒内就绪。下面是最近日志："
systemctl --no-pager --full status lanpo-coffee-ops || true
journalctl -u lanpo-coffee-ops -n 80 --no-pager || true
exit 1
