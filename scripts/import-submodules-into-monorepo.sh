#!/usr/bin/env bash
set -euo pipefail

# One-shot history import for a clean clone of the current top-level repo.
# Result:
# - current top-level history stays at the repo root
# - github-note-sync-client history is rewritten under client/
# - github-note-sync-server history is rewritten under server/
# - submodule metadata is removed
#
# Requirements:
# - run from a clean clone of the top-level repo
# - git-filter-repo must be installed and available as `git filter-repo`
#
# Usage:
#   bash scripts/import-submodules-into-monorepo.sh

CLIENT_SUBDIR="${CLIENT_SUBDIR:-client}"
SERVER_SUBDIR="${SERVER_SUBDIR:-server}"
CLIENT_SUBMODULE_PATH="${CLIENT_SUBMODULE_PATH:-github-note-sync-client}"
SERVER_SUBMODULE_PATH="${SERVER_SUBMODULE_PATH:-github-note-sync-server}"
BACKUP_BRANCH_PREFIX="${BACKUP_BRANCH_PREFIX:-backup/pre-monorepo-import}"
TOP_LEVEL_BRANCH="${TOP_LEVEL_BRANCH:-main}"
IMPORT_TEMP_ROOT=""

require_clean_worktree() {
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "Working tree is not clean. Run this from a fresh clean clone." >&2
    exit 1
  fi
}

require_command() {
  local cmd="$1"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "Missing required command: ${cmd}" >&2
    exit 1
  fi
}

require_git_filter_repo() {
  if ! git filter-repo --version >/dev/null 2>&1; then
    echo "git-filter-repo is required. Install it first." >&2
    exit 1
  fi
}

require_repo_root() {
  local top
  top="$(git rev-parse --show-toplevel)"
  cd "${top}"
}

require_top_level_branch() {
  local current_branch
  current_branch="$(git branch --show-current)"

  if [[ "${current_branch}" != "${TOP_LEVEL_BRANCH}" ]]; then
    echo "Expected top-level branch '${TOP_LEVEL_BRANCH}', found '${current_branch}'." >&2
    echo "Switch branches first, or override with TOP_LEVEL_BRANCH=<branch>." >&2
    exit 1
  fi
}

require_submodule_repo() {
  local path="$1"
  if [[ ! -d "${path}" ]]; then
    echo "Missing submodule directory: ${path}" >&2
    exit 1
  fi

  if ! git -C "${path}" rev-parse --git-dir >/dev/null 2>&1; then
    echo "Submodule is not initialized as a git repo: ${path}" >&2
    echo "Run: git submodule update --init --recursive" >&2
    exit 1
  fi
}

cleanup() {
  if [[ -n "${IMPORT_TEMP_ROOT}" && -d "${IMPORT_TEMP_ROOT}" ]]; then
    rm -rf "${IMPORT_TEMP_ROOT}"
  fi
}

clone_and_rewrite() {
  local source_path="$1"
  local target_clone="$2"
  local subdir="$3"

  git clone --no-local "${source_path}" "${target_clone}" >/dev/null
  git -C "${target_clone}" filter-repo --to-subdirectory-filter "${subdir}" --force >/dev/null
}

fetch_import_refs() {
  local import_clone="$1"
  local branch_prefix="$2"
  local tag_prefix="$3"

  git fetch "${import_clone}" \
    "+refs/heads/*:refs/heads/${branch_prefix}/*" \
    "+refs/tags/*:refs/tags/${tag_prefix}/*" >/dev/null
}

merge_import_branch() {
  local ref_name="$1"
  local label="$2"

  git merge --no-ff --allow-unrelated-histories -m "Import ${label} history into monorepo" "${ref_name}"
}

detect_import_branch() {
  local import_clone="$1"
  local branch_name=""

  branch_name="$(git -C "${import_clone}" symbolic-ref -q --short HEAD || true)"
  if [[ -n "${branch_name}" ]]; then
    printf '%s\n' "${branch_name}"
    return
  fi

  branch_name="$(git -C "${import_clone}" for-each-ref --format='%(refname:short)' refs/heads | head -n 1)"
  if [[ -n "${branch_name}" ]]; then
    printf '%s\n' "${branch_name}"
    return
  fi

  echo "Could not determine the import branch for ${import_clone}" >&2
  exit 1
}

main() {
  require_command git
  require_git_filter_repo
  require_repo_root
  require_clean_worktree
  require_top_level_branch

  if [[ ! -f .gitmodules ]]; then
    echo "Expected .gitmodules in the top-level repo clone." >&2
    exit 1
  fi

  require_submodule_repo "${CLIENT_SUBMODULE_PATH}"
  require_submodule_repo "${SERVER_SUBMODULE_PATH}"

  if [[ -e "${CLIENT_SUBDIR}" || -e "${SERVER_SUBDIR}" ]]; then
    echo "Target directories already exist: ${CLIENT_SUBDIR} or ${SERVER_SUBDIR}" >&2
    echo "Set CLIENT_SUBDIR/SERVER_SUBDIR differently or remove the existing directories first." >&2
    exit 1
  fi

  local current_branch
  local client_branch
  local server_branch
  local backup_branch

  current_branch="$(git branch --show-current)"
  backup_branch="${BACKUP_BRANCH_PREFIX}-$(date +%Y%m%d-%H%M%S)"

  IMPORT_TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/github-note-sync-monorepo-import.XXXXXX")"
  trap cleanup EXIT

  echo "Creating backup branch ${backup_branch}"
  git branch "${backup_branch}"

  echo "Cloning and rewriting submodule histories"
  clone_and_rewrite "${CLIENT_SUBMODULE_PATH}" "${IMPORT_TEMP_ROOT}/client-import" "${CLIENT_SUBDIR}"
  clone_and_rewrite "${SERVER_SUBMODULE_PATH}" "${IMPORT_TEMP_ROOT}/server-import" "${SERVER_SUBDIR}"
  client_branch="$(detect_import_branch "${IMPORT_TEMP_ROOT}/client-import")"
  server_branch="$(detect_import_branch "${IMPORT_TEMP_ROOT}/server-import")"

  echo "Removing submodule metadata from top-level history"
  git rm -f "${CLIENT_SUBMODULE_PATH}" "${SERVER_SUBMODULE_PATH}"
  git rm -f .gitmodules
  rm -rf ".git/modules/${CLIENT_SUBMODULE_PATH}" ".git/modules/${SERVER_SUBMODULE_PATH}"
  git commit -m "Remove submodule metadata before monorepo import"

  echo "Fetching rewritten histories into namespaced refs"
  fetch_import_refs "${IMPORT_TEMP_ROOT}/client-import" "import/client" "import-client"
  fetch_import_refs "${IMPORT_TEMP_ROOT}/server-import" "import/server" "import-server"

  echo "Merging client history from ${client_branch}"
  merge_import_branch "refs/heads/import/client/${client_branch}" "client"

  echo "Merging server history from ${server_branch}"
  merge_import_branch "refs/heads/import/server/${server_branch}" "server"

  echo
  echo "Monorepo import complete on branch ${current_branch}"
  echo "Backup branch: ${backup_branch}"
  echo "Imported directories:"
  echo "  ${CLIENT_SUBDIR}/"
  echo "  ${SERVER_SUBDIR}/"
  echo
  echo "Imported refs are preserved under:"
  echo "  refs/heads/import/client/*"
  echo "  refs/heads/import/server/*"
  echo "  refs/tags/import-client/*"
  echo "  refs/tags/import-server/*"
}

main "$@"
