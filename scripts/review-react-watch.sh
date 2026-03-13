#!/usr/bin/env bash
set -euo pipefail

cleanup() {
  if [[ -n "${WATCH_PID:-}" ]]; then
    kill "${WATCH_PID}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

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

echo "Starting review server in React mode..."
JOB_FINDER_DASHBOARD_UI=react node src/cli.js review
