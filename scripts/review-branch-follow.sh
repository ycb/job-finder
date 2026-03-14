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
    if [[ "${SKIP_SYNC_NOTE_EMITTED}" -eq 0 ]]; then
      echo "[sync] local tracked changes detected; auto-sync paused until clean."
      SKIP_SYNC_NOTE_EMITTED=1
    fi
    return 0
  fi

  git pull --ff-only "${remote}" "${branch}" >/dev/null 2>&1
  SKIP_SYNC_NOTE_EMITTED=0
  echo "[sync] updated to $(git rev-parse --short HEAD) from ${upstream}"
  return 0
}

echo "review:follow"
echo "  cwd:    $(pwd)"
echo "  branch: $(git branch --show-current)"
echo "  commit: $(git rev-parse --short HEAD)"
echo "  upstream: $(resolve_upstream)"

sync_to_upstream || true

echo "Starting React watch server (local build + review server)..."
npm run review:react:watch &
WATCH_SESSION_PID=$!

while kill -0 "${WATCH_SESSION_PID}" >/dev/null 2>&1; do
  sleep "${POLL_SECONDS}"
  sync_to_upstream || true
done

wait "${WATCH_SESSION_PID}"
