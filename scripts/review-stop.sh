#!/usr/bin/env bash
set -euo pipefail

LABEL="${REVIEW_AGENT_LABEL:-com.jobfinder.review.follow}"
USER_ID="$(id -u)"
STOP_BRIDGE="${REVIEW_STOP_BRIDGE:-1}"

echo "Stopping review/watch processes (if any)..."

launchctl bootout "gui/${USER_ID}/${LABEL}" >/dev/null 2>&1 || true

pkill -f "node src/cli.js review" >/dev/null 2>&1 || true
pkill -f "vite build --config src/review/web/vite.config.js --watch" >/dev/null 2>&1 || true
pkill -f "npm run review:follow" >/dev/null 2>&1 || true
pkill -f "npm run review:react:watch" >/dev/null 2>&1 || true
pkill -f "scripts/review-main-follow.sh" >/dev/null 2>&1 || true
pkill -f "scripts/review-branch-follow.sh" >/dev/null 2>&1 || true
pkill -f "scripts/review-react-watch.sh" >/dev/null 2>&1 || true

if [[ "${STOP_BRIDGE}" == "1" ]]; then
  pkill -f "node src/cli.js bridge-server" >/dev/null 2>&1 || true
fi

echo "Done."
