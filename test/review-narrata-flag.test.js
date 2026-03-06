import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import {
  isNarrataConnectEnabled,
  isRemoteOkEnabled,
  isWellfoundEnabled,
  renderDashboardPage
} from "../src/review/server.js";

test("isNarrataConnectEnabled defaults to false", () => {
  assert.equal(isNarrataConnectEnabled({}), false);
});

test("isNarrataConnectEnabled accepts common true values", () => {
  assert.equal(isNarrataConnectEnabled({ JOB_FINDER_ENABLE_NARRATA_CONNECT: "1" }), true);
  assert.equal(
    isNarrataConnectEnabled({ JOB_FINDER_ENABLE_NARRATA_CONNECT: "true" }),
    true
  );
  assert.equal(isNarrataConnectEnabled({ JOB_FINDER_ENABLE_NARRATA_CONNECT: "yes" }), true);
  assert.equal(isNarrataConnectEnabled({ JOB_FINDER_ENABLE_NARRATA_CONNECT: "on" }), true);
});

test("renderDashboardPage sets narrataConnectEnabled=false by default", () => {
  const html = renderDashboardPage({});
  assert.equal(html.includes("const narrataConnectEnabled = false;"), true);
});

test("renderDashboardPage sets narrataConnectEnabled=true when enabled in options", () => {
  const html = renderDashboardPage({}, { narrataConnectEnabled: true });
  assert.equal(html.includes("const narrataConnectEnabled = true;"), true);
});

test("isWellfoundEnabled defaults to false", () => {
  assert.equal(isWellfoundEnabled({}), false);
});

test("isWellfoundEnabled accepts common true values", () => {
  assert.equal(isWellfoundEnabled({ JOB_FINDER_ENABLE_WELLFOUND: "1" }), true);
  assert.equal(isWellfoundEnabled({ JOB_FINDER_ENABLE_WELLFOUND: "true" }), true);
  assert.equal(isWellfoundEnabled({ JOB_FINDER_ENABLE_WELLFOUND: "yes" }), true);
  assert.equal(isWellfoundEnabled({ JOB_FINDER_ENABLE_WELLFOUND: "on" }), true);
});

test("isRemoteOkEnabled defaults to false", () => {
  assert.equal(isRemoteOkEnabled({}), false);
});

test("isRemoteOkEnabled accepts common true values", () => {
  assert.equal(isRemoteOkEnabled({ JOB_FINDER_ENABLE_REMOTEOK: "1" }), true);
  assert.equal(isRemoteOkEnabled({ JOB_FINDER_ENABLE_REMOTEOK: "true" }), true);
  assert.equal(isRemoteOkEnabled({ JOB_FINDER_ENABLE_REMOTEOK: "yes" }), true);
  assert.equal(isRemoteOkEnabled({ JOB_FINDER_ENABLE_REMOTEOK: "on" }), true);
});

test("renderDashboardPage sets wellfoundEnabled=false by default", () => {
  const html = renderDashboardPage({});
  assert.equal(html.includes("const wellfoundEnabled = false;"), true);
});

test("renderDashboardPage sets wellfoundEnabled=true when enabled in options", () => {
  const html = renderDashboardPage({}, { wellfoundEnabled: true });
  assert.equal(html.includes("const wellfoundEnabled = true;"), true);
});

test("renderDashboardPage sets remoteokEnabled=false by default", () => {
  const html = renderDashboardPage({});
  assert.equal(html.includes("const remoteokEnabled = false;"), true);
});

test("renderDashboardPage sets remoteokEnabled=true when enabled in options", () => {
  const html = renderDashboardPage({}, { remoteokEnabled: true });
  assert.equal(html.includes("const remoteokEnabled = true;"), true);
});

test("renderDashboardPage emits valid inline script syntax", () => {
  const html = renderDashboardPage({});
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(scriptMatch, "expected inline script tag in dashboard HTML");
  assert.doesNotThrow(() => new vm.Script(scriptMatch[1]));
});

test("renderDashboardPage makes Find Jobs the primary top-level action", () => {
  const html = renderDashboardPage({});
  assert.equal(html.includes('id="save-search-criteria"'), true);
  assert.equal(html.includes('id="run-all"'), false);
  assert.equal(html.includes('id="refresh-data"'), false);
});

test("renderDashboardPage builds searches filters per enabled source kind", () => {
  const html = renderDashboardPage({
    sources: [
      { id: "linkedin-a", name: "LinkedIn A", type: "linkedin_capture_file" },
      { id: "linkedin-b", name: "LinkedIn B", type: "linkedin_capture_file" },
      { id: "indeed-a", name: "Indeed A", type: "indeed_search" }
    ]
  });
  assert.equal(html.includes('data-search-type="li"'), false);
  assert.equal(html.includes('data-search-source="all"'), true);
  assert.equal(html.includes("const searchSourcesByKind = new Map();"), true);
  assert.equal(html.includes("button.dataset.searchSource"), true);
});

test("renderDashboardPage uses inline criteria status and prominent Find Jobs CTA", () => {
  const html = renderDashboardPage({});
  assert.equal(html.includes('id="save-search-criteria"'), true);
  assert.equal(html.includes('class="primary cta-find-jobs'), true);
  assert.equal(html.includes('class="criteria-status'), true);
  assert.equal(html.includes("btn-spinner"), true);
  assert.equal(html.includes('id="jobs-feedback"'), false);
});

test("renderDashboardPage wires Find Jobs to run all sources", () => {
  const html = renderDashboardPage({});
  assert.equal(html.includes('"/api/search-criteria"'), true);
  assert.equal(html.includes('"/api/sources/run-all"'), true);
});

