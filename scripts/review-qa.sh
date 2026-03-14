#!/usr/bin/env bash
set -euo pipefail

pick_review_port() {
  for port in 4311 4312 4313 4314 4315 4316 4317 4318 4319 4320; do
    if ! lsof -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "${port}"
      return 0
    fi
  done
  return 1
}

echo "review:qa"
echo "  cwd:    $(pwd)"
echo "  branch: $(git branch --show-current)"
echo "  commit: $(git rev-parse --short HEAD)"

REVIEW_PORT="$(pick_review_port || true)"
if [[ -z "${REVIEW_PORT}" ]]; then
  echo "No open review port found in 4311-4320." >&2
  exit 1
fi

echo "Starting review server in React mode on port ${REVIEW_PORT}..."
echo "Open Job Finder: http://127.0.0.1:${REVIEW_PORT}"
JOB_FINDER_DASHBOARD_UI=react node src/cli.js review "${REVIEW_PORT}"
