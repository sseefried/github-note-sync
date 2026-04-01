#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOT_FILE="${SCRIPT_DIR}/state-machine.dot"
PDF_FILE="${SCRIPT_DIR}/state-machine.pdf"

if ! command -v dot >/dev/null 2>&1; then
  echo "Graphviz 'dot' is required but was not found in PATH." >&2
  exit 1
fi

if [[ ! -f "${DOT_FILE}" ]]; then
  echo "Missing Graphviz source: ${DOT_FILE}" >&2
  exit 1
fi

dot -Tpdf "${DOT_FILE}" -o "${PDF_FILE}"
echo "Wrote ${PDF_FILE}"
