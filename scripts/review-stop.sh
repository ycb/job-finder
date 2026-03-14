#!/usr/bin/env bash
set -euo pipefail

echo "Stopping review/watch processes (if any)..."

pkill -f "node src/cli.js review" >/dev/null 2>&1 || true
pkill -f "vite build --config src/review/web/vite.config.js --watch" >/dev/null 2>&1 || true
pkill -f "scripts/review-main-follow.sh" >/dev/null 2>&1 || true
pkill -f "scripts/review-react-watch.sh" >/dev/null 2>&1 || true

echo "Done."
