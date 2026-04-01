import { spawnSync } from "node:child_process";

import {
  buildLinkedInDiagnosticSummary,
  extractLinkedInJobIdsFromResourceNames
} from "../src/sources/linkedin-diagnostic.js";
import { extractLinkedInStructuredJobsFromHtml } from "../src/sources/linkedin-structured-payload.js";

function runAppleScript(script, timeoutMs = 60_000) {
  const result = spawnSync("osascript", ["-e", script], {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 30 * 1024 * 1024
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || "").trim() || `osascript exited ${result.status}`);
  }

  return String(result.stdout || "").trim();
}

function escapeAppleScriptString(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

function sleepSync(milliseconds) {
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, milliseconds);
}

function openChromeWindow(url) {
  const script = [
    'tell application "Google Chrome"',
    "set _window to make new window",
    `set URL of active tab of _window to "${escapeAppleScriptString(url)}"`,
    "set bounds of _window to {90, 90, 1280, 900}",
    "return id of _window",
    "end tell"
  ].join("\n");
  const raw = runAppleScript(script);
  const windowId = Number(raw);
  if (!Number.isInteger(windowId)) {
    throw new Error(`Could not create Chrome window: ${raw}`);
  }
  return windowId;
}

function executeInChromeWindow(windowId, js, timeoutMs = 60_000) {
  const script = [
    'tell application "Google Chrome"',
    `set _window to window id ${windowId}`,
    'tell active tab of _window',
    `set resultText to execute javascript "${escapeAppleScriptString(js)}"`,
    "end tell",
    "return resultText",
    "end tell"
  ].join("\n");
  return runAppleScript(script, timeoutMs);
}

function closeChromeWindow(windowId) {
  try {
    runAppleScript(
      [
        'tell application "Google Chrome"',
        `close window id ${windowId}`,
        "end tell"
      ].join("\n"),
      15_000
    );
  } catch {
    // no-op
  }
}

function snapshotPage(windowId) {
  const js = [
    "(() => {",
    "  const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();",
    "  const extractId = (raw) => {",
    "    const input = normalize(raw);",
    "    const match = input.match(/(?:currentJobId=|jobId=|\\/jobs\\/view\\/)(\\d{6,})/);",
    "    return match ? match[1] : '';",
    "  };",
    "  const rows = Array.from(document.querySelectorAll('li[data-occludable-job-id], [data-occludable-job-id]'))",
    "    .map((node) => node.closest('li[data-occludable-job-id]') || node.closest('[data-occludable-job-id]') || node)",
    "    .filter(Boolean);",
    "  const deduped = [];",
    "  const seen = new Set();",
    "  for (const row of rows) {",
    "    const rowId = extractId(row.getAttribute('data-occludable-job-id') || row.getAttribute('data-job-id') || '');",
    "    if (!rowId || seen.has(rowId)) continue;",
    "    seen.add(rowId);",
    "    const titleAnchor = row.querySelector('a[href*=\"/jobs/view/\"], a[href*=\"currentJobId=\"]') || row.querySelector('a[href]');",
    "    const title = normalize(titleAnchor?.innerText || titleAnchor?.textContent || '');",
    "    const companyNode = row.querySelector('.artdeco-entity-lockup__subtitle span, .job-card-container__company-name, .artdeco-entity-lockup__subtitle, .base-search-card__subtitle a, .base-search-card__subtitle');",
    "    const company = normalize(companyNode?.innerText || companyNode?.textContent || '');",
    "    deduped.push({",
    "      rowId,",
    "      title,",
    "      company,",
    "      href: normalize(titleAnchor?.getAttribute('href') || ''),",
    "      textLength: normalize(row.innerText || row.textContent || '').length",
    "    });",
    "  }",
    "  const resources = performance.getEntriesByType('resource')",
    "    .map((entry) => ({",
    "      name: String(entry.name || ''),",
    "      initiatorType: String(entry.initiatorType || ''),",
    "      duration: Number(entry.duration || 0)",
    "    }))",
    "    .filter((entry) => /linkedin\\.com|voyagerJobsDash|voyager\\/api|jobs\\/search/i.test(entry.name));",
    "  const windowKeys = Object.keys(window).filter((key) => /(voyager|apollo|store|redux|jobs)/i.test(key)).slice(0, 50);",
    "  return JSON.stringify({",
    "    href: String(location.href || ''),",
    "    title: String(document.title || ''),",
    "    currentJobId: extractId(String(location.href || '')),",
    "    rowSnapshots: deduped,",
    "    visibleTitleCount: deduped.filter((row) => row.title && row.company).length,",
    "    resources,",
    "    windowKeys,",
    "    outerHTML: String(document.documentElement?.outerHTML || '')",
    "  });",
    "})()"
  ].join("");
  return JSON.parse(executeInChromeWindow(windowId, js));
}

