#!/usr/bin/env bash
set -euo pipefail

cleanup() {
  if [[ -n "${WATCH_PID:-}" ]]; then
    kill "${WATCH_PID}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

pick_review_port() {
  for port in 4311 4312 4313 4314 4315 4316 4317 4318 4319 4320; do
    if ! lsof -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "${port}"
      return 0
    fi
  done
  return 1
}

echo "review:react:watch"
echo "  cwd:    $(pwd)"
echo "  branch: $(git branch --show-current)"
echo "  commit: $(git rev-parse --short HEAD)"
echo
echo "Starting Vite build watcher..."
npm run dashboard:web:build -- --watch &
WATCH_PID=$!

DIST_INDEX_PRIMARY="src/review/web/dist/index.html"
DIST_INDEX_LEGACY="dist/index.html"

echo "Waiting for initial dist build..."
until [[ -f "${DIST_INDEX_PRIMARY}" || -f "${DIST_INDEX_LEGACY}" ]]; do
  sleep 0.2
done

REVIEW_PORT="$(pick_review_port || true)"
if [[ -z "${REVIEW_PORT}" ]]; then
  echo "No open review port found in 4311-4320." >&2
  exit 1
fi

echo "Starting review server in React mode on port ${REVIEW_PORT}..."
echo "Open Job Finder: http://127.0.0.1:${REVIEW_PORT}"
JOB_FINDER_DASHBOARD_UI=react node src/cli.js review "${REVIEW_PORT}"
