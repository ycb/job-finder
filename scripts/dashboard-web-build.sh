#!/usr/bin/env bash
set -euo pipefail

ARGS=()
for arg in "$@"; do
  if [[ "$arg" == -* ]]; then
    ARGS+=("$arg")
  else
    echo "Ignoring non-option build argument: ${arg}" >&2
  fi
done

if (( ${#ARGS[@]} > 0 )); then
  vite build --config src/review/web/vite.config.js "${ARGS[@]}"
else
  vite build --config src/review/web/vite.config.js
fi
