#!/usr/bin/env bash
set -euo pipefail

echo "review:qa (local-first stakeholder QA)"
echo "  cwd:    $(pwd)"
echo "  branch: $(git branch --show-current)"
echo "  commit: $(git rev-parse --short HEAD)"
echo "  mode:   current-worktree + react-watch + fixed port"
echo

# One-command QA loop:
# 1) stop stale review/watch processes
# 2) lock URL to 127.0.0.1:4311
# 3) serve the current worktree only
# 4) rebuild on file changes
bash scripts/review-stop.sh
export REVIEW_FIXED_PORT="${REVIEW_FIXED_PORT:-4311}"
exec bash scripts/review-react-watch.sh
