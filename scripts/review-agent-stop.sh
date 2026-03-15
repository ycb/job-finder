#!/usr/bin/env bash
set -euo pipefail

LABEL="${REVIEW_AGENT_LABEL:-com.jobfinder.review.follow}"
USER_ID="$(id -u)"

launchctl bootout "gui/${USER_ID}/${LABEL}" >/dev/null 2>&1 || true

echo "Stopped ${LABEL}"
