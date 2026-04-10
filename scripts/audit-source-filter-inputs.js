import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadSources } from "../src/config/load-config.js";
import { probeSourceFilterInputsWithChromeAppleScript } from "../src/browser-bridge/providers/chrome-applescript.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function normalizeFilterEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const computedInputType = entry.inputType
    ? String(entry.inputType)
    : classifyFilterElement(entry);

  return {
    inputType: computedInputType || "unknown",
    label: String(entry.label || ""),
    placeholder: entry.placeholder ? String(entry.placeholder) : "",
    ariaAutocomplete: entry.ariaAutocomplete ? String(entry.ariaAutocomplete) : "",
    role: entry.role ? String(entry.role) : "",
    selector: entry.selector ? String(entry.selector) : ""
  };
}

export function classifyFilterElement(meta) {
  if (!meta || typeof meta !== "object") {
    return "text";
  }
  if (meta.role === "combobox" || meta.ariaAutocomplete === "list") {
    return "typeahead";
  }
  if (meta.type === "checkbox") {
    return "checkbox";
  }
  if (meta.tag === "SELECT") {
    return "select";
  }
  return "text";
}

export function normalizeAuditResult(raw) {
  const safe = raw && typeof raw === "object" ? raw : {};
  const filters = Array.isArray(safe.filters)
    ? safe.filters
        .map((entry) => normalizeFilterEntry(entry))
        .filter(Boolean)
    : [];
  return {
    sourceId: String(safe.sourceId || ""),
    sourceType: String(safe.sourceType || ""),
    searchUrl: String(safe.searchUrl || ""),
    pageTitle: String(safe.pageTitle || ""),
    finalUrl: String(safe.finalUrl || ""),
    status: String(safe.status || "ok"),
    errorMessage: safe.errorMessage ? String(safe.errorMessage) : null,
    filters
  };
}

export function renderAuditMarkdown(rows) {
  const lines = [
    "# Source Filter Input Audit",
    "",
    "Run `node scripts/audit-source-filter-inputs.js` to regenerate.",
    ""
  ];

  if (!Array.isArray(rows) || rows.length === 0) {
    lines.push("- no rows captured");
    return lines.join("\n");
  }

  return lines
    .concat(
      rows.map((row) => `- ${row.sourceId}: ${row.filters.length} filters`)
    )
    .join("\n");
}

function sortRowsBySourceId(rows) {
  return [...rows].sort((left, right) =>
    String(left.sourceId || "").localeCompare(String(right.sourceId || ""))
  );
}

export async function runSourceFilterInputAudit({
  sources = loadSources().sources,
  probeFn = probeSourceFilterInputsWithChromeAppleScript
} = {}) {
  const rows = [];
  for (const source of sources) {
    const probe = await probeFn(source);
    rows.push(normalizeAuditResult(probe));
  }
  return sortRowsBySourceId(rows);
}

export function writeAuditArtifacts(rows, { jsonPath, markdownPath }) {
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  const sorted = sortRowsBySourceId(rows);
  fs.writeFileSync(`${jsonPath}`, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
  fs.writeFileSync(`${markdownPath}`, `${renderAuditMarkdown(sorted)}\n`, "utf8");
}

async function runAuditAndWriteArtifacts() {
  const rows = await runSourceFilterInputAudit();
  const baseDir = path.resolve(__dirname, "..", "docs", "analysis");
  const jsonPath = path.join(baseDir, "2026-04-04-source-filter-input-audit.json");
  const markdownPath = path.join(baseDir, "2026-04-04-source-filter-input-audit.md");
  writeAuditArtifacts(rows, { jsonPath, markdownPath });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAuditAndWriteArtifacts();
}
