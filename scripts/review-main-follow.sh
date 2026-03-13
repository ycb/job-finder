#!/usr/bin/env bash
set -euo pipefail

REMOTE="${REVIEW_REMOTE:-origin}"
BRANCH="${REVIEW_BRANCH:-main}"
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

sync_to_remote() {
  git fetch "${REMOTE}" "${BRANCH}" >/dev/null 2>&1 || return 1
  local local_sha
  local remote_sha
  local_sha="$(git rev-parse HEAD)"
  remote_sha="$(git rev-parse "${REMOTE}/${BRANCH}")"

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

  git pull --ff-only "${REMOTE}" "${BRANCH}" >/dev/null 2>&1
  SKIP_SYNC_NOTE_EMITTED=0
  echo "[sync] updated to $(git rev-parse --short HEAD) from ${REMOTE}/${BRANCH}"
  return 0
}

echo "review:main:follow"
echo "  cwd:    $(pwd)"
echo "  branch: $(git branch --show-current)"
echo "  commit: $(git rev-parse --short HEAD)"

if [[ "$(git branch --show-current)" != "${BRANCH}" ]]; then
  echo "This mode expects branch '${BRANCH}'. Checkout ${BRANCH} first." >&2
  exit 1
fi

sync_to_remote || true

echo "Starting React watch server (local build + review server)..."
npm run review:react:watch &
WATCH_SESSION_PID=$!

while kill -0 "${WATCH_SESSION_PID}" >/dev/null 2>&1; do
  sleep "${POLL_SECONDS}"
  sync_to_remote || true
done

wait "${WATCH_SESSION_PID}"