function probeRowActivation(windowId, rowIds) {
  const idsJson = JSON.stringify(rowIds);
  const js = [
    "(() => {",
    "  const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();",
    "  const wait = (ms) => { const start = Date.now(); while (Date.now() - start < ms) {} };",
    "  const extractId = (raw) => {",
    "    const input = normalize(raw);",
    "    const match = input.match(/(?:currentJobId=|jobId=|\\/jobs\\/view\\/)(\\d{6,})/);",
    "    return match ? match[1] : '';",
    "  };",
    `  const targetIds = ${idsJson};`,
    "  const results = [];",
    "  const detailLinkSelector = '.jobs-search__job-details a[href*=\"/jobs/view/\"], .jobs-search__job-details a[href*=\"currentJobId=\"], .scaffold-layout__detail a[href*=\"/jobs/view/\"], .scaffold-layout__detail a[href*=\"currentJobId=\"]';",
    "  const detailTitleSelector = '.job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title, .t-24.job-details-jobs-unified-top-card__job-title, .t-24.t-bold.inline';",
    "  const detailCompanySelector = '.job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name, .job-details-jobs-unified-top-card__primary-description a, .jobs-unified-top-card__primary-description a';",
    "  for (const rowId of targetIds) {",
    "    const row = document.querySelector('li[data-occludable-job-id=\"' + rowId + '\"], [data-occludable-job-id=\"' + rowId + '\"]');",
    "    if (!row) {",
    "      results.push({ rowId, rowFound: false });",
    "      continue;",
    "    }",
    "    const titleAnchor = row.querySelector('a[href*=\"/jobs/view/\"], a[href*=\"currentJobId=\"]') || row.querySelector('a[href]');",
    "    const beforeTitle = normalize(titleAnchor?.innerText || titleAnchor?.textContent || '');",
    "    row.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });",
    "    wait(80);",
    "    const target = titleAnchor || row;",
    "    try {",
    "      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true, view: window }));",
    "      target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, composed: true, view: window }));",
    "      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, view: window }));",
    "    } catch {",
    "      if (typeof target.click === 'function') target.click();",
    "    }",
    "    wait(300);",
    "    const currentJobId = extractId(String(location.href || ''));",
    "    const detailLink = document.querySelector(detailLinkSelector);",
    "    const detailExternalId = extractId(String(detailLink?.getAttribute('href') || location.href || ''));",
    "    const detailTitle = normalize(document.querySelector(detailTitleSelector)?.innerText || document.querySelector(detailTitleSelector)?.textContent || '');",
    "    const detailCompany = normalize(document.querySelector(detailCompanySelector)?.innerText || document.querySelector(detailCompanySelector)?.textContent || '');",
    "    const afterTitle = normalize(titleAnchor?.innerText || titleAnchor?.textContent || '');",
    "    results.push({",
    "      rowId,",
    "      rowFound: true,",
    "      beforeTitle,",
    "      afterTitle,",
    "      hydratedAfterActivation: Boolean(afterTitle),",
    "      currentJobId,",
    "      detailExternalId,",
    "      selectedJobMatched: Boolean(detailExternalId && detailExternalId === rowId) || Boolean(currentJobId && currentJobId === rowId),",
    "      detailTitle,",
    "      detailCompany",
    "    });",
    "  }",
    "  return JSON.stringify(results);",
    "})()"
  ].join("");
  return JSON.parse(executeInChromeWindow(windowId, js, 90_000));
}

function uniqueResourceNames(resources = []) {
  return Array.from(new Set(resources.map((entry) => String(entry?.name || "")).filter(Boolean)));
}

function chooseProbeRowIds(before) {
  const structuredIds = new Set(extractLinkedInStructuredJobsFromHtml(before.outerHTML).map((job) => job.externalId));
  return before.rowSnapshots
    .filter((row) => !row.title || !row.company || !structuredIds.has(String(row.rowId)))
    .map((row) => String(row.rowId))
    .filter(Boolean)
    .slice(0, 10);
}

function summarizeSnapshot(rawSnapshot, activationResults = []) {
  const structuredJobs = extractLinkedInStructuredJobsFromHtml(rawSnapshot.outerHTML);
  const structuredJobIds = structuredJobs.map((job) => job.externalId);
  const resourceNames = uniqueResourceNames(rawSnapshot.resources);
  const resourceJobIds = extractLinkedInJobIdsFromResourceNames(resourceNames);
  return {
    pageUrl: rawSnapshot.href,
    pageTitle: rawSnapshot.title,
    currentJobId: rawSnapshot.currentJobId,
    rowSnapshots: rawSnapshot.rowSnapshots,
    structuredJobIds,
    resourceJobIds,
    structuredJobs: structuredJobs.slice(0, 25),
    visibleTitleCount: rawSnapshot.visibleTitleCount,
    resourceNames,
    windowKeys: rawSnapshot.windowKeys,
    summary: buildLinkedInDiagnosticSummary({
      rowSnapshots: rawSnapshot.rowSnapshots,
      structuredJobIds,
      activationResults,
      resourceJobIds
    })
  };
}

const url =
  process.argv[2] ||
  "https://www.linkedin.com/jobs/search/?distance=25&f_SB2=9&f_TPR=r259200&keywords=Product%20manager%20ai&location=San%20Francisco%2C%20CA";
const settleMs = Number(process.argv[3]) > 0 ? Number(process.argv[3]) : 8_000;

const windowId = openChromeWindow(url);
try {
  sleepSync(settleMs);
  const beforeRaw = snapshotPage(windowId);
  const probeRowIds = chooseProbeRowIds(beforeRaw);
  const activationResults = probeRowIds.length ? probeRowActivation(windowId, probeRowIds) : [];
  sleepSync(1_000);
  const afterRaw = snapshotPage(windowId);

  const before = summarizeSnapshot(beforeRaw);
  const after = summarizeSnapshot(afterRaw, activationResults);
  const beforeResourceNames = new Set(before.resourceNames);
  const newResourcesAfterActivation = after.resourceNames.filter((name) => !beforeResourceNames.has(name));

  console.log(
    JSON.stringify(
      {
        url,
        settleMs,
        probedRowIds: probeRowIds,
        before,
        activationResults,
        after,
        newResourcesAfterActivation
      },
      null,
      2
    )
  );
} finally {
  closeChromeWindow(windowId);
}
