# shellcheck shell=bash
# Подключается из deploy.sh и start.sh
find_node_exe() {
  if [[ -n "${NODE_BIN:-}" && -x "$NODE_BIN" ]]; then
    echo "$NODE_BIN"
    return 0
  fi
  if [[ -n "${NODE:-}" && -x "$NODE" ]]; then
    echo "$NODE"
    return 0
  fi
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi
  if [[ -x /usr/bin/node ]]; then
    echo /usr/bin/node
    return 0
  fi
  if [[ -x /usr/local/bin/node ]]; then
    echo /usr/local/bin/node
    return 0
  fi
  return 1
}
