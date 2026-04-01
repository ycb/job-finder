import { spawnSync } from "node:child_process";

import { extractLinkedInStructuredJobsFromHtml } from "../src/sources/linkedin-structured-payload.js";

function runAppleScript(script, timeoutMs = 60_000) {
  const result = spawnSync("osascript", ["-e", script], {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 20 * 1024 * 1024
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
  const openScript = [
    'tell application "Google Chrome"',
    "set _window to make new window",
    `set URL of active tab of _window to "${escapeAppleScriptString(url)}"`,
    "set bounds of _window to {90, 90, 1280, 900}",
    "return id of _window",
    "end tell"
  ].join("\n");
  const raw = runAppleScript(openScript);
  const windowId = Number(raw);
  if (!Number.isInteger(windowId)) {
    throw new Error(`Could not create Chrome window: ${raw}`);
  }
  return windowId;
}

function executeInChromeWindow(windowId, js, timeoutMs = 60_000) {
  const execScript = [
    'tell application "Google Chrome"',
    `set _window to window id ${windowId}`,
    'tell active tab of _window',
    `set resultText to execute javascript "${escapeAppleScriptString(js)}"`,
    "end tell",
    "return resultText",
    "end tell"
  ].join("\n");
  return runAppleScript(execScript, timeoutMs);
}

function closeChromeWindow(windowId) {
  const closeScript = [
    'tell application "Google Chrome"',
    `close window id ${windowId}`,
    "end tell"
  ].join("\n");
  try {
    runAppleScript(closeScript, 15_000);
  } catch {
    // best-effort cleanup
  }
}

function readPageState(windowId) {
  const js = [
    "(() => {",
    "  return JSON.stringify({",
    "    href: String(location.href || ''),",
    "    title: String(document.title || ''),",
    "    outerHTML: String(document.documentElement?.outerHTML || ''),",
    "    rowIds: Array.from(document.querySelectorAll('li[data-occludable-job-id]')).map((node) => node.getAttribute('data-occludable-job-id')).filter(Boolean),",
    "    visibleTitles: Array.from(document.querySelectorAll('li[data-occludable-job-id]')).map((node) => String(node.innerText || '').trim()).filter(Boolean).slice(0, 25)",
    "  });",
    "})()"
  ].join("");
  return JSON.parse(executeInChromeWindow(windowId, js));
}

function scrollResults(windowId) {
  const js = [
    "(() => {",
    "  const selectors = [",
    "    '.scaffold-layout__list-container',",
    "    '.jobs-search-results-list',",
    "    '.jobs-search-results-list__list',",
    "    '.scaffold-layout__list',",
    "    '.scaffold-layout__main',",
    "    'main'",
    "  ];",
    "  const candidateDetails = selectors.map((selector) => {",
    "    const node = document.querySelector(selector);",
    "    return {",
    "      selector,",
    "      exists: Boolean(node),",
    "      clientHeight: node ? Number(node.clientHeight || 0) : 0,",
    "      scrollHeight: node ? Number(node.scrollHeight || 0) : 0,",
    "      scrollTop: node ? Number(node.scrollTop || 0) : 0,",
    "      className: node ? String(node.className || '') : ''",
    "    };",
    "  });",
    "  const nodes = selectors.map((selector) => ({ selector, node: document.querySelector(selector) })).filter((entry) => entry.node);",
    "  const ranked = nodes",
    "    .map((entry) => ({",
    "      selector: entry.selector,",
    "      node: entry.node,",
    "      capacity: Math.max(0, Number(entry.node.scrollHeight || 0) - Number(entry.node.clientHeight || 0))",
    "    }))",
    "    .sort((a, b) => b.capacity - a.capacity);",
    "  const best = ranked[0];",
    "  const scroller = best?.node || document.scrollingElement || document.documentElement;",
    "  const snapshots = [];",
    "  const step = Math.max(600, Math.floor((scroller.clientHeight || window.innerHeight || 900) * 0.8));",
    "  for (let i = 0; i < 10; i += 1) {",
    "    const before = scroller.scrollTop || window.scrollY || 0;",
    "    if (scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body) {",
    "      window.scrollTo(0, before + step);",
    "    } else {",
    "      scroller.scrollTop = before + step;",
    "    }",
    "    snapshots.push({ i, before, after: scroller.scrollTop || window.scrollY || 0 });",
    "  }",
    "  return JSON.stringify({",
    "    selectedScroller: best ? { selector: best.selector, capacity: best.capacity } : { selector: 'document', capacity: Math.max(0, Number((document.scrollingElement || document.documentElement).scrollHeight || 0) - Number((document.scrollingElement || document.documentElement).clientHeight || 0)) },",
    "    candidateDetails,",
    "    snapshots",
    "  });",
    "})()"
  ].join("");
  return JSON.parse(executeInChromeWindow(windowId, js));
}

function summarize(page) {
  const jobs = extractLinkedInStructuredJobsFromHtml(page.outerHTML);
  return {
    pageUrl: page.href,
    pageTitle: page.title,
    rowIdCount: page.rowIds.length,
    visibleTitleCount: page.visibleTitles.length,
    structuredCount: jobs.length,
    structuredJobIds: jobs.map((job) => job.externalId),
    jobs: jobs.slice(0, 25)
  };
}

const url =
  process.argv[2] ||
  "https://www.linkedin.com/jobs/search/?distance=25&f_SB2=9&f_TPR=r259200&keywords=Product%20manager%20ai&location=San%20Francisco%2C%20CA";

const settleMs = Number(process.argv[3]) > 0 ? Number(process.argv[3]) : 8_000;
const postScrollMs = Number(process.argv[4]) > 0 ? Number(process.argv[4]) : 5_000;

const windowId = openChromeWindow(url);
try {
  sleepSync(settleMs);
  const beforePage = readPageState(windowId);
  const scrollInfo = scrollResults(windowId);
  sleepSync(postScrollMs);
  const afterPage = readPageState(windowId);

  console.log(
    JSON.stringify(
      {
        url,
        settleMs,
        postScrollMs,
        before: summarize(beforePage),
        scrollInfo,
        after: summarize(afterPage)
      },
      null,
      2
    )
  );
} finally {
  closeChromeWindow(windowId);
}
