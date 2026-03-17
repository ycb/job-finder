#!/usr/bin/env bash
set -euo pipefail

POLL_SECONDS="${REVIEW_SYNC_POLL_SECONDS:-3}"
SKIP_SYNC_NOTE_EMITTED=0

cleanup() {
  if [[ -n "${WATCH_SESSION_PID:-}" ]]; then
    kill "${WATCH_SESSION_PID}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

is_clean_tracked() {
  git diff --quiet && git diff --cached --quiet
}

print_dirty_hint_once() {
  if [[ "${SKIP_SYNC_NOTE_EMITTED}" -eq 1 ]]; then
    return 0
  fi
  local dirty
  dirty="$(git status --short --untracked-files=no | awk '{print $2}' | paste -sd ', ' -)"
  if [[ -n "${dirty}" ]]; then
    echo "[sync] local tracked changes detected; auto-sync paused until clean."
    echo "[sync] dirty tracked files: ${dirty}"
  else
    echo "[sync] local tracked changes detected; auto-sync paused until clean."
  fi
  SKIP_SYNC_NOTE_EMITTED=1
}

resolve_upstream() {
  git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true
}

sync_to_upstream() {
  local upstream
  local remote
  local branch
  local local_sha
  local remote_sha

  upstream="$(resolve_upstream)"
  if [[ -z "${upstream}" ]]; then
    echo "No upstream configured for this branch. Run: git branch --set-upstream-to origin/<branch>" >&2
    return 1
  fi

  remote="${upstream%%/*}"
  branch="${upstream#*/}"

  git fetch "${remote}" "${branch}" >/dev/null 2>&1 || return 1
  local_sha="$(git rev-parse HEAD)"
  remote_sha="$(git rev-parse "${upstream}")"

  if [[ "${local_sha}" == "${remote_sha}" ]]; then
    return 0
  fi

  if ! is_clean_tracked; then
    print_dirty_hint_once
    return 0
  fi

  git pull --ff-only "${remote}" "${branch}" >/dev/null 2>&1
  SKIP_SYNC_NOTE_EMITTED=0
  echo "[sync] updated to $(git rev-parse --short HEAD) from ${upstream}"
  return 0
}

start_watch_session() {
  local branch
  branch="$(git branch --show-current)"
  echo "[watch] start for branch ${branch} (fixed-port=${REVIEW_FIXED_PORT:-auto})"
  npm run review:react:watch &
  WATCH_SESSION_PID=$!
  WATCH_BRANCH="${branch}"
}

restart_watch_session() {
  if [[ -n "${WATCH_SESSION_PID:-}" ]]; then
    kill "${WATCH_SESSION_PID}" >/dev/null 2>&1 || true
    wait "${WATCH_SESSION_PID}" >/dev/null 2>&1 || true
  fi
  start_watch_session
}

echo "review:follow"
echo "  cwd:    $(pwd)"
echo "  branch: $(git branch --show-current)"
echo "  commit: $(git rev-parse --short HEAD)"
echo "  upstream: $(resolve_upstream)"
echo "  url:   http://127.0.0.1:${REVIEW_FIXED_PORT:-auto}"

sync_to_upstream || true

echo "Starting React watch server (local build + review server)..."
start_watch_session

while true; do
  sleep "${POLL_SECONDS}"
  if ! kill -0 "${WATCH_SESSION_PID}" >/dev/null 2>&1; then
    echo "[watch] review process exited; restarting."
    start_watch_session
    continue
  fi

  current_branch="$(git branch --show-current)"
  if [[ "${current_branch}" != "${WATCH_BRANCH}" ]]; then
    echo "[watch] branch changed: ${WATCH_BRANCH} -> ${current_branch}; restarting."
    restart_watch_session
    continue
  fi

  sync_to_upstream || true
done
