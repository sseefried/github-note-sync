#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="github-note-sync-client"
INSTALL_DIR="${HOME}/.local/opt/${SERVICE_NAME}"
SYSTEMD_DIR="${HOME}/.config/systemd/user"
UNIT_PATH="${SYSTEMD_DIR}/${SERVICE_NAME}.service"
LISTEN_PORT="4173"
SERVER_URL="http://127.0.0.1:3001"

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
Usage: scripts/install-user-service.sh [options]

Options:
  --install-dir PATH         Installation directory for the deployed app
  --listen-port PORT         Port used by vite preview
  --server-url URL           Public base URL used by the browser for API requests
  --help                     Show this help
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

copy_repo() {
  rm -rf "${INSTALL_DIR}"
  mkdir -p "${INSTALL_DIR}"

  (
    cd "${SOURCE_DIR}"
    tar \
      --exclude='.git' \
      --exclude='node_modules' \
      --exclude='dist' \
      --exclude='scripts/install-user-service.sh' \
      -cf - .
  ) | (
    cd "${INSTALL_DIR}"
    tar -xf -
  )
}

write_unit() {
  mkdir -p "${SYSTEMD_DIR}"

  cat > "${UNIT_PATH}" <<EOF
[Unit]
Description=GitHub Note Sync Client
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}
ExecStart=/usr/bin/env npm run start -- --server-url=${SERVER_URL} --host 0.0.0.0 --port ${LISTEN_PORT}
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
EOF
}

while (($# > 0)); do
  case "$1" in
    --install-dir)
      INSTALL_DIR="$2"
      shift 2
      ;;
    --listen-port)
      LISTEN_PORT="$2"
      shift 2
      ;;
    --server-url)
      SERVER_URL="$2"
      shift 2
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

UNIT_PATH="${SYSTEMD_DIR}/${SERVICE_NAME}.service"

require_command node
require_command npm
require_command systemctl
require_command tar

copy_repo

(
  cd "${INSTALL_DIR}"
  npm ci
  npm run build -- --server-url="${SERVER_URL}"
)

write_unit

systemctl --user daemon-reload
systemctl --user enable "${SERVICE_NAME}.service"
systemctl --user restart "${SERVICE_NAME}.service"

printf 'Installed %s into %s\n' "${SERVICE_NAME}" "${INSTALL_DIR}"
printf 'User unit written to %s\n' "${UNIT_PATH}"
printf 'Client preview URL: http://127.0.0.1:%s\n' "${LISTEN_PORT}"
printf 'Service status: systemctl --user status %s.service\n' "${SERVICE_NAME}"
printf 'Note: full reboot persistence still requires root to run: loginctl enable-linger %s\n' "${USER}"
