#!/usr/bin/env bash
set -euo pipefail

LABEL="${REVIEW_AGENT_LABEL:-com.jobfinder.review.follow}"
USER_ID="$(id -u)"
PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"

if [[ ! -f "${PLIST_PATH}" ]]; then
  echo "LaunchAgent not installed: ${PLIST_PATH}" >&2
  exit 1
fi

launchctl bootout "gui/${USER_ID}/${LABEL}" >/dev/null 2>&1 || true
launchctl bootstrap "gui/${USER_ID}" "${PLIST_PATH}"
launchctl kickstart -k "gui/${USER_ID}/${LABEL}"

echo "Started ${LABEL}"