test("renderDashboardPage source filter chips show active counts", () => {
  const html = renderDashboardPage({});
  assert.equal(html.includes("All Results ("), true);
});

test("renderDashboardPage searches table uses compact status", () => {
  const html = renderDashboardPage({});
  assert.equal(html.includes("const droppedHardFilterCount = Number(source.droppedByHardFilterCount || 0);"), false);
  assert.equal(html.includes("const importedThisCaptureCount = Number(source.keptAfterDedupeCount || 0);"), false);
  assert.equal(html.includes("= imported "), false);
  assert.equal(html.includes("db total "), false);
});

test("renderDashboardPage searches table row opens Jobs selected source and icon opens external search", () => {
  const html = renderDashboardPage({});
  assert.equal(html.includes("class=\"search-url\""), false);
  assert.equal(html.includes("data-open-jobs-row"), true);
  assert.equal(html.includes("search-name-link"), true);
  assert.equal(html.includes("target=\"_blank\""), true);
  assert.equal(html.includes("data-stop-row-open=\"1\""), true);
  assert.equal(html.includes("data-open-search-url"), false);
  assert.equal(html.includes("window.open(url, \"_blank\", \"noopener,noreferrer\")"), false);
  assert.equal(html.includes("setSourceFilter(sourceKind);"), true);
  assert.equal(html.includes("data-run-source-kind"), false);
});

test("renderDashboardPage status uses cache-tone dot affordance", () => {
  const html = renderDashboardPage({});
  assert.equal(html.includes("class=\"status-dot\""), true);
  assert.equal(html.includes("data-tone=\""), true);
  assert.equal(html.includes("statusTone"), true);
});

test("renderDashboardPage hides manual Add Search affordances in automated mode", () => {
  const html = renderDashboardPage({});
  assert.equal(html.includes('id="open-add-source"'), false);
  assert.equal(html.includes("Filter by source, review freshness, and focus on where high-signal jobs come from."), false);
});

test("renderDashboardPage searches table shows funnel columns", () => {
  const html = renderDashboardPage({});
  assert.equal(html.includes("<th>Found</th>"), true);
  assert.equal(html.includes("<th>Filtered</th>"), true);
  assert.equal(html.includes("<th>Dupes</th>"), true);
  assert.equal(html.includes("<th>Imported</th>"), true);
  assert.equal(html.includes("<th>Avg Score</th>"), true);
  assert.equal(html.includes("<th>Captured</th>"), false);
  assert.equal(html.includes("<th>Filtered Out</th>"), false);
  assert.equal(html.includes("<th>Deduped Out</th>"), false);
  assert.equal(html.includes("<th>Applied</th>"), false);
  assert.equal(html.includes("<th>Skipped</th>"), false);
  assert.equal(html.includes("<th>High Signal</th>"), false);
  assert.equal(html.includes("<th>Jobs Found</th>"), false);
});

test("renderDashboardPage includes bold totals row for all-sources view", () => {
  const html = renderDashboardPage({});
  assert.equal(
    html.includes('selectedSearchSourceFilter === "all" && filteredSearchSources.length > 0'),
    true
  );
  assert.equal(html.includes('class="search-totals-row"'), true);
  assert.equal(html.includes("All Sources Total"), true);
});

test("renderDashboardPage computes filtered and deduped as dropped counts", () => {
  const html = renderDashboardPage({});
  assert.equal(
    html.includes("const sourceFilteredCount = Number(source.droppedByHardFilterCount || 0);"),
    true
  );
  assert.equal(
    html.includes("const sourceDedupedCount = Number(source.droppedByDedupeCount || 0);"),
    true
  );
});

test("renderDashboardPage computes imported from source import totals", () => {
  const html = renderDashboardPage({});
  assert.equal(
    html.includes("const sourceImportedCount = Number(source.importedCount || 0);"),
    true
  );
  assert.equal(html.includes("current.importedCount += sourceImportedCount;"), true);
});

test("renderDashboardPage weights avg score by imported count", () => {
  const html = renderDashboardPage({});
  assert.equal(
    html.includes("if (Number.isFinite(sourceAvgScore) && sourceImportedCount > 0) {"),
    false
  );
  assert.equal(
    html.includes(
      "source.avgScore === null || source.avgScore === undefined"
    ),
    true
  );
  assert.equal(
    html.includes(
      "sourceAvgScore !== null &&"
    ),
    true
  );
  assert.equal(
    html.includes("current.weightedAvgScoreTotal += sourceAvgScore * sourceImportedCount;"),
    true
  );
  assert.equal(html.includes("current.weightedAvgScoreCount += sourceImportedCount;"), true);
});

test("renderDashboardPage groups jobs source filters by source kind", () => {
  const html = renderDashboardPage({});
  assert.equal(html.includes("const sourceFilterTotals = new Map();"), true);
  assert.equal(html.includes("data-filter-source=\"' + escapeHtml(sourceFilter.kind)"), true);
});

test("renderDashboardPage marks jobs viewed from active queue payload", () => {
  const html = renderDashboardPage({});
  assert.equal(
    html.includes("const target = (dashboard.queue || []).find((item) => item.id === jobId);"),
    true
  );
  assert.equal(
    html.includes("Array.isArray(dashboard?.queue) ? dashboard.queue : []"),
    true
  );
  assert.equal(html.includes("Array.isArray(dashboard?.jobs) ? dashboard.jobs : []"), false);
});
