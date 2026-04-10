#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TMP_DIR="$(mktemp -d /tmp/jf-filter-audit-XXXXXX)"
JS_PATH="$TMP_DIR/filter-probe.js"
JS_LINES_PATH="$TMP_DIR/filter-probe-lines.scpt"
SOURCES_PATH="$TMP_DIR/sources.tsv"
ROWS_PATH="$TMP_DIR/rows.jsonl"
JSON_OUT="$ROOT_DIR/docs/analysis/2026-04-04-source-filter-input-audit.json"
MD_OUT="$ROOT_DIR/docs/analysis/2026-04-04-source-filter-input-audit.md"

cleanup() {
  if [ "${KEEP_TMP:-}" = "1" ]; then
    return
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

cat > "$JS_PATH" <<'EOF'
(() => {
  const normalize = (value) => typeof value === "string"
    ? value.replace(/\s+/g, " ").trim()
    : "";

  const cssEscape = (value) => String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\"/g, "\\\"");

  const textFromIds = (value) => {
    const ids = String(value || "").trim();
    if (!ids) return "";
    return ids.split(/\s+/)
      .map((id) => document.getElementById(id))
      .filter(Boolean)
      .map((node) => normalize(node.textContent || ""))
      .filter(Boolean)
      .join(" ");
  };

  const pickLabel = (element) => {
    const ariaLabel = normalize(element.getAttribute("aria-label"));
    if (ariaLabel) return ariaLabel;
    const ariaLabelled = textFromIds(element.getAttribute("aria-labelledby"));
    if (ariaLabelled) return ariaLabelled;
    if (element.labels && element.labels.length) {
      const labels = Array.from(element.labels)
        .map((label) => normalize(label.textContent || ""))
        .filter(Boolean);
      if (labels.length) return labels.join(" ");
    }
    const parentLabel = element.closest("label");
    if (parentLabel) {
      const labelText = normalize(parentLabel.textContent || "");
      if (labelText) return labelText;
    }
    const placeholder = normalize(element.getAttribute("placeholder"));
    if (placeholder) return placeholder;
    const name = normalize(element.getAttribute("name"));
    if (name) return name;
    const id = normalize(element.getAttribute("id"));
    return id;
  };

  const buildSelector = (element) => {
    const tag = String(element.tagName || "").toLowerCase();
    const id = normalize(element.getAttribute("id"));
    if (id) return "#" + cssEscape(id);
    const testId = normalize(element.getAttribute("data-testid"));
    if (testId) return tag + "[data-testid=\\"" + cssEscape(testId) + "\\"]";
    const name = normalize(element.getAttribute("name"));
    if (name) return tag + "[name=\\"" + cssEscape(name) + "\\"]";
    const placeholder = normalize(element.getAttribute("placeholder"));
    if (placeholder) return tag + "[placeholder=\\"" + cssEscape(placeholder) + "\\"]";
    return "";
  };

  const rawCandidates = Array.from(
    document.querySelectorAll("input, select, textarea, [role='combobox'], [role='listbox']")
  );

  const filtered = rawCandidates.filter((element) => {
    const tag = String(element.tagName || "");
    if (tag === "INPUT") {
      const type = normalize(element.getAttribute("type") || element.type || "text").toLowerCase();
      if (["hidden", "password", "submit", "button", "reset"].includes(type)) {
        return false;
      }
    }
    return true;
  });

  const seen = new Set();
  const filters = [];
  for (const element of filtered) {
    const tag = String(element.tagName || "");
    const type = normalize(element.getAttribute("type") || element.type || "");
    const role = normalize(element.getAttribute("role"));
    const ariaAutocomplete = normalize(element.getAttribute("aria-autocomplete"));
    const placeholder = normalize(element.getAttribute("placeholder"));
    const label = normalize(pickLabel(element));
    const selector = normalize(buildSelector(element));
    const key = [tag, type, role, ariaAutocomplete, placeholder, label, selector].join("|");
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    filters.push({
      tag,
      type,
      role,
      ariaAutocomplete,
      placeholder,
      label,
      selector
    });
  }

  return JSON.stringify({
    finalUrl: String(location.href || ""),
    pageTitle: String(document.title || ""),
    filters
  });
})()
EOF

node -e '
  const fs = require("node:fs");
  const js = fs.readFileSync(process.argv[1], "utf8");
  const escaped = js
    .replace(/"/g, "\"\"")
    .replace(/\r?\n/g, "\\n");
  const chunkSize = 300;
  const lines = ["set js to \"\""];
  for (let i = 0; i < escaped.length; i += chunkSize) {
    const chunk = escaped.slice(i, i + chunkSize);
    lines.push(`set js to js & \"${chunk}\"`);
  }
  fs.writeFileSync(process.argv[2], lines.join("\n"));
