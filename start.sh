#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
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
exec node server.mjs
