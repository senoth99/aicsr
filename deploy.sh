#!/usr/bin/env bash
#
# AI Agents — продакшен-запуск и выкладка
#
# Запуск (по умолчанию): загружает .env, NODE_ENV=production, слушает PORT
#   ./deploy.sh
#   ./deploy.sh run
#
# Тот же сервер в фоне (терминал сразу вернёт приглашение):
#   ./deploy.sh background
#
# Синхронизация на сервер (нужны DEPLOY_HOST и т.д. в .env):
#   ./deploy.sh push
#
# Локальная разработка — npm start
#
# На чистом Ubuntu (Timeweb и т.д.): достаточно ./deploy.sh — Node поставится сам
# (apt-get + NodeSource). Отключить: AUTO_INSTALL_NODE=0 в .env
# Или вручную: NODE_BIN=/usr/bin/node
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

# Ищет node; при необходимости ставит (Ubuntu). Задаёт глобальную NODE_EXE или exit.
find_node_or_install() {
  NODE_EXE=""
  if NODE_EXE=$(find_node_exe); then
    return 0
  fi
  local try_auto_install=true
  if [[ "${AUTO_INSTALL_NODE:-1}" == "0" ]]; then
    try_auto_install=false
  fi
  if $try_auto_install && [[ -f "$ROOT/scripts/install-node-ubuntu.sh" ]] && command -v apt-get >/dev/null 2>&1; then
    echo "" >&2
    echo "Node.js не найден — запускаю автоустановку (NodeSource 22.x, apt). Подожди 1–2 минуты…" >&2
    echo "" >&2
    if ! bash "$ROOT/scripts/install-node-ubuntu.sh"; then
      echo "" >&2
      echo "Автоустановка Node не удалась. Запусти вручную: bash scripts/install-node-ubuntu.sh" >&2
      exit 1
    fi
    hash -r 2>/dev/null || true
    if NODE_EXE=$(find_node_exe); then
      return 0
    fi
  fi
  echo "" >&2
  echo "Ошибка: не найден Node.js после установки или на этой ОС нет apt-get." >&2
  echo "Варианты: поставить Node 18+ вручную, либо в .env указать NODE_BIN=/полный/путь/node" >&2
  echo "Отключить попытку автоустановки: AUTO_INSTALL_NODE=0" >&2
  echo "" >&2
  exit 127
}

print_foreground_hint() {
  echo "" >&2
  echo "── Сервер запущен. Терминал «молчит» — это нормально: процесс слушает порт $PORT." >&2
  echo "   Останов: Ctrl+C   |   В фоне без блокировки: ./deploy.sh background" >&2
  echo "" >&2
}

cmd="${1:-run}"

case "$cmd" in
  run | start | "")
    echo "AI Agents — NODE_ENV=$NODE_ENV PORT=$PORT"
    echo "WEBHOOK_UPSTREAM=$WEBHOOK_UPSTREAM"
    find_node_or_install
    print_foreground_hint
    exec "$NODE_EXE" server.mjs
    ;;
  background | detach | daemon)
    echo "AI Agents (фон) — NODE_ENV=$NODE_ENV PORT=$PORT"
    find_node_or_install
    nohup "$NODE_EXE" server.mjs >>"$ROOT/aicsr.log" 2>&1 &
    echo $! >"$ROOT/aicsr.pid"
    echo "PID $(cat "$ROOT/aicsr.pid")  лог: $ROOT/aicsr.log"
    echo "URL: http://0.0.0.0:$PORT/index.html (снаружи — IP сервера и порт $PORT)"
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
    sed -n '1,35p' "$0" | sed 's/^# \{0,2\}//'
    ;;
  *)
    echo "Неизвестная команда: $cmd (используй: run | background | push | help)" >&2
    exit 1
    ;;
esac