' "$JS_PATH" "$JS_LINES_PATH"

node --input-type=module -e '
  import { loadSources } from "./src/config/load-config.js";
  const { sources } = loadSources();
  for (const source of sources) {
    const id = String(source?.id || "");
    const type = String(source?.type || "");
    const url = String(source?.searchUrl || "");
    console.log([id, type, url].join("\t"));
  }
' > "$SOURCES_PATH"

rm -f "$ROWS_PATH"

while IFS=$'\t' read -r sourceId sourceType searchUrl; do
  if [ -z "$searchUrl" ]; then
    echo "{\"sourceId\":\"$sourceId\",\"sourceType\":\"$sourceType\",\"searchUrl\":\"\",\"pageTitle\":\"\",\"finalUrl\":\"\",\"status\":\"error\",\"errorMessage\":\"missing searchUrl\",\"filters\":[]}" >> "$ROWS_PATH"
    continue
  fi

  scriptPath="$TMP_DIR/run-${sourceId}.scpt"
  {
    cat "$JS_LINES_PATH"
    echo ""
    cat <<EOF
tell application "Google Chrome"
  set _window to make new window
  set URL of active tab of _window to "$searchUrl"
  delay 1.5
  tell active tab of _window
    set resultText to execute javascript js
  end tell
  set tabUrl to URL of active tab of _window
  set tabTitle to title of active tab of _window
  close _window
  return tabUrl & "\n" & tabTitle & "\n" & resultText
end tell
EOF
  } > "$scriptPath"

  result=$(/usr/bin/osascript "$scriptPath" || true)

  if [ -z "$result" ]; then
    echo "{\"sourceId\":\"$sourceId\",\"sourceType\":\"$sourceType\",\"searchUrl\":\"$searchUrl\",\"pageTitle\":\"\",\"finalUrl\":\"\",\"status\":\"error\",\"errorMessage\":\"empty response\",\"filters\":[]}" >> "$ROWS_PATH"
    continue
  fi

  finalUrl=$(printf "%s" "$result" | sed -n '1p')
  pageTitle=$(printf "%s" "$result" | sed -n '2p')
  payload=$(printf "%s" "$result" | sed -n '3,$p')
  if [ -z "$payload" ]; then
    echo "{\"sourceId\":\"$sourceId\",\"sourceType\":\"$sourceType\",\"searchUrl\":\"$searchUrl\",\"pageTitle\":\"$pageTitle\",\"finalUrl\":\"$finalUrl\",\"status\":\"error\",\"errorMessage\":\"missing payload\",\"filters\":[]}" >> "$ROWS_PATH"
    continue
  fi
  printf "%s" "$payload" | node -e '
    const fs = require("node:fs");
    const input = fs.readFileSync(0, "utf8");
    const parsed = JSON.parse(input);
    parsed.sourceId = process.argv[1];
    parsed.sourceType = process.argv[2];
    parsed.searchUrl = process.argv[3];
    parsed.pageTitle = parsed.pageTitle || process.argv[4];
    parsed.finalUrl = parsed.finalUrl || process.argv[5];
    parsed.status = "ok";
    parsed.errorMessage = null;
    process.stdout.write(JSON.stringify(parsed));
  ' "$sourceId" "$sourceType" "$searchUrl" "$pageTitle" "$finalUrl" >> "$ROWS_PATH"
  printf "\n" >> "$ROWS_PATH"
done < "$SOURCES_PATH"

node --input-type=module -e '
  import fs from "node:fs";
  import path from "node:path";
  const rows = fs.readFileSync(process.argv[1], "utf8")
    .split(/\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  rows.sort((a, b) => String(a.sourceId).localeCompare(String(b.sourceId)));
  fs.mkdirSync(path.dirname(process.argv[2]), { recursive: true });
  fs.writeFileSync(process.argv[2], JSON.stringify(rows, null, 2) + "\n", "utf8");
  const lines = [
    "# Source Filter Input Audit",
    "",
    "Run `scripts/audit-source-filter-inputs.sh` to regenerate.",
    ""
  ];
  for (const row of rows) {
    lines.push(`- ${row.sourceId}: ${Array.isArray(row.filters) ? row.filters.length : 0} filters`);
  }
  fs.writeFileSync(process.argv[3], lines.join("\n") + "\n", "utf8");
' "$ROWS_PATH" "$JSON_OUT" "$MD_OUT"

echo "Wrote:"
echo "  $JSON_OUT"
echo "  $MD_OUT"
