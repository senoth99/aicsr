#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
ROOT="$(pwd)"
# shellcheck source=scripts/node-path.sh
source "$ROOT/scripts/node-path.sh"
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi
# Освободить 8765 (часто там висит python -m http.server)
for pid in $(lsof -tiTCP:8765 -sTCP:LISTEN 2>/dev/null); do
  kill "$pid" 2>/dev/null || true
done
sleep 0.4
if NODE_EXE=$(find_node_exe); then
  exec "$NODE_EXE" server.mjs
fi
echo "Не найден Node.js. Установи Node 18+ или задай NODE_BIN в .env" >&2
echo "  bash scripts/install-node-ubuntu.sh" >&2
exit 127
