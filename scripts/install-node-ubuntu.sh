#!/usr/bin/env bash
# Node.js LTS на Ubuntu/Debian (Timeweb и др.). Запуск: bash scripts/install-node-ubuntu.sh
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
if [[ "${EUID:-0}" -eq 0 ]]; then
  apt-get update -y
  apt-get install -y curl ca-certificates gnupg
else
  sudo apt-get update -y
  sudo apt-get install -y curl ca-certificates gnupg
fi
if [[ "${EUID:-0}" -eq 0 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get update -y
  apt-get install -y nodejs
else
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get update -y
  sudo apt-get install -y nodejs
fi
echo "Установлено: $(command -v node) — $(node -v)"
