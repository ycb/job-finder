#!/usr/bin/env bash
set -euo pipefail

cleanup() {
  if [[ -n "${WATCH_PID:-}" ]]; then
    kill "${WATCH_PID}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

REVIEW_PORT="${REVIEW_FIXED_PORT:-4311}"

if lsof -iTCP:"${REVIEW_PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "review:react:watch failed: fixed port ${REVIEW_PORT} is already in use." >&2
  echo "Run: npm run review:stop" >&2
  exit 1
fi

echo "review:react:watch"
echo "  cwd:    $(pwd)"
echo "  branch: $(git branch --show-current)"
echo "  commit: $(git rev-parse --short HEAD)"
echo "  url:    http://127.0.0.1:${REVIEW_PORT}"
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

echo "Starting review server in React mode on port ${REVIEW_PORT}..."
echo "Open Job Finder: http://127.0.0.1:${REVIEW_PORT}"
JOB_FINDER_DASHBOARD_UI=react node src/cli.js review "${REVIEW_PORT}"
