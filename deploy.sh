#!/usr/bin/env bash
#
# AI Agents — продакшен-запуск и выкладка
#
# Запуск (по умолчанию): загружает .env, NODE_ENV=production, слушает PORT
#   ./deploy.sh
#   ./deploy.sh run
#
# Синхронизация на сервер (нужны DEPLOY_HOST и т.д. в .env):
#   ./deploy.sh push
#
# Локальная разработка с авто-освобождением порта — по-прежнему: npm start
#
# На чистом Ubuntu без Node: bash scripts/install-node-ubuntu.sh
# Или в .env: NODE_BIN=/путь/к/node
#
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# shellcheck source=scripts/node-path.sh
source "$ROOT/scripts/node-path.sh"

if [[ ! -f .env ]] && [[ -f "$ROOT/.env.example" ]]; then
  cp "$ROOT/.env.example" "$ROOT/.env"
  echo "Создан .env из .env.example — проверь WEBHOOK_UPSTREAM и PORT."
fi

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

export NODE_ENV="${NODE_ENV:-production}"
export PORT="${PORT:-8765}"
export WEBHOOK_UPSTREAM="${WEBHOOK_UPSTREAM:-https://senoth.cashercollection.com/webhook/bddcd127-c647-4823-9ad9-8a9dd4688621}"

cmd="${1:-run}"

case "$cmd" in
  run | start | "")
    echo "AI Agents — NODE_ENV=$NODE_ENV PORT=$PORT"
    echo "WEBHOOK_UPSTREAM=$WEBHOOK_UPSTREAM"
    if NODE_EXE=$(find_node_exe); then
      exec "$NODE_EXE" server.mjs
    fi
    echo "" >&2
    echo "Ошибка: не найден Node.js (команда node не в PATH)." >&2
    echo "На Ubuntu/Debian установи, например:" >&2
    echo "  bash scripts/install-node-ubuntu.sh" >&2
    echo "Или задай в .env полный путь: NODE_BIN=/usr/bin/node" >&2
    echo "" >&2
    exit 127
    ;;
  push | ship)
    if [[ -z "${DEPLOY_HOST:-}" ]]; then
      echo "Ошибка: задай DEPLOY_HOST в .env (и при необходимости DEPLOY_USER, DEPLOY_PATH)." >&2
      exit 1
    fi
    DEPLOY_USER="${DEPLOY_USER:-ubuntu}"
    DEPLOY_PATH="${DEPLOY_PATH:-/opt/ai-agents}"
    echo "rsync → ${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_PATH}/"
    rsync -az --delete \
      --exclude .git \
      --exclude node_modules \
      --exclude .env \
      "$ROOT/" "${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_PATH}/"
    if [[ -n "${DEPLOY_REMOTE_CMD:-}" ]]; then
      echo "ssh: ${DEPLOY_REMOTE_CMD}"
      ssh -o BatchMode=yes "${DEPLOY_USER}@${DEPLOY_HOST}" "${DEPLOY_REMOTE_CMD}"
    else
      echo "DEPLOY_REMOTE_CMD не задан — только rsync. На сервере перезапусти сервис вручную."
    fi
    ;;
  help | -h | --help)
    sed -n '1,25p' "$0" | sed 's/^# \{0,2\}//'
    ;;
  *)
    echo "Неизвестная команда: $cmd (используй: run | push | help)" >&2
    exit 1
    ;;
esac
