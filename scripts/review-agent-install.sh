#!/usr/bin/env bash
set -euo pipefail

LABEL="${REVIEW_AGENT_LABEL:-com.jobfinder.review.follow}"
PORT="${REVIEW_FIXED_PORT:-4311}"
USER_ID="$(id -u)"
AGENT_DIR="${HOME}/Library/LaunchAgents"
PLIST_PATH="${AGENT_DIR}/${LABEL}.plist"
LOG_DIR="${HOME}/Library/Logs"
OUT_LOG="${LOG_DIR}/job-finder-review-follow.out.log"
ERR_LOG="${LOG_DIR}/job-finder-review-follow.err.log"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${AGENT_DIR}" "${LOG_DIR}"

cat >"${PLIST_PATH}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>cd "${REPO_DIR}" &amp;&amp; REVIEW_FIXED_PORT=${PORT} npm run review:follow</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${REPO_DIR}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${OUT_LOG}</string>
  <key>StandardErrorPath</key>
  <string>${ERR_LOG}</string>
</dict>
</plist>
EOF

launchctl bootout "gui/${USER_ID}/${LABEL}" >/dev/null 2>&1 || true
launchctl bootstrap "gui/${USER_ID}" "${PLIST_PATH}"
launchctl kickstart -k "gui/${USER_ID}/${LABEL}"

echo "Installed and started ${LABEL}"
echo "URL: http://127.0.0.1:${PORT}"
echo "Logs: ${OUT_LOG} | ${ERR_LOG}"
