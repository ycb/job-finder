#!/usr/bin/env bash
set -euo pipefail

LABEL="${REVIEW_AGENT_LABEL:-com.jobfinder.review.follow}"
USER_ID="$(id -u)"

if launchctl print "gui/${USER_ID}/${LABEL}" >/dev/null 2>&1; then
  launchctl print "gui/${USER_ID}/${LABEL}"
  exit 0
fi

echo "Not running: ${LABEL}"
exit 1
