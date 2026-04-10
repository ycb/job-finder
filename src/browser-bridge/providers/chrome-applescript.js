import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { writeAshbyCaptureFile } from "../../sources/ashby-jobs.js";
import { writeGoogleCaptureFile } from "../../sources/google-jobs.js";
import {
  filterIndeedCapturedJobs,
  getIndeedNativeFilterState,
  INDEED_EXPECTED_COUNT_SELECTORS,
  writeIndeedCaptureFile
} from "../../sources/indeed-jobs.js";
import {
  buildLevelsFyiApiUrlFromSearchUrl,
  parseLevelsFyiSearchHtml,
  parseLevelsFyiSearchPayload,
  writeLevelsFyiCaptureFile
} from "../../sources/levelsfyi-jobs.js";
import { sanitizeLinkedInJob } from "../../sources/linkedin-cleanup.js";
import { extractLinkedInStructuredPageFromResponseBody } from "../../sources/linkedin-structured-payload.js";
import { writeLinkedInCaptureFile } from "../../sources/linkedin-saved-search.js";
import { writeRemoteOkCaptureFile } from "../../sources/remoteok-jobs.js";
import { writeWellfoundCaptureFile } from "../../sources/wellfound-jobs.js";
import {
  parseYcJobsPayload,
  resolveYcRecencyFraction,
  writeYcCaptureFile
} from "../../sources/yc-jobs.js";
import { loadSearchCriteria } from "../../config/load-config.js";
import { writeZipRecruiterCaptureFile } from "../../sources/ziprecruiter-jobs.js";
import { enrichJobsWithDetailPages } from "../../sources/detail-enrichment.js";

function sleepSync(milliseconds) {
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, milliseconds);
}

function escapeAppleScriptString(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '""')
    .replace(/[\r\n]+/g, " ");
}

function runAppleScript(script, timeoutMs = 15_000) {
  const lines = Array.isArray(script)
    ? script
    : String(script || "").split(/\r?\n/).filter(Boolean);
  const args = [];
  for (const line of lines) {
    args.push("-e", line);
  }
  const attempt = () =>
    spawnSync("osascript", args, {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: timeoutMs
    });

  let result = attempt();
  if (
    result.status !== 0 &&
    /Can’t get application \"Google Chrome\"/.test(String(result.stderr || result.stdout || "")) &&
    /-1728/.test(String(result.stderr || result.stdout || ""))
  ) {
    spawnSync("osascript", ["-e", 'tell application "Google Chrome" to activate'], {
      encoding: "utf8",
      timeout: timeoutMs
    });
    sleepSync(350);
    result = attempt();
  }

  if (result.error) {
    if (result.error.code === "ETIMEDOUT") {
      throw new Error(`Chrome AppleScript timed out after ${timeoutMs}ms.`);
    }

    throw result.error;
  }

  if (result.status !== 0) {
    const errorText = String(result.stderr || result.stdout || "").trim();
    if (
      /Allow JavaScript from Apple Events/i.test(errorText) ||
      /Access not allowed/i.test(errorText) ||
      /\(-1723\)/.test(errorText)
    ) {
      throw new Error(
        'Chrome is blocking JavaScript automation. In Chrome, enable View > Developer > "Allow JavaScript from Apple Events", then rerun capture.'
      );
    }

    throw new Error(errorText || `AppleScript exited with status ${result.status}.`);
  }

  return String(result.stdout || "").trim();
}

let automationWindowId = null;

function createChromeProbeWindow(url, timeoutMs) {
  const escapedUrl = escapeAppleScriptString(url);
  const rawId = runAppleScript(
    `tell application "Google Chrome" to id of (make new window)`,
    timeoutMs
  );

  const parsedId = Number(String(rawId || "").trim());
  if (!Number.isInteger(parsedId)) {
    throw new Error("Could not create probe Chrome window.");
  }
  runAppleScript(
    `tell application "Google Chrome" to set URL of active tab of window id ${parsedId} to "${escapedUrl}"`,
    timeoutMs
  );
  return parsedId;
}

function closeChromeWindow(windowId) {
  if (!Number.isInteger(windowId)) {
    return;
  }

  try {
    runAppleScript(
      `tell application "Google Chrome" to close window id ${windowId}`
    );
  } catch {
    // no-op
  }
}

function executeInChromeWindow(windowId, javaScript, timeoutMs) {
  if (!Number.isInteger(windowId)) {
    throw new Error("executeInChromeWindow requires a valid window id.");
  }

  return runAppleScript(
    `tell application "Google Chrome" to tell active tab of window id ${windowId} to execute javascript "${escapeAppleScriptString(
      javaScript
    )}"`,
    timeoutMs
  );
}

function executeInChromeWindowEncoded(windowId, javaScript, timeoutMs) {
  const encoded = Buffer.from(String(javaScript || ""), "utf8").toString("base64");
  const wrapped = `(() => { const script = atob('${encoded}'); return eval(script); })()`;
  return executeInChromeWindow(windowId, wrapped, timeoutMs);
}

function executeInChromeWindowFromFile(windowId, filePath, timeoutMs) {
  if (!Number.isInteger(windowId)) {
    throw new Error("executeInChromeWindowFromFile requires a valid window id.");
  }

  const escapedPath = escapeAppleScriptString(filePath);
  return runAppleScript(
    `tell application "Google Chrome" to tell active tab of window id ${windowId} to execute javascript (read POSIX file "${escapedPath}")`,
    timeoutMs
  );
}

function readChromeWindowTabInfo(windowId) {
  if (!Number.isInteger(windowId)) {
    return { url: "", title: "" };
  }

  const raw = runAppleScript(
    `tell application "Google Chrome" to (URL of active tab of window id ${windowId}) & "\\n" & (title of active tab of window id ${windowId})`
  );

  const [url = "", title = ""] = String(raw || "").split(/\r?\n/, 2);
  return {
    url: String(url || "").trim(),
    title: String(title || "").trim()
  };
}

function buildAutomationStatusUrl(message) {
  const content = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Job Finder Automation</title>
    <style>
      body {
        margin: 0;
        font-family: Georgia, serif;
        background: #f6f3eb;
        color: #21312f;
      }
      .panel {
        max-width: 680px;
        margin: 12vh auto 0;
        padding: 28px 30px;
        border: 1px solid #cbbfa6;
        border-radius: 14px;
        background: #fffefb;
      }
      h1 {
        margin: 0 0 12px;
        font-size: 32px;
      }
      p {
        margin: 0;
        font-size: 20px;
      }
    </style>
  </head>
  <body>
    <div class="panel">
      <h1>Job Finder Automation</h1>
      <p>${String(message || "Refreshing sources...")}</p>
    </div>
  </body>
</html>`;
  return `data:text/html,${encodeURIComponent(content)}`;
}

function ensureAutomationWindow(message) {
  if (Number.isInteger(automationWindowId)) {
    try {
      runAppleScript(
        [
          'tell application "Google Chrome"',
          `set _window to window id ${automationWindowId}`,
          "if _window is missing value then error \"missing\"",
          "end tell"
        ].join("\n")
      );
      return automationWindowId;
    } catch {
      automationWindowId = null;
    }
  }

  const escapedStatusUrl = escapeAppleScriptString(
    buildAutomationStatusUrl(message)
  );
  const rawId = runAppleScript(
    [
      'tell application "Google Chrome"',
      "set _window to make new window",
      `set URL of active tab of _window to "${escapedStatusUrl}"`,
      "set bounds of _window to {80, 80, 1260, 880}",
      "return id of _window",
      "end tell"
    ].join("\n")
  );

  const parsedId = Number(String(rawId || "").trim());
  if (!Number.isInteger(parsedId)) {
    throw new Error("Could not create automation Chrome window.");
  }
  automationWindowId = parsedId;
  return automationWindowId;
}

function showAutomationMessage(message) {
  const windowId = ensureAutomationWindow(message);
  const escapedStatusUrl = escapeAppleScriptString(
    buildAutomationStatusUrl(message)
  );

  runAppleScript(
    [
      'tell application "Google Chrome"',
      `set _window to window id ${windowId}`,
      `set URL of active tab of _window to "${escapedStatusUrl}"`,
      "end tell"
    ].join("\n")
  );
}

function closeAutomationWindow() {
  if (!Number.isInteger(automationWindowId)) {
    return;
  }

  try {
    runAppleScript(
      [
        'tell application "Google Chrome"',
        `set _window to window id ${automationWindowId}`,
        "if _window is not missing value then close _window",
        "end tell"
      ].join("\n")
    );
  } catch {
    // no-op
  } finally {
    automationWindowId = null;
  }
}

function navigateAutomationTab(url, message, timeoutMs) {
  const windowId = ensureAutomationWindow(message);
  showAutomationMessage(message);
  runAppleScript(
    [
      'tell application "Google Chrome"',
      `set _window to window id ${windowId}`,
      `set URL of active tab of _window to "${escapeAppleScriptString(url)}"`,
      "end tell"
    ].join("\n"),
    timeoutMs
  );
}

function executeInAutomationTab(javaScript, timeoutMs) {
  const windowId = ensureAutomationWindow("Refreshing sources...");
  return runAppleScript(
    [
      'tell application "Google Chrome"',
      "set _previousWindow to front window",
      `set _window to window id ${windowId}`,
      "set index of _window to 1",
      'tell active tab of _window',
      `set resultText to execute javascript "${escapeAppleScriptString(javaScript)}"`,
      "end tell",
      "set index of _previousWindow to 1",
      "return resultText",
      "end tell"
    ].join("\n"),
    timeoutMs
  );
}

function executeInAutomationWindowFront(javaScript, timeoutMs) {
  const windowId = ensureAutomationWindow("Refreshing sources...");
  return runAppleScript(
    [
      'tell application "Google Chrome"',
      "activate",
      `set _window to window id ${windowId}`,
      "set index of _window to 1",
      'tell active tab of _window',
      `set resultText to execute javascript "${escapeAppleScriptString(javaScript)}"`,
      "end tell",
      "return resultText",
      "end tell"
    ].join("\n"),
    timeoutMs
  );
}

function executeInAutomationWindowFrontEncoded(javaScript, timeoutMs) {
  const windowId = ensureAutomationWindow("Refreshing sources...");
  runAppleScript(
    [
      'tell application "Google Chrome"',
      "activate",
      `set _window to window id ${windowId}`,
      "set index of _window to 1",
      "end tell"
    ].join("\n"),
    timeoutMs
  );
  return executeInChromeWindowEncoded(windowId, javaScript, timeoutMs);
}

function executeInFrontWindow(javaScript, timeoutMs) {
  return runAppleScript(
    [
      'tell application "Google Chrome"',
      'set _window to front window',
      'tell active tab of _window',
      `set resultText to execute javascript "${escapeAppleScriptString(javaScript)}"`,
      "end tell",
      "return resultText",
      "end tell"
    ].join("\n"),
    timeoutMs
  );
}

function executeInWindowMatchingUrl(javaScript, urlSubstring, timeoutMs) {
  const needle = escapeAppleScriptString(String(urlSubstring || "").trim());
  if (!needle) {
    throw new Error("executeInWindowMatchingUrl requires a URL substring.");
  }

  return runAppleScript(
    [
      'tell application "Google Chrome"',
      "set _targetTab to missing value",
      "repeat with _window in windows",
      "repeat with _tab in tabs of _window",
      "set _tabUrl to URL of _tab",
      `if _tabUrl contains "${needle}" then`,
      "set _targetTab to _tab",
      "exit repeat",
      "end if",
      "end repeat",
      "if _targetTab is not missing value then exit repeat",
      "end repeat",
      "if _targetTab is missing value then error \"No matching Chrome window found\"",
      "tell _targetTab",
      `set resultText to execute javascript "${escapeAppleScriptString(javaScript)}"`,
      "end tell",
      "return resultText",
      "end tell"
    ].join("\n"),
    timeoutMs
  );
}

function executeInMatchingTabWithActivation(javaScript, urlSubstring, timeoutMs) {
  const needle = escapeAppleScriptString(String(urlSubstring || "").trim());
  if (!needle) {
    throw new Error("executeInMatchingTabWithActivation requires a URL substring.");
  }

  return runAppleScript(
    [
      'tell application "Google Chrome"',
      "set _targetWindowIndex to 0",
      "set _targetTabIndex to 0",
      "set _windowIndex to 1",
      "repeat with _window in windows",
      "set _tabIndex to 1",
      "repeat with _tab in tabs of _window",
      "set _tabUrl to URL of _tab",
      `if _tabUrl contains "${needle}" then`,
      "set _targetWindowIndex to _windowIndex",
      "set _targetTabIndex to _tabIndex",
      "exit repeat",
      "end if",
      "set _tabIndex to _tabIndex + 1",
      "end repeat",
      "if _targetWindowIndex is not 0 then exit repeat",
      "set _windowIndex to _windowIndex + 1",
      "end repeat",
      "if _targetWindowIndex is 0 then error \"No matching Chrome tab found\"",
      "set _targetWindowId to id of window _targetWindowIndex",
      "tell tab _targetTabIndex of window id _targetWindowId",
      `set resultText to execute javascript "${escapeAppleScriptString(javaScript)}"`,
      "end tell",
      "return resultText",
      "end tell"
    ].join("\n"),
    timeoutMs
  );
}

function listTabUrlsMatchingSubstring(urlSubstring, maxUrls = 12) {
  const needle = escapeAppleScriptString(String(urlSubstring || "").trim());
  const limit = Number(maxUrls) > 0 ? Math.floor(Number(maxUrls)) : 12;
  if (!needle) {
    return [];
  }

  const raw = runAppleScript(
    [
      'tell application "Google Chrome"',
      "set _matches to {}",
      "repeat with _window in windows",
      "repeat with _tab in tabs of _window",
      "set _tabUrl to URL of _tab",
      `if _tabUrl contains "${needle}" then`,
      "set end of _matches to _tabUrl",
      "end if",
      "end repeat",
      "end repeat",
      "set _output to \"\"",
      "repeat with _url in _matches",
      "set _output to _output & _url & \"\\n\"",
      "end repeat",
      "return _output",
      "end tell"
    ].join("\n")
  );

  return String(raw || "")
    .split(/\r?\n/)
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .slice(0, limit);
}

function readAutomationTabInfo() {
  const windowId = ensureAutomationWindow("Refreshing sources...");
  const raw = runAppleScript(
    [
      'tell application "Google Chrome"',
      `set _window to window id ${windowId}`,
      "set tabUrl to URL of active tab of _window",
      "set tabTitle to title of active tab of _window",
      "return tabUrl & \"\\n\" & tabTitle",
      "end tell"
    ].join("\n")
  );

  const [url = "", title = ""] = String(raw || "").split(/\r?\n/, 2);
  return {
    url: String(url || "").trim(),
    title: String(title || "").trim()
  };
}

function readFrontTabInfo() {
  const raw = runAppleScript(
    [
      'tell application "Google Chrome"',
      "set tabUrl to URL of active tab of front window",
      "set tabTitle to title of active tab of front window",
      "return tabUrl & \"\\n\" & tabTitle",
      "end tell"
    ].join("\n")
  );

  const [url = "", title = ""] = String(raw || "").split(/\r?\n/, 2);
  return {
    url: String(url || "").trim(),
    title: String(title || "").trim()
  };
}

function readTabInfoByUrlSubstring(urlSubstring) {
  const needle = escapeAppleScriptString(String(urlSubstring || "").trim());
  if (!needle) {
    throw new Error("readTabInfoByUrlSubstring requires a URL substring.");
  }

  const raw = runAppleScript(
    [
      'tell application "Google Chrome"',
      "set _targetUrl to \"\"",
      "set _targetTitle to \"\"",
      "repeat with _window in windows",
      "repeat with _tab in tabs of _window",
      "set _tabUrl to URL of _tab",
      `if _tabUrl contains "${needle}" then`,
      "set _targetUrl to _tabUrl",
      "set _targetTitle to title of _tab",
      "exit repeat",
      "end if",
      "end repeat",
      "if _targetUrl is not \"\" then exit repeat",
      "end repeat",
      "return _targetUrl & \"\\n\" & _targetTitle",
      "end tell"
    ].join("\n")
  );

  const [url = "", title = ""] = String(raw || "").split(/\r?\n/, 2);
  return {
    url: String(url || "").trim(),
    title: String(title || "").trim()
  };
}

function uniqueOrderedStrings(values = []) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function pickDetectedFilterState(sourceType, captureDiagnostics) {
  const diagnostics =
    captureDiagnostics &&
    typeof captureDiagnostics === "object" &&
    !Array.isArray(captureDiagnostics)
      ? captureDiagnostics
      : null;
  if (!diagnostics) {
    return null;
  }

  if (sourceType === "indeed_search") {
    const filterState = {
      queryValue: String(diagnostics.queryValue || "").trim() || null,
      locationValue: String(diagnostics.locationValue || "").trim() || null,
      appliedPayFilter: String(diagnostics.appliedPayFilter || "").trim() || null,
      appliedDatePostedFilter:
        String(diagnostics.appliedDatePostedFilter || "").trim() || null,
      appliedDistanceFilter:
        String(diagnostics.appliedDistanceFilter || "").trim() || null
    };
    return Object.values(filterState).some(Boolean) ? filterState : null;
  }

  return null;
}

function buildCaptureTelemetry(source, payload = {}, options = {}) {
  const startedAt =
    typeof options.startedAt === "string" && options.startedAt.trim()
      ? options.startedAt
      : new Date().toISOString();
  const finishedAt = new Date().toISOString();
  const tabInfo = options.tabInfo && typeof options.tabInfo === "object" ? options.tabInfo : {};
  const finalUrl = String(tabInfo.url || payload.pageUrl || source?.searchUrl || "").trim() || null;
  const visitedUrls = uniqueOrderedStrings([
    source?.searchUrl,
    payload?.pageUrl,
    ...(Array.isArray(payload?.visitedUrls) ? payload.visitedUrls : []),
    finalUrl
  ]);
  const pageTitlesVisited = uniqueOrderedStrings([
    ...(Array.isArray(payload?.pageTitlesVisited) ? payload.pageTitlesVisited : []),
    tabInfo.title
  ]);
  const pageCountVisited = Number(
    payload?.captureDiagnostics?.pageCountVisited ?? payload?.pageCountVisited ?? 1
  );
  const stopReason = String(
    payload?.captureDiagnostics?.stopReason || payload?.stopReason || "completed"
  ).trim();

  return {
    sourceId: String(source?.id || "").trim() || null,
    provider: "chrome_applescript",
    status: String(options.status || "live_success"),
    triggeredAt: startedAt,
    finishedAt,
    initialUrl: String(source?.searchUrl || "").trim() || null,
    visitedUrls,
    finalUrl,
    pageTitlesVisited,
    pageCountVisited: Number.isFinite(pageCountVisited) && pageCountVisited > 0
      ? Math.round(pageCountVisited)
      : null,
    captureCountByPage: Array.isArray(payload?.captureCountByPage)
      ? payload.captureCountByPage
      : null,
    stopReason: stopReason || null,
    detectedFilterState: pickDetectedFilterState(source?.type, payload?.captureDiagnostics)
  };
}

const AUTH_REQUIRED_SOURCE_TYPES = new Set([
  "linkedin_capture_file",
  "yc_jobs",
  "wellfound_search",
  "indeed_search",
  "remoteok_search"
]);

function buildAuthProbeScript() {
  return `
(() => {
  const bodyText = String(document.body?.innerText || "").replace(/\\s+/g, " ").trim();
  const snippet = bodyText.slice(0, 1600);
  return JSON.stringify({
    href: String(location.href || ""),
    host: String(location.host || ""),
    pathname: String(location.pathname || ""),
    title: String(document.title || ""),
    hasPasswordField: Boolean(document.querySelector('input[type="password"]')),
    textSnippet: snippet
  });
})()
`;
}

function buildFilterInputProbeScript() {
  return `
(() => {
  const normalize = (value) => typeof value === "string"
    ? value.replace(/\\s+/g, " ").trim()
    : "";

  const cssEscape = (value) => String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\"/g, "\\\"");

  const textFromIds = (value) => {
    const ids = String(value || "").trim();
    if (!ids) return "";
    return ids.split(/\\s+/)
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
    if (testId) return tag + "[data-testid='" + cssEscape(testId) + "']";
    const name = normalize(element.getAttribute("name"));
    if (name) return tag + "[name='" + cssEscape(name) + "']";
    const placeholder = normalize(element.getAttribute("placeholder"));
    if (placeholder) return tag + "[placeholder='" + cssEscape(placeholder) + "']";
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
`;
}

export function authProbeLooksUnauthorized(sourceType, probe) {
  const href = String(probe?.href || "").toLowerCase();
  const title = String(probe?.title || "").toLowerCase();
  const text = String(probe?.textSnippet || "").toLowerCase();
  const pathname = String(probe?.pathname || "").toLowerCase();
  const host = String(probe?.host || "").toLowerCase();
  const hasPasswordField = probe?.hasPasswordField === true;
  const source = String(sourceType || "").toLowerCase();

  let hostPattern = /(linkedin|indeed|ziprecruiter|wellfound|remoteok)\./;
  if (source === "linkedin_capture_file") {
    hostPattern = /linkedin\./;
  } else if (source === "yc_jobs") {
    hostPattern = /workatastartup\./;
  } else if (source === "indeed_search") {
    hostPattern = /indeed\./;
  } else if (source === "ziprecruiter_search") {
    hostPattern = /ziprecruiter\./;
  } else if (source === "wellfound_search") {
    hostPattern = /wellfound\./;
  } else if (source === "remoteok_search") {
    hostPattern = /remoteok\./;
  }

  const hasLoginPath =
    hostPattern.test(host) &&
    /(login|signin|sign-in|authwall|checkpoint|session|sign_in)/.test(pathname);
  const hasLoginInHref = /(login|signin|sign-in|authwall|checkpoint|session|sign_in)/.test(href);
  const likelyLoginTitle = /(sign in|log in|login)/.test(title);
  const likelyLoginText = /(sign in|log in|login|continue with)/.test(text);

  return hasLoginPath || hasLoginInHref || hasPasswordField || (likelyLoginTitle && likelyLoginText);
}

export function probeSourceAccessWithChromeAppleScript(source, options = {}) {
  if (!source || !AUTH_REQUIRED_SOURCE_TYPES.has(source.type)) {
    throw new Error(
      `Auth probe is supported only for auth-required browser sources. "${source?.name || "unknown"}" is ${source?.type || "unknown"}.`
    );
  }
  if (!source.searchUrl) {
    throw new Error("Auth probe requires a source with searchUrl.");
  }

  const settleMs = Number(options.settleMs) > 0 ? Number(options.settleMs) : 1500;
  const closeWindowAfterProbe = options?.closeWindowAfterProbe === true;
  try {
    navigateAutomationTab(source.searchUrl, `Checking access for ${source.name || "source"}...`);
    sleepSync(settleMs);

    const tabInfo = readAutomationTabInfo();
    let probe = {
      href: tabInfo.url,
      title: tabInfo.title,
      host: "",
      pathname: "",
      hasPasswordField: false,
      textSnippet: ""
    };

    try {
      const raw = executeInAutomationTab(buildAuthProbeScript());
      const parsed = JSON.parse(String(raw || "{}"));
      probe = {
        ...probe,
        ...(parsed && typeof parsed === "object" ? parsed : {})
      };
    } catch {
      // URL/title checks are sufficient for basic auth probe fallback.
    }

    const unauthorized = authProbeLooksUnauthorized(source.type, probe);
    return {
      status: unauthorized ? "unauthorized" : "authorized",
      reasonCode: unauthorized ? "auth_required" : "auth_ok",
      pageUrl: String(probe.href || tabInfo.url || source.searchUrl),
      pageTitle: String(probe.title || tabInfo.title || ""),
      provider: "chrome_applescript"
    };
  } finally {
    if (closeWindowAfterProbe) {
      closeAutomationWindow();
    }
  }
}

export function probeSourceFilterInputsWithChromeAppleScript(source, options = {}) {
  const sourceId = String(source?.id || "");
  const sourceType = String(source?.type || "");
  const searchUrl = String(source?.searchUrl || "");

  if (!searchUrl) {
    return {
      sourceId,
      sourceType,
      searchUrl,
      pageTitle: "",
      finalUrl: "",
      status: "error",
      errorMessage: "Filter input probe requires a source with searchUrl.",
      filters: []
    };
  }

  const settleMs = Number(options.settleMs) > 0 ? Number(options.settleMs) : 2500;
  const readyStateWaitMs =
    Number(options.readyStateWaitMs) > 0 ? Number(options.readyStateWaitMs) : 1500;
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 15_000;

  let windowId = null;
  let pageTitle = "";
  let finalUrl = "";
  let probeTempDir = "";
  let probeScriptPath = "";
  const keepProbeFiles = process.env.JF_KEEP_PROBE_FILES === "1";

  try {
    windowId = createChromeProbeWindow(searchUrl, timeoutMs);
    sleepSync(settleMs);

    {
      let readyState = "";
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          readyState = String(
            executeInChromeWindow(windowId, "document.readyState", timeoutMs) || ""
          ).trim();
        } catch {
          readyState = "";
        }
        if (readyState === "complete") {
          break;
        }
        sleepSync(readyStateWaitMs);
      }
    }

    let tabInfo = readChromeWindowTabInfo(windowId);
    if (!tabInfo.title || !tabInfo.url) {
      sleepSync(900);
      tabInfo = readChromeWindowTabInfo(windowId);
    }
    pageTitle = tabInfo.title || pageTitle;
    finalUrl = tabInfo.url || finalUrl;

    probeTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jf-filter-probe-"));
    probeScriptPath = path.join(probeTempDir, "probe.js");
    fs.writeFileSync(probeScriptPath, buildFilterInputProbeScript(), "utf8");
    let raw = executeInChromeWindowFromFile(windowId, probeScriptPath, timeoutMs);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (String(raw || "").trim() !== "missing value") {
        break;
      }
      sleepSync(1500);
      raw = executeInChromeWindowFromFile(windowId, probeScriptPath, timeoutMs);
    }
    const parsed = JSON.parse(String(raw || "{}"));
    const filters = Array.isArray(parsed?.filters) ? parsed.filters : [];

    return {
      sourceId,
      sourceType,
      searchUrl,
      pageTitle: String(parsed?.pageTitle || pageTitle || ""),
      finalUrl: String(parsed?.finalUrl || finalUrl || ""),
      status: "ok",
      errorMessage: null,
      filters
    };
  } catch (error) {
    const message = error?.message ? String(error.message) : String(error || "Probe failed.");
    return {
      sourceId,
      sourceType,
      searchUrl,
      pageTitle,
      finalUrl,
      status: "error",
      errorMessage: message,
      filters: []
    };
  } finally {
    if (Number.isInteger(windowId)) {
      closeChromeWindow(windowId);
    }
    if (probeScriptPath && !keepProbeFiles) {
      try {
        fs.rmSync(probeScriptPath, { force: true });
      } catch {
        // ignore cleanup errors
      }
    }
    if (probeTempDir && !keepProbeFiles) {
      try {
        fs.rmdirSync(probeTempDir, { recursive: true });
      } catch {
        // ignore cleanup errors
      }
    }
  }
}

function buildExtractionScript() {
  return `
(() => {
  const normalize = (value) => typeof value === "string"
    ? value.replace(/\\s+/g, " ").trim()
    : "";

  const unique = (items) => {
    const seen = new Set();
    return items.filter((item) => {
      const key = normalize(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const toAbsoluteUrl = (href) => {
    const value = normalize(href);
    if (!value) return "";
    try {
      return new URL(value, location.origin).toString();
    } catch {
      return value;
    }
  };

  const isSearchResultsUrl = (href) => {
    try {
      const parsed = new URL(String(href || ""), location.origin);
      return (
        parsed.host.toLowerCase() === "www.linkedin.com" &&
        (/^\\/jobs\\/search\\/?$/i.test(parsed.pathname) ||
          /^\\/jobs\\/search-results\\/?$/i.test(parsed.pathname))
      );
    } catch {
      return false;
    }
  };

  const extractLinkedInExternalId = (url) => {
    const raw = String(url || "");
    const match = raw.match(/\\/jobs\\/view\\/(\\d+)/i);
    if (match) {
      return match[1];
    }

    try {
      const parsed = new URL(raw, location.origin);
      const fromQuery =
        parsed.searchParams.get("currentJobId") ||
        parsed.searchParams.get("jobId") ||
        parsed.searchParams.get("trk");
      const numeric = String(fromQuery || "").match(/\\d{6,}/);
      return numeric ? numeric[0] : "";
    } catch {
      return "";
    }
  };

  const parseCardLines = (text) => {
    const lines = unique(
      String(text || "")
        .split(/\\n+/)
        .map((line) => normalize(line))
        .filter(Boolean)
    );

    const filtered = [];

    for (const line of lines) {
      if (
        !line ||
        line === "·" ||
        line === "Easy Apply" ||
        line === "Viewed" ||
        line === "Saved" ||
        line === "Applied" ||
        line === "Actively reviewing applicants" ||
        line === "Be an early applicant" ||
        /school alumni work here/i.test(line) ||
        /connection works here/i.test(line)
      ) {
        continue;
      }

      filtered.push(line);
    }

    return filtered;
  };

  const collapseRepeatedPhrase = (value) => {
    let current = normalize(value);
    if (!current) {
      return "";
    }

    let changed = true;
    while (changed) {
      changed = false;
      for (let index = 1; index <= Math.floor(current.length / 2); index += 1) {
        const left = current.slice(0, index).trim();
        const right = current.slice(index).trim();
        if (!left || !right) {
          continue;
        }
        if (right === left) {
          current = left;
          changed = true;
          break;
        }
      }
    }

    return current;
  };

  const sanitizeLinkedInTitle = (value, { company = "", location = "" } = {}) => {
    let sanitized = normalize(value)
      .replace(/\\s*\\(Verified job\\)\\s*/gi, " ")
      .replace(/\\s+with verification\\b/gi, " ")
      .replace(/\\b(?:easy apply|actively reviewing applicants|saved|viewed|applied)\\b/gi, " ")
      .replace(/\\b\\d+\\s+(?:school alumni works? here|school alumni work here|connections? works? here)\\b/gi, " ")
      .replace(/posted on .+$/i, " ")
      .replace(/benefits?.*$/i, " ")
      .replace(/medical,.*$/i, " ")
      .replace(/vision,.*$/i, " ")
      .replace(/dental,.*$/i, " ")
      .replace(/401\\(k\\).*$/i, " ");

    const companyText = normalize(company);
    if (companyText) {
      const companyIndex = sanitized.toLowerCase().indexOf(companyText.toLowerCase());
      if (companyIndex > 0) {
        sanitized = sanitized.slice(0, companyIndex);
      }
    }

    const locationText = normalize(location);
    if (locationText) {
      const locationIndex = sanitized.toLowerCase().indexOf(locationText.toLowerCase());
      if (locationIndex > 0) {
        sanitized = sanitized.slice(0, locationIndex);
      }
    }

    sanitized = collapseRepeatedPhrase(normalize(sanitized));
    sanitized = collapseRepeatedPhrase(normalize(sanitized.replace(/ · /g, " ")));
    return normalize(sanitized);
  };

  const normalizeTitle = (value, context = {}) => sanitizeLinkedInTitle(value, context);

  const parseLinkedInSalaryFloor = (value) => {
    const normalized = normalize(value);
    if (!normalized) {
      return null;
    }

    const match = normalized.match(/\\$\\s*([\\d,]+(?:\\.\\d+)?)([kKmM])?/);
    if (!match) {
      return null;
    }

    const amount = Number(String(match[1]).replace(/,/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) {
      return null;
    }

    const suffix = String(match[2] || "").toLowerCase();
    if (suffix === "m") {
      return amount * 1_000_000;
    }
    if (suffix === "k") {
      return amount * 1_000;
    }

    return amount;
  };

  const isPlausibleLinkedInSalaryText = (value) => {
    const normalized = normalize(value);
    if (!normalized) {
      return false;
    }
    const salaryFloor = parseLinkedInSalaryFloor(normalized);
    if (!Number.isFinite(salaryFloor)) {
      return false;
    }
    return salaryFloor >= 20_000 && salaryFloor <= 1_500_000;
  };

  const chooseLinkedInSalaryText = (cardSalaryText, detailSalaryText) => {
    const card = normalize(cardSalaryText);
    if (card) {
      return card;
    }
    const detail = normalize(detailSalaryText);
    return isPlausibleLinkedInSalaryText(detail) ? detail : null;
  };

  const buildSearchUrl = (title, company) => {
    const params = new URLSearchParams({
      keywords: [title, company].filter(Boolean).join(" ")
    });

    return "https://www.linkedin.com/jobs/search-results/?" + params.toString();
  };

  const parseExpectedCountFromText = (text) => {
    const normalized = normalize(text).toLowerCase();
    if (!normalized) {
      return null;
    }

    const match =
      normalized.match(/([\\d,]+)\\s+results?/) ||
      normalized.match(/showing\\s+([\\d,]+)\\s+result/);
    if (!match || !match[1]) {
      return null;
    }

    const parsed = Number(String(match[1]).replace(/,/g, ""));
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
  };

  const extractExpectedCount = () => {
    const selectors = [
      ".jobs-search-results-list__subtitle",
      ".jobs-search-results-list__subtitle span",
      ".scaffold-layout__list-header .t-black--light",
      ".jobs-search-results-list__text"
    ];

    let best = null;
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        const parsed = parseExpectedCountFromText(
          node?.innerText || node?.textContent || ""
        );
        if (Number.isFinite(parsed) && parsed > 0 && (best === null || parsed > best)) {
          best = parsed;
        }
      }
    }

    if (best !== null) {
      return best;
    }

    const pageText = normalize(document.body?.innerText || "").slice(0, 8000);
    return parseExpectedCountFromText(pageText);
  };

  const parseDetailHints = (text) => {
    const normalizedText = normalize(text);
    if (!normalizedText) {
      return {
        postedAt: "",
        salaryText: "",
        employmentType: "",
        location: ""
      };
    }

    const postedAt =
      normalizedText.match(
        /(\\d+\\s+(?:hour|day|week|month|year)s?\\s+ago|today|yesterday|just posted|posted(?:\\s+on)?\\s+[a-z]{3,9}\\s+\\d{1,2},?\\s+\\d{2,4})/i
      )?.[1] || "";
    const salaryText =
      normalizedText.match(
        /(?:[$€£]\\s*\\d[\\d,]*(?:\\.\\d+)?(?:[kKmM])?(?:\\s*[-–]\\s*[$€£]?\\s*\\d[\\d,]*(?:\\.\\d+)?(?:[kKmM])?)?|\\b\\d{2,3}\\s*[Kk]\\s*[-–]\\s*\\d{2,3}\\s*[Kk]\\b)(?:\\s*(?:annually|yearly|monthly|weekly|hourly|per\\s+(?:year|yr|hour|hr)|\\/(?:year|yr|hour|hr)))?/i
      )?.[0] || "";
    const employmentType =
      normalizedText.match(
        /\\b(full[- ]?time|part[- ]?time|contract|temporary|internship|freelance|apprenticeship)\\b/i
      )?.[1] || "";
    const location =
      normalizedText.match(
        /\\b(remote|hybrid|on-site|onsite|in-office|san francisco(?:,\\s*ca)?|new york(?:,\\s*ny)?|seattle(?:,\\s*wa)?|austin(?:,\\s*tx)?|los angeles(?:,\\s*ca)?|california|united states)\\b/i
      )?.[1] || "";

    return {
      postedAt: normalize(postedAt),
      salaryText: normalize(salaryText),
      employmentType: normalize(employmentType),
      location: normalize(location)
    };
  };

  const looksLikeLocation = (value) =>
    /(remote|hybrid|on-site|onsite|in-office|\\b[a-z]+,\\s*[a-z]{2}\\b|united states|bay area|california|new york|seattle|austin|los angeles)/i.test(
      normalize(value)
    );

  const spinWait = (ms) => {
    const start = Date.now();
    while (Date.now() - start < ms) {
      // synchronous poll wait
    }
  };

  const getRowId = (row) => {
    const direct = normalize(
      row?.getAttribute("data-occludable-job-id") ||
      row?.getAttribute("data-job-id") ||
      ""
    );
    const numeric = direct.match(/\\d{6,}/);
    return numeric ? numeric[0] : "";
  };

  const findResultRows = () => {
    const rows = new Map();
    for (const node of document.querySelectorAll("li[data-occludable-job-id], [data-occludable-job-id]")) {
      const row =
        node.closest("li[data-occludable-job-id]") ||
        node.closest("[data-occludable-job-id]") ||
        node;
      const rowId = getRowId(row);
      if (!row || !rowId || rows.has(rowId)) {
        continue;
      }
      rows.set(rowId, row);
    }
    return Array.from(rows.values());
  };

  const findResultRowById = (rowId) =>
    document.querySelector('li[data-occludable-job-id="' + rowId + '"], [data-occludable-job-id="' + rowId + '"]');

  const activateRow = (row) => {
    if (!row) {
      return;
    }

    const target =
      row.querySelector('[data-job-id] a[href*="/jobs/view/"]') ||
      row.querySelector('a[href*="currentJobId="]') ||
      row.querySelector('a[href*="/jobs/view/"]') ||
      row.querySelector('[role="button"]') ||
      row;

    if (!target || typeof target.dispatchEvent !== "function") {
      return;
    }

    const eventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window
    };

    try {
      target.dispatchEvent(new MouseEvent("mousedown", eventInit));
      target.dispatchEvent(new MouseEvent("mouseup", eventInit));
      target.dispatchEvent(new MouseEvent("click", eventInit));
    } catch {
      if (typeof target.click === "function") {
        target.click();
      }
    }
  };

  const readRowSnapshot = (row) => {
    const rowId = getRowId(row);
    const titleAnchor =
      row?.querySelector('a[href*="/jobs/view/"]') ||
      row?.querySelector('a[href*="currentJobId="]') ||
      row?.querySelector(".job-card-container__link") ||
      row?.querySelector("a[href]");
    const companyNode = row?.querySelector(
      '.artdeco-entity-lockup__subtitle span, .job-card-container__company-name, .artdeco-entity-lockup__subtitle, .base-search-card__subtitle a, .base-search-card__subtitle'
    );
    const locationNode = row?.querySelector(
      '.artdeco-entity-lockup__caption, .job-search-card__location, .base-search-card__metadata, .job-card-container__metadata-wrapper li'
    );

    const directUrl = toAbsoluteUrl(titleAnchor?.getAttribute("href") || "");
    const externalId =
      extractLinkedInExternalId(directUrl) ||
      rowId ||
      null;
    const domTitle = normalize(titleAnchor?.innerText || titleAnchor?.textContent || "");
    const domCompany = normalize(companyNode?.innerText || companyNode?.textContent || "");
    const domLocation = normalize(locationNode?.innerText || locationNode?.textContent || "");
    const cardText = normalize(row?.innerText || row?.textContent || "");
    const cardLines = parseCardLines(cardText);

    let title = sanitizeLinkedInTitle(domTitle || cardLines[0], {
      company: domCompany || cardLines[1] || "",
      location: domLocation || cardLines[2] || ""
    });
    let company = domCompany || normalize(cardLines[1]);
    let location = domLocation || normalize(cardLines[2] || "");

    if (company && normalizeTitle(company) === title) {
      company = normalize(cardLines[2] || "");
      location = location || normalize(cardLines[3] || "");
    }
    if (company && location && normalizeTitle(company) === title) {
      company = location;
      location = "";
    }
    if (location && !looksLikeLocation(location)) {
      location = "";
    }

    if (!title || !company) {
      return {
        status: "placeholder",
        rowId,
        externalId: externalId || rowId || "",
        directUrl
      };
    }

    const salaryPattern =
      /(?:[$€£]\\s*\\d[\\d,]*(?:\\.\\d+)?(?:[kKmM])?(?:\\s*[-–]\\s*[$€£]?\\s*\\d[\\d,]*(?:\\.\\d+)?(?:[kKmM])?)?|\\b\\d{2,3}\\s*[Kk]\\s*[-–]\\s*\\d{2,3}\\s*[Kk]\\b)(?:\\s*(?:annually|yearly|monthly|weekly|hourly|per\\s+(?:year|yr|hour|hr)|\\/(?:year|yr|hour|hr)))?/i;
    const salaryText = cardLines.find((line) => salaryPattern.test(line)) || null;
    const postedAt =
      normalize(
        row?.querySelector("time, .job-search-card__listdate, .job-search-card__listdate--new")?.innerText ||
        row?.querySelector("time, .job-search-card__listdate, .job-search-card__listdate--new")?.textContent ||
        ""
      ) ||
      cardLines.find((line) => /^Posted on /i.test(line)) ||
      cardLines.find((line) => /(?:hour|day|week|month|year)s? ago/i.test(line)) ||
      cardLines.find((line) => /\\b(today|yesterday|just posted|reposted)\\b/i.test(line)) ||
      "";
    const employmentHint = normalize(
      row?.querySelector('.job-card-container__metadata-item, [class*="job-insight"]')?.innerText ||
      row?.querySelector('.job-card-container__metadata-item, [class*="job-insight"]')?.textContent ||
      ""
    );
    const employmentType =
      (/\\b(full[- ]?time|part[- ]?time|contract|temporary|internship|freelance|apprenticeship)\\b/i.test(
        employmentHint
      )
        ? employmentHint
        : "") ||
      cardLines.find((line) =>
        /\\b(full[- ]?time|part[- ]?time|contract|temporary|internship|freelance|apprenticeship)\\b/i.test(
          line
        )
      ) ||
      "";

    return {
      status: "hydrated",
      rowId,
      externalId: externalId || rowId || "",
      directUrl,
      title,
      company,
      location,
      postedAt: postedAt ? postedAt.replace(/^Posted on /i, "").trim() : "",
      employmentType: normalize(employmentType),
      salaryText: normalize(salaryText || ""),
      easyApply: /easy apply/i.test(cardText),
      summaryText: normalize([title, company, location].filter(Boolean).join(" · ")).slice(0, 500),
      descriptionText: normalize(
        [title, company, location, postedAt, employmentType, salaryText]
          .filter(Boolean)
          .join(" · ")
      )
    };
  };

  const waitForHydratedRow = (rowId, attempts = 4, delayMs = 45) => {
    let lastSnapshot = {
      status: "placeholder",
      rowId,
      externalId: rowId
    };

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const row = findResultRowById(rowId);
      if (!row) {
        spinWait(delayMs);
        continue;
      }

      row.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
      spinWait(delayMs);

      if (attempt > 0) {
        activateRow(row);
        spinWait(delayMs);
      }

      const snapshot = readRowSnapshot(row);
      lastSnapshot = snapshot;
      if (snapshot.status === "hydrated") {
        return snapshot;
      }

      spinWait(delayMs);
    }

    return lastSnapshot;
  };

  const readDetailHints = (rowId, expectedExternalId) => {
    const searchHrefBeforeClick = String(location.href || "");
    const row = findResultRowById(rowId);
    const titleAnchor =
      row?.querySelector('a[href*="/jobs/view/"]') ||
      row?.querySelector('a[href*="currentJobId="]') ||
      row?.querySelector(".job-card-container__link") ||
      row?.querySelector("a[href]");
    const clickTarget = titleAnchor || row;
    if (clickTarget && typeof clickTarget.click === "function") {
      clickTarget.click();
    }

    const metadataSelectors = [
      ".jobs-unified-top-card__primary-description-container",
      ".jobs-unified-top-card__job-insight-view-model-secondary",
      ".jobs-search__job-details--wrapper",
      ".jobs-search__job-details",
      ".scaffold-layout__detail"
    ];
    const titleSelectors = [
      ".job-details-jobs-unified-top-card__job-title",
      ".jobs-unified-top-card__job-title",
      ".t-24.job-details-jobs-unified-top-card__job-title",
      ".t-24.t-bold.inline"
    ];
    const companySelectors = [
      ".job-details-jobs-unified-top-card__company-name",
      ".jobs-unified-top-card__company-name",
      ".job-details-jobs-unified-top-card__primary-description a",
      ".jobs-unified-top-card__primary-description a"
    ];
    const locationSelectors = [
      ".job-details-jobs-unified-top-card__primary-description-container",
      ".jobs-unified-top-card__primary-description-container",
      ".job-details-jobs-unified-top-card__primary-description",
      ".jobs-unified-top-card__primary-description"
    ];
    const descriptionSelectors = [
      ".jobs-box__html-content",
      ".jobs-description-content__text"
    ];

    let bestMetadataText = "";
    let bestDescriptionText = "";
    let bestTitleText = "";
    let bestCompanyText = "";
    let bestLocationText = "";
    let resolvedExternalId = extractLinkedInExternalId(location.href);
    let detailHref = "";
    const startedAt = Date.now();
    while (Date.now() - startedAt < 350) {
      if (!isSearchResultsUrl(location.href)) {
        try {
          history.back();
        } catch {
          // no-op
        }

        const recoverStartedAt = Date.now();
        while (Date.now() - recoverStartedAt < 600) {
          if (isSearchResultsUrl(location.href)) {
            break;
          }
          spinWait(35);
        }

        if (!isSearchResultsUrl(location.href)) {
          return {
            ...parseDetailHints(""),
            externalId: extractLinkedInExternalId(searchHrefBeforeClick),
            descriptionText: "",
            mismatched: false
          };
        }
      }

      for (const selector of metadataSelectors) {
        const node = document.querySelector(selector);
        const text = normalize(node?.innerText || node?.textContent || "");
        if (text.length > bestMetadataText.length) {
          bestMetadataText = text;
        }
      }
      for (const selector of descriptionSelectors) {
        const node = document.querySelector(selector);
        const text = normalize(node?.innerText || node?.textContent || "");
        if (text.length > bestDescriptionText.length) {
          bestDescriptionText = text;
        }
      }
      for (const selector of titleSelectors) {
        const node = document.querySelector(selector);
        const text = normalize(node?.innerText || node?.textContent || "");
        if (text.length > bestTitleText.length) {
          bestTitleText = text;
        }
      }
      for (const selector of companySelectors) {
        const node = document.querySelector(selector);
        const text = normalize(node?.innerText || node?.textContent || "");
        if (text.length > bestCompanyText.length) {
          bestCompanyText = text;
        }
      }
      for (const selector of locationSelectors) {
        const node = document.querySelector(selector);
        const text = normalize(node?.innerText || node?.textContent || "");
        if (text.length > bestLocationText.length) {
          bestLocationText = text;
        }
      }
      const hrefNode = document.querySelector(
        '.jobs-search__job-details a[href*="/jobs/view/"], .jobs-search__job-details a[href*="currentJobId="], .scaffold-layout__detail a[href*="/jobs/view/"], .scaffold-layout__detail a[href*="currentJobId="]'
      );
      const hrefValue = toAbsoluteUrl(hrefNode?.getAttribute("href") || "");
      if (hrefValue && hrefValue.length > detailHref.length) {
        detailHref = hrefValue;
      }
      const hintedExternalId = extractLinkedInExternalId(
        hrefValue || location.href
      );
      if (hintedExternalId) {
        resolvedExternalId = hintedExternalId;
      }

      const detailIdMatchesExpectation =
        !expectedExternalId ||
        (resolvedExternalId && resolvedExternalId === expectedExternalId);
      const combinedText = [bestMetadataText, bestDescriptionText]
        .filter(Boolean)
        .join(" ");
      const hints = parseDetailHints(combinedText);
      const hasUsableDetailHints =
        detailIdMatchesExpectation &&
        (
          bestDescriptionText.length >= 160 ||
          hints.postedAt ||
          hints.salaryText ||
          hints.employmentType ||
          hints.location
        );
      if (hasUsableDetailHints) {
        return {
          ...hints,
          externalId: resolvedExternalId,
          title: bestTitleText,
          company: bestCompanyText,
          locationText: bestLocationText,
          directUrl: detailHref,
          descriptionText: bestDescriptionText,
          mismatched: false
        };
      }

      spinWait(35);
    }

    const detailIdMatchesExpectation =
      !expectedExternalId ||
      (resolvedExternalId && resolvedExternalId === expectedExternalId);
    if (!detailIdMatchesExpectation) {
      return {
        ...parseDetailHints(""),
        externalId: expectedExternalId || "",
        title: "",
        company: "",
        locationText: "",
        directUrl: "",
        descriptionText: "",
        mismatched: true
      };
    }

    return {
      ...parseDetailHints([bestMetadataText, bestDescriptionText].filter(Boolean).join(" ")),
      externalId: resolvedExternalId,
      title: bestTitleText,
      company: bestCompanyText,
      locationText: bestLocationText,
      directUrl: detailHref,
      descriptionText: bestDescriptionText,
      mismatched: false
    };
  };

  const rowSnapshots = [];
  const snapshotIndexByRowId = new Map();
  const unresolvedRowIds = [];
  const upsertSnapshot = (snapshot) => {
    const key = normalize(snapshot?.rowId || snapshot?.externalId || "");
    if (!key) {
      rowSnapshots.push(snapshot);
      return;
    }
    const existingIndex = snapshotIndexByRowId.get(key);
    if (existingIndex !== undefined) {
      rowSnapshots[existingIndex] = snapshot;
      return;
    }
    snapshotIndexByRowId.set(key, rowSnapshots.length);
    rowSnapshots.push(snapshot);
  };
  const resultRows = findResultRows();
  const seenRowIds = new Set();
  // MVP capture is summary-card-first. Avoid detail-pane reads here because
  // they materially slow down LinkedIn capture and are not required for import.
  let detailReadBudget = 0;
  for (const row of resultRows) {
    const rowId = getRowId(row);
    if (!rowId || seenRowIds.has(rowId)) {
      continue;
    }
    seenRowIds.add(rowId);

    const snapshot = waitForHydratedRow(rowId);
    if (snapshot.status !== "hydrated") {
      const detailHints = readDetailHints(rowId, snapshot.externalId);
      const detailMatches = !detailHints.mismatched &&
        detailHints.externalId &&
        detailHints.externalId === snapshot.externalId;
      const recoveredTitle = sanitizeLinkedInTitle(detailHints.title || "", {
        company: detailHints.company || "",
        location: detailHints.location || detailHints.locationText || ""
      });
      const recoveredCompany = normalize(detailHints.company || "");
      const recoveredLocation = normalize(detailHints.location || detailHints.locationText || "");
      if (detailMatches && recoveredTitle && recoveredCompany) {
        upsertSnapshot({
          status: "hydrated",
          rowId,
          externalId: snapshot.externalId || rowId || "",
          directUrl: detailHints.directUrl || snapshot.directUrl || "",
          title: recoveredTitle,
          company: recoveredCompany,
          location: recoveredLocation,
          postedAt: detailHints.postedAt || "",
          employmentType: detailHints.employmentType || "",
          salaryText: detailHints.salaryText || "",
          easyApply: /easy apply/i.test(detailHints.descriptionText || ""),
          summaryText: normalize([recoveredTitle, recoveredCompany, recoveredLocation].filter(Boolean).join(" · ")).slice(0, 500),
          descriptionText: normalize(
            [recoveredTitle, recoveredCompany, recoveredLocation, detailHints.postedAt, detailHints.employmentType, detailHints.salaryText]
              .filter(Boolean)
              .join(" · ")
          ),
          detailExternalId: detailHints.externalId || "",
          detailPostedAt: detailHints.postedAt || "",
          detailSalaryText: detailHints.salaryText || "",
          detailEmploymentType: detailHints.employmentType || "",
          detailLocation: detailHints.location || detailHints.locationText || "",
          detailDescription: detailHints.descriptionText || "",
          detailMismatched: false
        });
        continue;
      }
      upsertSnapshot(snapshot);
      unresolvedRowIds.push(rowId);
      continue;
    }

    let detailHints = {
      ...parseDetailHints(""),
      externalId: "",
      descriptionText: "",
      mismatched: false
    };
    if (
      detailReadBudget > 0 &&
      (!snapshot.postedAt || !snapshot.salaryText || !snapshot.employmentType || !snapshot.location)
    ) {
      detailHints = readDetailHints(rowId, snapshot.externalId);
      detailReadBudget -= 1;
    }

    upsertSnapshot({
      ...snapshot,
      detailExternalId: detailHints.externalId || "",
      detailPostedAt: detailHints.postedAt || "",
      detailSalaryText: detailHints.salaryText || "",
      detailEmploymentType: detailHints.employmentType || "",
      detailLocation: detailHints.location || "",
      detailDescription: detailHints.descriptionText || "",
      detailMismatched: detailHints.mismatched === true
    });
  }

  for (const rowId of unresolvedRowIds) {
    const existingIndex = snapshotIndexByRowId.get(rowId);
    if (existingIndex === undefined) {
      continue;
    }
    const existingSnapshot = rowSnapshots[existingIndex];
    if (existingSnapshot?.status === "hydrated") {
      continue;
    }

    const retriedSnapshot = waitForHydratedRow(rowId, 3, 90);
    if (retriedSnapshot.status === "hydrated") {
      upsertSnapshot({
        ...retriedSnapshot,
        detailExternalId: "",
        detailPostedAt: "",
        detailSalaryText: "",
        detailEmploymentType: "",
        detailLocation: "",
        detailDescription: "",
        detailMismatched: false
      });
      continue;
    }

    const detailHints = readDetailHints(rowId, retriedSnapshot.externalId);
    const detailMatches = !detailHints.mismatched &&
      detailHints.externalId &&
      detailHints.externalId === retriedSnapshot.externalId;
    const recoveredTitle = sanitizeLinkedInTitle(detailHints.title || "", {
      company: detailHints.company || "",
      location: detailHints.location || detailHints.locationText || ""
    });
    const recoveredCompany = normalize(detailHints.company || "");
    const recoveredLocation = normalize(detailHints.location || detailHints.locationText || "");
    if (detailMatches && recoveredTitle && recoveredCompany) {
      upsertSnapshot({
        status: "hydrated",
        rowId,
        externalId: retriedSnapshot.externalId || rowId || "",
        directUrl: detailHints.directUrl || retriedSnapshot.directUrl || "",
        title: recoveredTitle,
        company: recoveredCompany,
        location: recoveredLocation,
        postedAt: detailHints.postedAt || "",
        employmentType: detailHints.employmentType || "",
        salaryText: detailHints.salaryText || "",
        easyApply: /easy apply/i.test(detailHints.descriptionText || ""),
        summaryText: normalize([recoveredTitle, recoveredCompany, recoveredLocation].filter(Boolean).join(" · ")).slice(0, 500),
        descriptionText: normalize(
          [recoveredTitle, recoveredCompany, recoveredLocation, detailHints.postedAt, detailHints.employmentType, detailHints.salaryText]
            .filter(Boolean)
            .join(" · ")
        ),
        detailExternalId: detailHints.externalId || "",
        detailPostedAt: detailHints.postedAt || "",
        detailSalaryText: detailHints.salaryText || "",
        detailEmploymentType: detailHints.employmentType || "",
        detailLocation: detailHints.location || detailHints.locationText || "",
        detailDescription: detailHints.descriptionText || "",
        detailMismatched: false
      });
    }
  }

  return JSON.stringify({
    pageUrl: location.href,
    capturedAt: new Date().toISOString(),
    expectedCount: extractExpectedCount(),
    rowSnapshots,
    stopReason: rowSnapshots.length === 0 ? "no_result_rows" : "completed_row_traversal"
  });
})()
  `.trim();
}

function normalizeLinkedInSnapshotValue(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function isLinkedInHydratedRowSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return false;
  }

  if (String(snapshot.status || "").trim().toLowerCase() === "placeholder") {
    return false;
  }

  const title = normalizeLinkedInSnapshotValue(snapshot.title);
  const company = normalizeLinkedInSnapshotValue(snapshot.company);
  return Boolean(title && company);
}

function buildLinkedInSummaryText(title, company, location) {
  return normalizeLinkedInSnapshotValue([title, company, location].filter(Boolean).join(" · "));
}

function buildLinkedInDescriptionText(snapshot, detailAllowed) {
  const detailDescription = detailAllowed
    ? normalizeLinkedInSnapshotValue(snapshot.detailDescription)
    : "";
  if (detailDescription) {
    return detailDescription;
  }

  return normalizeLinkedInSnapshotValue(
    [
      snapshot.title,
      snapshot.company,
      snapshot.location,
      snapshot.postedAt,
      snapshot.employmentType,
      snapshot.salaryText
    ]
      .filter(Boolean)
      .join(" · ")
  );
}

export function finalizeLinkedInCapturePayload(payload = {}) {
  const rowSnapshots = Array.isArray(payload?.rowSnapshots) ? payload.rowSnapshots : [];
  const jobs = [];
  const missedPlaceholderJobIds = [];
  let detailMismatchCount = 0;

  for (const rawSnapshot of rowSnapshots) {
    if (!rawSnapshot || typeof rawSnapshot !== "object") {
      continue;
    }

    const externalId = normalizeLinkedInSnapshotValue(
      rawSnapshot.externalId || rawSnapshot.rowId
    );
    if (!isLinkedInHydratedRowSnapshot(rawSnapshot)) {
      if (externalId) {
        missedPlaceholderJobIds.push(externalId);
      }
      continue;
    }

    const detailExternalId = normalizeLinkedInSnapshotValue(rawSnapshot.detailExternalId);
    const detailMatches = doesLinkedInDetailIdMatch(externalId, detailExternalId);
    if (detailExternalId && !detailMatches) {
      detailMismatchCount += 1;
    }

    const title = normalizeLinkedInSnapshotValue(rawSnapshot.title);
    const company = normalizeLinkedInSnapshotValue(rawSnapshot.company);
    const location = normalizeLinkedInSnapshotValue(
      rawSnapshot.location || (detailMatches ? rawSnapshot.detailLocation : "")
    );
    const salaryText = normalizeLinkedInSnapshotValue(
      rawSnapshot.salaryText || (detailMatches ? rawSnapshot.detailSalaryText : "")
    );
    const postedAt = normalizeLinkedInSnapshotValue(
      rawSnapshot.postedAt || (detailMatches ? rawSnapshot.detailPostedAt : "")
    );
    const employmentType = normalizeLinkedInSnapshotValue(
      rawSnapshot.employmentType || (detailMatches ? rawSnapshot.detailEmploymentType : "")
    );
    const url =
      normalizeLinkedInSnapshotValue(rawSnapshot.directUrl) ||
      (externalId ? `https://www.linkedin.com/jobs/view/${externalId}/` : "");

    const summary = buildLinkedInSummaryText(title, company, location);
    const description = buildLinkedInDescriptionText(rawSnapshot, detailMatches);

    const sanitized = sanitizeLinkedInJob(
      {
        sourceId: "linkedin-live-capture",
        source: "linkedin_capture_file",
        externalId: externalId || null,
        detailExternalId: detailExternalId || null,
        title,
        company,
        location: location || null,
        postedAt: postedAt || null,
        employmentType: employmentType || null,
        easyApply: rawSnapshot.easyApply === true,
        salaryText: salaryText || null,
        summary,
        description: description || summary,
        detailDescription: detailMatches
          ? normalizeLinkedInSnapshotValue(rawSnapshot.detailDescription) || null
          : null,
        url
      },
      {
        sourceType: "linkedin_capture_file",
        sourceId: "linkedin-live-capture"
      }
    );

    jobs.push(sanitized);
  }

  const dedupedJobs = dedupeJobsByIdentity(jobs);
  const capturedJobIds = dedupedJobs
    .map((job) => normalizeLinkedInSnapshotValue(job.externalId))
    .filter(Boolean);

  return {
    pageUrl: payload?.pageUrl || null,
    capturedAt: payload?.capturedAt || new Date().toISOString(),
    jobs: dedupedJobs,
    expectedCount:
      Number.isFinite(Number(payload?.expectedCount)) && Number(payload.expectedCount) > 0
        ? Math.round(Number(payload.expectedCount))
        : null,
    captureDiagnostics: {
      advertisedCount:
        Number.isFinite(Number(payload?.expectedCount)) && Number(payload.expectedCount) > 0
          ? Math.round(Number(payload.expectedCount))
          : null,
      capturedCount: dedupedJobs.length,
      capturedJobIds,
      missedPlaceholderCount: missedPlaceholderJobIds.length,
      missedPlaceholderJobIds,
      detailMismatchCount,
      pageCountVisited:
        Number.isFinite(Number(payload?.pageCountVisited)) && Number(payload.pageCountVisited) > 0
          ? Math.round(Number(payload.pageCountVisited))
          : 1,
      stopReason: normalizeLinkedInSnapshotValue(payload?.stopReason) || "completed_row_traversal"
    }
  };
}

function buildLinkedInScrollStepScript() {
  return `
(() => {
  const normalize = (value) => typeof value === "string"
    ? value.replace(/\\s+/g, " ").trim()
    : "";

  const dismissButtons = Array.from(
    document.querySelectorAll('[aria-label^="Dismiss "][aria-label$=" job"]')
  );
  const lastButton = dismissButtons.length
    ? dismissButtons[dismissButtons.length - 1]
    : null;

  const findScrollableAncestor = (node) => {
    let current = node?.parentElement || null;
    while (current) {
      const style = window.getComputedStyle(current);
      const overflowY = String(style?.overflowY || "").toLowerCase();
      const isScrollable = /auto|scroll|overlay/.test(overflowY);
      if (
        isScrollable &&
        Number(current.scrollHeight || 0) > Number(current.clientHeight || 0) + 20
      ) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  };

  const buttons = Array.from(document.querySelectorAll("button"));
  const loadMore = buttons.find((button) => {
    const label = normalize(
      button?.innerText ||
      button?.textContent ||
      button?.getAttribute("aria-label") ||
      ""
    ).toLowerCase();

    if (!label) {
      return false;
    }

    if (!/see more jobs|show more jobs|load more/i.test(label)) {
      return false;
    }

    return !button.disabled;
  });

  if (loadMore) {
    loadMore.click();
  }

  if (lastButton) {
    lastButton.scrollIntoView({ behavior: "auto", block: "end", inline: "nearest" });
  }

  const container = findScrollableAncestor(lastButton);
  if (container) {
    const increment = Math.max(700, Math.round((container.clientHeight || 0) * 0.9));
    container.scrollTop = Math.min(
      Number(container.scrollTop || 0) + increment,
      Number(container.scrollHeight || 0)
    );

    return JSON.stringify({
      target: "container",
      scrollTop: Number(container.scrollTop || 0),
      scrollHeight: Number(container.scrollHeight || 0),
      clientHeight: Number(container.clientHeight || 0),
      cardsVisible: dismissButtons.length,
      clickedLoadMore: Boolean(loadMore)
    });
  }

  const increment = Math.max(700, Math.round(window.innerHeight * 0.9));
  window.scrollTo(0, Math.min(window.scrollY + increment, document.body.scrollHeight));

  return JSON.stringify({
    target: "window",
    scrollTop: Number(window.scrollY || 0),
    scrollHeight: Number(document.body.scrollHeight || 0),
    viewportHeight: Number(window.innerHeight || 0),
    cardsVisible: dismissButtons.length,
    clickedLoadMore: Boolean(loadMore)
  });
})()
  `.trim();
}

function harvestLinkedInPageJobs({
  extractionScript,
  scrollScript,
  maxScrollSteps,
  maxIdleScrollSteps,
  scrollDelayMs,
  maxAttempts,
  attemptDelayMs,
  timeoutMs
}) {
  const collectedSnapshots = [];
  const seenSnapshotIds = new Set();
  let lastPayload = runExtractionAttempts(
    extractionScript,
    maxAttempts,
    attemptDelayMs,
    timeoutMs
  );
  let expectedCount = null;
  let sawValidPayload = Boolean(lastPayload && Array.isArray(lastPayload.rowSnapshots));
  let stopReason =
    typeof lastPayload?.stopReason === "string" && lastPayload.stopReason.trim()
      ? lastPayload.stopReason.trim()
      : "";

  if (Array.isArray(lastPayload?.rowSnapshots) && lastPayload.rowSnapshots.length > 0) {
    for (const snapshot of lastPayload.rowSnapshots) {
      const snapshotId = normalizeLinkedInSnapshotValue(
        snapshot?.externalId || snapshot?.rowId
      );
      const uniqueKey = snapshotId || `${collectedSnapshots.length}`;
      if (seenSnapshotIds.has(uniqueKey)) {
        continue;
      }
      seenSnapshotIds.add(uniqueKey);
      collectedSnapshots.push(snapshot);
    }
  }
  if (Number.isFinite(Number(lastPayload?.expectedCount))) {
    const parsed = Math.round(Number(lastPayload.expectedCount));
    if (parsed > 0) {
      expectedCount = parsed;
    }
  }

  let lastCollectedCount = collectedSnapshots.length;
  let idleSteps = 0;

  if (collectedSnapshots.length > 0 || sawValidPayload) {
    return {
      pageUrl: lastPayload?.pageUrl || null,
      capturedAt: new Date().toISOString(),
      rowSnapshots: collectedSnapshots,
      expectedCount,
      sawValidPayload,
      stopReason: stopReason || "completed_row_traversal"
    };
  }

  for (let step = 0; step < maxScrollSteps; step += 1) {
    const scrollRaw = executeInAutomationTab(scrollScript, timeoutMs);
    const scrollPayload = parseBridgeJsonPayload(scrollRaw);
    sleepSync(scrollDelayMs);

    const payload = runExtractionAttempts(
      extractionScript,
      maxAttempts,
      attemptDelayMs,
      timeoutMs
    );
    if (payload) {
      lastPayload = payload;
      sawValidPayload = true;
      if (typeof payload?.stopReason === "string" && payload.stopReason.trim()) {
        stopReason = payload.stopReason.trim();
      }
    }

    if (Array.isArray(payload?.rowSnapshots) && payload.rowSnapshots.length > 0) {
      for (const snapshot of payload.rowSnapshots) {
        const snapshotId = normalizeLinkedInSnapshotValue(
          snapshot?.externalId || snapshot?.rowId
        );
        const uniqueKey = snapshotId || `${collectedSnapshots.length}`;
        if (seenSnapshotIds.has(uniqueKey)) {
          continue;
        }
        seenSnapshotIds.add(uniqueKey);
        collectedSnapshots.push(snapshot);
      }
    }
    if (Number.isFinite(Number(payload?.expectedCount))) {
      const parsed = Math.round(Number(payload.expectedCount));
      if (parsed > 0 && (expectedCount === null || parsed > expectedCount)) {
        expectedCount = parsed;
      }
    }

    const snapshotCount = collectedSnapshots.length;
    if (snapshotCount > lastCollectedCount) {
      lastCollectedCount = snapshotCount;
      idleSteps = 0;
    } else {
      idleSteps += 1;
    }

    if (
      idleSteps >= maxIdleScrollSteps &&
      hasReachedLinkedInScrollExtent(scrollPayload)
    ) {
      break;
    }
  }

  return {
    pageUrl: lastPayload?.pageUrl || null,
    capturedAt: new Date().toISOString(),
    rowSnapshots: collectedSnapshots,
    expectedCount,
    sawValidPayload,
    stopReason: stopReason || "exhausted_scroll_steps"
  };
}

export function buildLinkedInPageUrl(searchUrl, pageIndex = 0) {
  const normalizedPageIndex =
    Number.isInteger(pageIndex) && pageIndex > 0 ? pageIndex : 0;
  const startOffset = normalizedPageIndex * 25;
  return buildUrlWithSearchParam(searchUrl, "start", String(startOffset));
}

function normalizeLinkedInIdValue(value) {
  return String(value || "").trim();
}

export function shouldFetchLinkedInPage(expectedCount, pageIndex = 0) {
  const normalizedPageIndex =
    Number.isInteger(pageIndex) && pageIndex > 0 ? pageIndex : 0;
  if (normalizedPageIndex === 0) {
    return true;
  }

  const parsedExpected = Number(expectedCount);
  if (!Number.isFinite(parsedExpected) || parsedExpected <= 0) {
    return true;
  }

  return normalizedPageIndex * 25 < parsedExpected;
}

export function shouldContinueLinkedInPagination(lastPageRowCount) {
  const parsedCount = Number(lastPageRowCount);
  if (!Number.isFinite(parsedCount) || parsedCount <= 0) {
    return false;
  }

  return parsedCount >= 25;
}

export function hasReachedLinkedInScrollExtent(scrollPayload, thresholdPx = 40) {
  const top = Number(scrollPayload?.scrollTop);
  const height = Number(scrollPayload?.scrollHeight);
  const viewport = Number(
    scrollPayload?.clientHeight ?? scrollPayload?.viewportHeight ?? 0
  );
  if (
    !Number.isFinite(top) ||
    !Number.isFinite(height) ||
    !Number.isFinite(viewport) ||
    height <= 0 ||
    viewport <= 0
  ) {
    return false;
  }

  return top + viewport >= height - Math.max(0, Number(thresholdPx) || 0);
}

export function doesLinkedInDetailIdMatch(expectedExternalId, resolvedExternalId) {
  const expected = normalizeLinkedInIdValue(expectedExternalId);
  if (!expected) {
    return true;
  }

  const resolved = normalizeLinkedInIdValue(resolvedExternalId);
  return Boolean(resolved) && resolved === expected;
}

export function isLinkedInSearchResultsUrl(url) {
  try {
    const parsed = new URL(String(url || ""), "https://www.linkedin.com");
    return (
      parsed.host.toLowerCase() === "www.linkedin.com" &&
      (/^\/jobs\/search\/?$/i.test(parsed.pathname) ||
        /^\/jobs\/search-results\/?$/i.test(parsed.pathname))
    );
  } catch {
    return false;
  }
}

export function pickLinkedInJobCardsResourceUrl(resourceNames = [], startOffset = 0) {
  const expectedStart = Math.max(0, Number(startOffset) || 0);
  const normalizedNames = Array.isArray(resourceNames) ? resourceNames : [];
  const exactMatch = normalizedNames.find((name) => {
    const value = String(name || "");
    return (
      /voyagerJobsDashJobCards/i.test(value) &&
      new RegExp(`(?:\\?|&)start=${expectedStart}(?:&|$)`).test(value)
    );
  });
  if (exactMatch) {
    return exactMatch;
  }
  return normalizedNames.find((name) => /voyagerJobsDashJobCards/i.test(String(name || ""))) || null;
}

function buildLinkedInJobCardsDiscoveryScript() {
  return `
(() => {
  const resourceNames = performance
    .getEntriesByType("resource")
    .map((entry) => String(entry?.name || ""))
    .filter((name) => /voyagerJobsDashJobCards/i.test(name));
  return JSON.stringify({
    href: String(location.href || ""),
    title: String(document.title || ""),
    resourceNames: Array.from(new Set(resourceNames))
  });
})()
`;
}

function buildLinkedInJobCardsFetchScript(resourceUrl) {
  return `
(() => {
  const url = ${JSON.stringify(resourceUrl)};
  const csrfFromCookie = (() => {
    const match = document.cookie.match(/(?:^|;\\s*)JSESSIONID="?([^"]+)"?/);
    return match ? match[1] : "";
  })();
  const csrfFromMeta =
    document.querySelector('meta[name="csrf-token"]')?.getAttribute("content") || "";
  const csrfToken = csrfFromMeta || csrfFromCookie;
  const request = new XMLHttpRequest();
  request.open("GET", url, false);
  request.withCredentials = true;
  if (csrfToken) {
    request.setRequestHeader("csrf-token", csrfToken);
  }
  request.setRequestHeader("x-restli-protocol-version", "2.0.0");
  request.send();
  return JSON.stringify({
    ok: request.status >= 200 && request.status < 300,
    status: request.status,
    url,
    csrfTokenPresent: Boolean(csrfToken),
    text: String(request.responseText || "")
  });
})()
`;
}

function buildLinkedInRowSnapshotsFromStructuredJobs(jobs = []) {
  return (Array.isArray(jobs) ? jobs : []).map((job) => ({
    status: "hydrated",
    rowId: String(job?.externalId || "").trim(),
    externalId: String(job?.externalId || "").trim(),
    directUrl: String(job?.url || "").trim(),
    title: String(job?.title || "").trim(),
    company: String(job?.company || "").trim(),
    location: String(job?.location || "").trim(),
    postedAt: String(job?.postedAt || "").trim(),
    employmentType: String(job?.employmentType || "").trim(),
    salaryText: String(job?.salaryText || "").trim(),
    summaryText: String(job?.summary || "").trim(),
    descriptionText: String(job?.summary || "").trim()
  }));
}

function readLinkedInResourcePage({ pageUrl, startOffset = 0, timeoutMs = 60_000, maxAttempts = 5, attemptDelayMs = 1200 }) {
  const discoveryScript = buildLinkedInJobCardsDiscoveryScript();
  let lastSnapshot = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const snapshot = JSON.parse(executeInAutomationTab(discoveryScript, timeoutMs) || "{}");
    lastSnapshot = snapshot;
    if (!isLinkedInSearchResultsUrl(snapshot?.href || pageUrl)) {
      sleepSync(attemptDelayMs);
      continue;
    }
    const resourceUrl = pickLinkedInJobCardsResourceUrl(snapshot?.resourceNames, startOffset);
    if (!resourceUrl) {
      sleepSync(attemptDelayMs);
      continue;
    }

    const response = JSON.parse(
      executeInAutomationTab(buildLinkedInJobCardsFetchScript(resourceUrl), timeoutMs) || "{}"
    );
    if (response?.ok !== true || !response?.text) {
      sleepSync(attemptDelayMs);
      continue;
    }

    const parsedPage = extractLinkedInStructuredPageFromResponseBody(response.text);
    if (parsedPage.jobs.length === 0) {
      sleepSync(attemptDelayMs);
      continue;
    }

    return {
      pageUrl: snapshot?.href || pageUrl,
      expectedCount: parsedPage.paging.total,
      rowSnapshots: buildLinkedInRowSnapshotsFromStructuredJobs(parsedPage.jobs),
      pageRowCount: parsedPage.jobs.length,
      stopReason: parsedPage.jobs.length < 25 ? "resource_short_page" : "resource_page",
      sawValidPayload: true,
      captureDiagnostics: {
        resourceUrl,
        resourceStart: parsedPage.paging.start,
        resourceCount: parsedPage.paging.count,
        resourceTotal: parsedPage.paging.total,
        resourceMode: "voyagerJobsDashJobCards"
      }
    };
  }

  return {
    pageUrl,
    expectedCount: null,
    rowSnapshots: [],
    pageRowCount: 0,
    stopReason: "resource_unavailable",
    sawValidPayload: isLinkedInSearchResultsUrl(lastSnapshot?.href || pageUrl),
    captureDiagnostics: {
      resourceUrl: null,
      resourceMode: "voyagerJobsDashJobCards"
    }
  };
}

function readLinkedInJobsFromChrome(searchUrl, options = {}) {
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 60_000;
  const settleMs = Number(options.settleMs) > 0 ? Number(options.settleMs) : 6000;
  const maxAttempts = Number(options.maxAttempts) > 0 ? Number(options.maxAttempts) : 10;
  const attemptDelayMs =
    Number(options.attemptDelayMs) > 0 ? Number(options.attemptDelayMs) : 1500;
  const maxPages = Number(options.maxPages) > 0 ? Number(options.maxPages) : 4;
  const maxScrollSteps = Number(options.maxScrollSteps) > 0
    ? Number(options.maxScrollSteps)
    : 18;
  const maxIdleScrollSteps = Number(options.maxIdleScrollSteps) > 0
    ? Number(options.maxIdleScrollSteps)
    : 5;
  const scrollDelayMs = Number(options.scrollDelayMs) > 0
    ? Number(options.scrollDelayMs)
    : 1200;
  const extractionScript = buildExtractionScript();
  const scrollScript = buildLinkedInScrollStepScript();

  const collectedSnapshots = [];
  const seenSnapshotIds = new Set();
  let sawValidPayload = false;
  let expectedCount = null;
  let lastPageRowCount = null;
  let pageCountVisited = 0;
  let stopReason = "";

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    if (!shouldFetchLinkedInPage(expectedCount, pageIndex)) {
      stopReason = "expected_count_limit";
      break;
    }
    if (pageIndex > 1 && !shouldContinueLinkedInPagination(lastPageRowCount)) {
      stopReason = "short_page";
      break;
    }

    const pageUrl = buildLinkedInPageUrl(searchUrl, pageIndex);
    navigateAutomationTab(pageUrl, "Refreshing LinkedIn source...", timeoutMs);
    sleepSync(settleMs);
    pageCountVisited += 1;

    let pagePayload = readLinkedInResourcePage({
      pageUrl,
      startOffset: pageIndex * 25,
      timeoutMs,
      maxAttempts,
      attemptDelayMs
    });
    if (!Array.isArray(pagePayload?.rowSnapshots) || pagePayload.rowSnapshots.length === 0) {
      pagePayload = harvestLinkedInPageJobs({
        extractionScript,
        scrollScript,
        maxScrollSteps,
        maxIdleScrollSteps,
        scrollDelayMs,
        maxAttempts,
        attemptDelayMs,
        timeoutMs
      });
    }

    if (pagePayload?.sawValidPayload === true) {
      sawValidPayload = true;
    }
    if (typeof pagePayload?.stopReason === "string" && pagePayload.stopReason.trim()) {
      stopReason = pagePayload.stopReason.trim();
    }
    if (Number.isFinite(Number(pagePayload?.expectedCount))) {
      const parsed = Math.round(Number(pagePayload.expectedCount));
      if (parsed > 0 && (expectedCount === null || parsed > expectedCount)) {
        expectedCount = parsed;
      }
    }

    const pageSnapshots = Array.isArray(pagePayload?.rowSnapshots)
      ? pagePayload.rowSnapshots
      : [];
    lastPageRowCount = pageSnapshots.length;
    if (pageSnapshots.length === 0) {
      stopReason = stopReason || "empty_page";
      break;
    }

    const priorCount = collectedSnapshots.length;
    for (const snapshot of pageSnapshots) {
      const snapshotId = normalizeLinkedInSnapshotValue(
        snapshot?.externalId || snapshot?.rowId
      );
      const uniqueKey = snapshotId || `${pageIndex}-${collectedSnapshots.length}`;
      if (seenSnapshotIds.has(uniqueKey)) {
        continue;
      }
      seenSnapshotIds.add(uniqueKey);
      collectedSnapshots.push(snapshot);
    }

    if (collectedSnapshots.length === priorCount) {
      stopReason = stopReason || "no_new_rows";
      break;
    }
  }

  if (collectedSnapshots.length > 0 || sawValidPayload) {
    return finalizeLinkedInCapturePayload({
      pageUrl: searchUrl,
      capturedAt: new Date().toISOString(),
      expectedCount,
      rowSnapshots: collectedSnapshots,
      pageCountVisited,
      stopReason: stopReason || "completed_resource_pagination"
    });
  }

  throw new Error("Could not extract LinkedIn jobs from the active Chrome tab.");
}

function buildWellfoundExtractionScript() {
  return `
(() => {
  const normalize = (value) => typeof value === "string"
    ? value.replace(/\\s+/g, " ").trim()
    : "";

  const looksLikeTitle = (value) => {
    const text = normalize(value);
    if (!text || text.length < 4 || text.length > 180) return false;
    const lowered = text.toLowerCase();
    const blocked = new Set(["apply", "learn more", "view all", "all jobs", "careers", "home"]);
    if (blocked.has(lowered)) return false;
    return /[a-z]/i.test(text) && /\\s/.test(text);
  };

  const toAbsoluteUrl = (href) => {
    const value = normalize(href);
    if (!value) return "";
    try {
      return new URL(value, location.origin).toString();
    } catch {
      return value;
    }
  };

  const extractJobId = (url) => {
    const match = String(url || "").match(/\\/jobs\\/(\\d+)/i);
    return match ? match[1] : "";
  };

  const parsePosted = (text) => {
    const lines = String(text || "").split(/\\n+/).map((line) => normalize(line)).filter(Boolean);
    return lines.find((line) => /(hour|day|week|month|year)s? ago/i.test(line) || /\\b(today|yesterday)\\b/i.test(line)) || null;
  };

  const jobs = [];
  const seen = new Set();
  const anchors = Array.from(document.querySelectorAll('a[href*="/jobs/"]'));

  for (const anchor of anchors) {
    const title = normalize(anchor.innerText || anchor.textContent || "");
    if (!looksLikeTitle(title)) {
      continue;
    }

    const href = toAbsoluteUrl(anchor.getAttribute("href") || "");
    if (!href || !/wellfound\\.com/i.test(href)) {
      continue;
    }
    if (!/\\/jobs\\/\\d+/i.test(href)) {
      continue;
    }

    const card = anchor.closest("article, li, div") || anchor.parentElement;
    const cardTextRaw = String(card?.innerText || card?.textContent || "");
    if (!normalize(cardTextRaw)) {
      continue;
    }

    const cardLines = cardTextRaw
      .split(/\\n+/)
      .map((line) => normalize(line))
      .filter(Boolean);

    let context = card;
    for (let depth = 0; depth < 6 && context; depth += 1) {
      if (context.querySelector('a[href*="/company/"]')) {
        break;
      }
      context = context.parentElement;
    }

    const contextTextRaw = String(
      context?.innerText || context?.textContent || cardTextRaw
    );
    const contextLines = contextTextRaw
      .split(/\\n+/)
      .map((line) => normalize(line))
      .filter(Boolean);

    const companyCandidates = Array.from(
      (context || card).querySelectorAll('a[href*="/company/"]')
    )
      .map((node) => normalize(node.innerText || node.textContent || ""))
      .filter(Boolean)
      .filter((value) => value.length < 80)
      .filter((value) => !/promoted|report|hide|learn more|save/i.test(value));

    const company = companyCandidates[0] || "";
    if (!company) {
      continue;
    }

    const jobTitle = normalize(cardLines[0] || title);

    const location = cardLines.find((line) =>
      /remote|san francisco|new york|hybrid|on-site|onsite|ca\\b|ny\\b/i.test(line)
    ) || "";

    const employmentType = cardLines.find((line) =>
      /full-time|part-time|contract|internship|temporary/i.test(line)
    ) || null;

    const salaryText = cardLines.find((line) =>
      /[$€£]\\s*\\d|\\b\\d+(?:\\.\\d+)?[Kk]\\b.*\\/yr|\\/hr/i.test(line)
    ) || null;

    const externalId = extractJobId(href) || null;
    const dedupeKey = externalId ? "wellfound:" + externalId : href.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    jobs.push({
      externalId,
      title: jobTitle,
      company,
      location: location || null,
      postedAt: parsePosted(contextTextRaw || cardTextRaw),
      employmentType,
      easyApply: false,
      salaryText,
      summary: normalize(cardTextRaw).slice(0, 500),
      description: normalize(contextLines.join(" · ") || cardTextRaw),
      url: href
    });
  }

  return JSON.stringify({
    pageUrl: location.href,
    capturedAt: new Date().toISOString(),
    jobs
  });
})()
  `.trim();
}

function readWellfoundJobsFromChrome(searchUrl, options = {}) {
  navigateAutomationTab(searchUrl, "Refreshing Wellfound source...");

  const settleMs = Number(options.settleMs) > 0 ? Number(options.settleMs) : 3000;
  const maxAttempts = Number(options.maxAttempts) > 0 ? Number(options.maxAttempts) : 6;
  const attemptDelayMs =
    Number(options.attemptDelayMs) > 0 ? Number(options.attemptDelayMs) : 1500;
  const extractionScript = buildWellfoundExtractionScript();

  sleepSync(settleMs);

  let lastPayload = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const raw = executeInAutomationTab(extractionScript);
    let payload;

    try {
      payload = JSON.parse(raw);
    } catch {
      payload = null;
    }

    if (payload && Array.isArray(payload.jobs)) {
      lastPayload = payload;
      if (payload.jobs.length > 0) {
        return payload;
      }
    }

    sleepSync(attemptDelayMs);
  }

  if (lastPayload && Array.isArray(lastPayload.jobs)) {
    return lastPayload;
  }

  throw new Error("Could not extract Wellfound jobs from the active Chrome tab.");
}

function buildGenericBoardExtractionScript({
  siteKey,
  hostIncludes = [],
  urlIncludes = [],
  blockedIncludes = [],
  expectedCountSelectors = null,
  expectedCountPatternSources = null,
  allowExpectedCountBodyFallback = true
}) {
  return `
(() => {
  try {
  const normalize = (value) => typeof value === "string"
    ? value.replace(/\\s+/g, " ").trim()
    : "";

  const toAbsoluteUrl = (href) => {
    const value = normalize(href);
    if (!value) return "";
    try {
      return new URL(value, location.origin).toString();
    } catch {
      return value;
    }
  };

  const hostIncludes = ${JSON.stringify(
    (Array.isArray(hostIncludes) ? hostIncludes : []).map((value) =>
      String(value || "").toLowerCase()
    )
  )};
  const urlIncludes = ${JSON.stringify(
    (Array.isArray(urlIncludes) ? urlIncludes : []).map((value) =>
      String(value || "").toLowerCase()
    )
  )};
  const blockedIncludes = ${JSON.stringify(
    (Array.isArray(blockedIncludes) ? blockedIncludes : []).map((value) =>
      String(value || "").toLowerCase()
    )
  )};
  const expectedCountSelectors = ${JSON.stringify(
    Array.isArray(expectedCountSelectors) ? expectedCountSelectors : []
  )};
  const expectedCountPatternSources = ${JSON.stringify(
    Array.isArray(expectedCountPatternSources) ? expectedCountPatternSources : []
  )};
  const allowExpectedCountBodyFallback = ${allowExpectedCountBodyFallback ? "true" : "false"};
  const titleNoise = /^(apply|save|share|learn more|continue|see more|show more|company|location)$/i;
  const expectedCountPatterns = (expectedCountPatternSources.length
    ? expectedCountPatternSources
    : [
        "showing\\\\s+\\\\d+\\\\s*[-–]\\\\s*\\\\d+\\\\s+of\\\\s+([\\\\d,]+)\\\\s+(?:jobs?|results?)",
        "([\\\\d,]+)\\\\s+(?:jobs?|results?)\\\\b",
        "of\\\\s+([\\\\d,]+)\\\\s+(?:jobs?|results?)\\\\b"
      ]).map((source) => new RegExp(source, "i"));
  const parseExpectedCountFromText = (text) => {
    const normalized = normalize(text).toLowerCase();
    if (!normalized) {
      return null;
    }

    for (const pattern of expectedCountPatterns) {
      const match = normalized.match(pattern);
      if (!match || !match[1]) {
        continue;
      }

      const parsed = Number(String(match[1]).replace(/,/g, ""));
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.round(parsed);
      }
    }
    return null;
  };

  const extractExpectedCount = () => {
    const selectors = expectedCountSelectors.length
      ? expectedCountSelectors
      : [
          "h1",
          '[data-testid*="count"]',
          '[class*="count"]',
          '[class*="results"]',
          '[class*="jobCount"]'
        ];

    let best = null;
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        const parsed = parseExpectedCountFromText(
          node?.innerText || node?.textContent || ""
        );
        if (Number.isFinite(parsed) && parsed > 0 && (best === null || parsed > best)) {
          best = parsed;
        }
      }
    }

    if (best !== null) {
      return best;
    }

    if (!allowExpectedCountBodyFallback) {
      return null;
    }

    const pageText = normalize(document.body?.innerText || "").slice(0, 8000);
    return parseExpectedCountFromText(pageText);
  };

  const parseExternalId = (url) => {
    try {
      const parsed = new URL(url);
      const jk = parsed.searchParams.get("jk") || parsed.searchParams.get("jobId");
      if (jk) {
        return jk;
      }
    } catch {
      // noop
    }

    const match = String(url || "").match(/\\/(?:jobs?|job|viewjob|remote-jobs?)\\/([^/?#]+)/i);
    return match ? match[1] : "";
  };

  const findBestCompany = (card, cardLines, title) => {
    const selectors = [
      '[data-testid*="company"]',
      '[class*="company"]',
      '[data-company]',
      'h3 + div',
      'h2 + div'
    ];

    for (const selector of selectors) {
      const node = card ? card.querySelector(selector) : null;
      const text = normalize(node?.innerText || node?.textContent || "");
      if (text && text.length <= 120 && !text.includes(title)) {
        return text;
      }
    }

    const candidate = cardLines.find((line) =>
      line &&
      line.length <= 90 &&
      !line.includes(title) &&
      !/(remote|hybrid|on-site|onsite|full-time|part-time|contract|hour|day|week|month|year|ago|posted)/i.test(line)
    );
    return candidate || "";
  };

  const findCardRoot = (anchor) =>
    anchor.closest("article") ||
    anchor.closest("li") ||
    anchor.closest("tr") ||
    anchor.closest('[data-jk], [data-jobkey], [data-testid*="job"], [class*="job"]') ||
    anchor.parentElement ||
    null;

  const findLocation = (card, cardLines) => {
    const selectors = [
      '[data-testid*="location"]',
      '[class*="location"]'
    ];
    for (const selector of selectors) {
      const node = card ? card.querySelector(selector) : null;
      const text = normalize(node?.innerText || node?.textContent || "");
      if (text && text.length <= 100) {
        return text;
      }
    }

    const candidate = cardLines.find((line) =>
      /(remote|hybrid|on-site|onsite|san francisco|new york|seattle|austin|los angeles|california|united states)/i.test(line)
    );
    return candidate || "";
  };

  const findPostedAt = (cardLines) => {
    const candidate = cardLines.find((line) =>
      /(\\d+\\s+(hour|day|week|month|year)s?\\s+ago|today|yesterday|just posted|posted|reposted|active\\s+\\d+\\s+(?:day|week|month)s?\\s+ago)/i.test(line)
    );
    return candidate || null;
  };

  const findSalary = (cardLines) => {
    const candidate = cardLines.find((line) =>
      /(?:[$€£]\\s*\\d[\\d,]*(?:\\.\\d+)?(?:[kKmM])?(?:\\s*[-–]\\s*[$€£]?\\s*\\d[\\d,]*(?:\\.\\d+)?(?:[kKmM])?)?|\\b\\d{2,3}\\s*[Kk]\\s*[-–]\\s*\\d{2,3}\\s*[Kk]\\b)(?:\\s*(?:annually|yearly|monthly|weekly|hourly|per\\s+(?:year|yr|hour|hr)|\\/(?:year|yr|hour|hr)))?/i.test(line)
    );
    return candidate || null;
  };

  const findEmploymentType = (cardLines) => {
    const candidate = cardLines.find((line) =>
      /(full[- ]?time|part[- ]?time|contract|temporary|internship|freelance|apprenticeship)/i.test(
        line
      )
    );
    return candidate || null;
  };

  const parseDetailHints = (text) => {
    const normalizedText = normalize(text);
    if (!normalizedText) {
      return {
        postedAt: "",
        salaryText: "",
        employmentType: "",
        location: ""
      };
    }
    const postedAt =
      normalizedText.match(
        /(\\d+\\s+(?:hour|day|week|month|year)s?\\s+ago|today|yesterday|just posted|reposted|posted(?:\\s+on)?\\s+[a-z]{3,9}\\s+\\d{1,2},?\\s+\\d{2,4})/i
      )?.[1] || "";
    const salaryText =
      normalizedText.match(
        /(?:[$€£]\\s*\\d[\\d,]*(?:\\.\\d+)?(?:[kKmM])?(?:\\s*[-–]\\s*[$€£]?\\s*\\d[\\d,]*(?:\\.\\d+)?(?:[kKmM])?)?|\\b\\d{2,3}\\s*[Kk]\\s*[-–]\\s*\\d{2,3}\\s*[Kk]\\b)(?:\\s*(?:annually|yearly|monthly|weekly|hourly|per\\s+(?:year|yr|hour|hr)|\\/(?:year|yr|hour|hr)))?/i
      )?.[0] || "";
    const employmentType =
      normalizedText.match(
        /\\b(full[- ]?time|part[- ]?time|contract|temporary|internship|freelance|apprenticeship)\\b/i
      )?.[1] || "";
    const location =
      normalizedText.match(
        /\\b(remote|hybrid|on-site|onsite|in-office|san francisco(?:,\\s*ca)?|new york(?:,\\s*ny)?|seattle(?:,\\s*wa)?|austin(?:,\\s*tx)?|los angeles(?:,\\s*ca)?|california|united states)\\b/i
      )?.[1] || "";

    return {
      postedAt: normalize(postedAt),
      salaryText: normalize(salaryText),
      employmentType: normalize(employmentType),
      location: normalize(location)
    };
  };

  const readDetailHints = (anchor) => {
    if (anchor && typeof anchor.click === "function") {
      anchor.click();
    }

    const start = Date.now();
    while (Date.now() - start < 150) {
      // allow detail pane repaint
    }

    const selectors = [
      '[data-testid*="jobsearch-JobComponent-description"]',
      '[class*="jobsearch-JobComponent-description"]',
      '[class*="job-description"]',
      '[class*="jobDescription"]',
      '[class*="job-details"]',
      '[class*="jobDetails"]'
    ];
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      const text = normalize(node?.innerText || node?.textContent || "");
      if (text.length > 40) {
        return parseDetailHints(text);
      }
    }

    return parseDetailHints("");
  };

  const jobs = [];
  const seen = new Set();
  const anchors = Array.from(document.querySelectorAll("a[href]"));
  const debug = {
    anchors: anchors.length,
    hrefMatches: 0,
    titlePass: 0,
    cardPass: 0
  };

  for (const anchor of anchors) {
    const href = toAbsoluteUrl(anchor.getAttribute("href") || "");
    const hrefLower = String(href || "").toLowerCase();
    const hostMatch =
      hostIncludes.length === 0 ||
      hostIncludes.some((needle) => hrefLower.includes(needle));
    const urlMatch =
      urlIncludes.length === 0 ||
      urlIncludes.some((needle) => hrefLower.includes(needle));
    const blockedMatch = blockedIncludes.some((needle) => hrefLower.includes(needle));

    if (!href || !hostMatch || !urlMatch || blockedMatch) {
      continue;
    }
    debug.hrefMatches += 1;

    const title = normalize(anchor.innerText || anchor.textContent || "");
    if (!title || title.length < 4 || title.length > 220 || titleNoise.test(title)) {
      continue;
    }
    debug.titlePass += 1;

    const card = findCardRoot(anchor);
    const rawCardText = String(card?.innerText || card?.textContent || "").slice(0, 1500);
    if (!normalize(rawCardText)) {
      continue;
    }
    debug.cardPass += 1;

    const cardLines = rawCardText
      .split(/\\n+/)
      .map((line) => normalize(line))
      .filter(Boolean)
      .slice(0, 24);
    const cardText = normalize(cardLines.join(" · ") || rawCardText);

    const company = findBestCompany(card, cardLines, title) || "Unknown company";
    const detailHints = readDetailHints(anchor);
    const cardLocation = findLocation(card, cardLines);
    const cardPostedAt = findPostedAt(cardLines);
    const cardEmploymentType = findEmploymentType(cardLines);
    const cardSalaryText = findSalary(cardLines);

    const externalId = parseExternalId(href) || null;
    const dedupeKey = externalId
      ? "${siteKey}:" + externalId
      : (title.toLowerCase() + "|" + href.toLowerCase());
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    jobs.push({
      externalId,
      title,
      company,
      location: cardLocation || detailHints.location || null,
      postedAt: cardPostedAt || detailHints.postedAt || null,
      employmentType: cardEmploymentType || detailHints.employmentType || null,
      easyApply: false,
      salaryText: cardSalaryText || detailHints.salaryText || null,
      summary: cardLines.slice(0, 6).join(" · ").slice(0, 500),
      description: cardText.slice(0, 1000),
      extractorProvenance: {
        postedAt: cardPostedAt ? "card" : detailHints.postedAt ? "detail" : "fallback_unknown",
        salaryText: cardSalaryText ? "card" : detailHints.salaryText ? "detail" : "fallback_unknown",
        employmentType: cardEmploymentType
          ? "card"
          : detailHints.employmentType
            ? "detail"
            : "fallback_unknown",
        location: cardLocation ? "card" : detailHints.location ? "detail" : "fallback_unknown",
        description: "card"
      },
      url: href
    });

    if (jobs.length >= 200) {
      break;
    }
  }

  return JSON.stringify({
    pageUrl: location.href,
    capturedAt: new Date().toISOString(),
    jobs,
    expectedCount: extractExpectedCount(),
    debug
  });
  } catch (error) {
    return JSON.stringify({
      pageUrl: location.href,
      capturedAt: new Date().toISOString(),
      jobs: [],
      expectedCount: null,
      debug: null,
      error: String(error && error.message ? error.message : error)
    });
  }
})()
  `.trim();
}

function dedupeJobsByIdentity(jobs) {
  const deduped = new Map();

  for (const job of Array.isArray(jobs) ? jobs : []) {
    if (!job || typeof job !== "object") {
      continue;
    }

    const key = String(
      job.externalId ||
        job.url ||
        `${job.title || ""}|${job.company || ""}|${job.location || ""}`
    )
      .trim()
      .toLowerCase();
    if (!key) {
      continue;
    }

    if (!deduped.has(key)) {
      deduped.set(key, job);
    }
  }

  return Array.from(deduped.values());
}

function buildUrlWithSearchParam(urlText, key, value) {
  try {
    const parsed = new URL(String(urlText || "").trim());
    parsed.searchParams.set(String(key || ""), String(value || ""));
    return parsed.toString();
  } catch {
    return String(urlText || "").trim();
  }
}

export function buildZipRecruiterPageUrl(urlText, pageNumber) {
  try {
    const parsed = new URL(String(urlText || "").trim());
    const page = Number(pageNumber);
    if (!Number.isInteger(page) || page <= 1) {
      parsed.searchParams.delete("page");
      parsed.pathname = parsed.pathname.replace(/\/jobs-search\/\d+$/, "/jobs-search");
      return parsed.toString();
    }

    parsed.pathname = parsed.pathname.replace(/\/jobs-search\/\d+$/, "/jobs-search");
    parsed.searchParams.set("page", String(page));
    return parsed.toString();
  } catch {
    return buildUrlWithSearchParam(urlText, "page", String(pageNumber || 1));
  }
}

function capturePaginatedGenericBoardJobs({
  searchUrl,
  extractionScript,
  maxPages,
  pageUrlForIndex,
  options = {}
}) {
  const resolvedMaxPages = Number(maxPages);
  const pages = Number.isInteger(resolvedMaxPages) && resolvedMaxPages > 0
    ? resolvedMaxPages
    : 1;

  const collected = [];
  let lastPayload = null;
  let expectedCount = null;

  for (let index = 0; index < pages; index += 1) {
    const pageUrl = pageUrlForIndex(index);
    const payload = readGenericBoardJobsFromChrome(pageUrl, extractionScript, options);
    lastPayload = payload;
    const payloadExpectedCount = Number(payload?.expectedCount);
    if (Number.isFinite(payloadExpectedCount) && payloadExpectedCount > 0) {
      const parsedExpected = Math.round(payloadExpectedCount);
      if (expectedCount === null || parsedExpected > expectedCount) {
        expectedCount = parsedExpected;
      }
    }

    const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
    if (jobs.length === 0) {
      if (index === 0) {
        break;
      }
      break;
    }

    const priorCount = collected.length;
    collected.push(...jobs);
    const deduped = dedupeJobsByIdentity(collected);
    collected.length = 0;
    collected.push(...deduped);

    if (collected.length === priorCount) {
      break;
    }
  }

  if (collected.length > 0 || lastPayload) {
    return {
      pageUrl: searchUrl,
      capturedAt: new Date().toISOString(),
      jobs: collected,
      expectedCount
    };
  }

  throw new Error("Could not extract jobs from the active Chrome tab.");
}

function readGenericBoardJobsFromChrome(searchUrl, extractionScript, options = {}) {
  navigateAutomationTab(searchUrl, "Refreshing source...");

  const settleMs = Number(options.settleMs) > 0 ? Number(options.settleMs) : 3000;
  const maxAttempts = Number(options.maxAttempts) > 0 ? Number(options.maxAttempts) : 6;
  const attemptDelayMs =
    Number(options.attemptDelayMs) > 0 ? Number(options.attemptDelayMs) : 1500;
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 15_000;

  sleepSync(settleMs);
  const tabInfo = readAutomationTabInfo();
  const debugScriptPath = String(process.env.JOB_FINDER_DEBUG_SCRIPT_PATH || "").trim();
  if (debugScriptPath) {
    fs.writeFileSync(debugScriptPath, `${extractionScript}\n`, "utf8");
  }
  const debugResultPath = String(process.env.JOB_FINDER_DEBUG_RESULT_PATH || "").trim();

  let lastPayload = null;
  let lastRaw = "";
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const raw = executeInAutomationTab(extractionScript, timeoutMs);
    lastRaw = raw;
    if (debugResultPath) {
      fs.writeFileSync(debugResultPath, `${String(raw || "").trim()}\n`, "utf8");
    }
    let payload;

    try {
      payload = JSON.parse(raw);
    } catch {
      payload = null;
    }

    if (payload && Array.isArray(payload.jobs)) {
      lastPayload = payload;
      if (payload.error) {
        lastError = payload.error;
      }
      if (payload.jobs.length > 0) {
        return payload;
      }
    }

    sleepSync(attemptDelayMs);
  }

  if (lastPayload && Array.isArray(lastPayload.jobs)) {
    return lastPayload;
  }

  const rawPreview = String(lastRaw || "").trim().slice(0, 240);
  if (lastError) {
    throw new Error(
      `Could not extract jobs from the active Chrome tab. ${lastError} Active tab: ${tabInfo.url || "unknown"} (${tabInfo.title || "untitled"})`
    );
  }
  if (rawPreview) {
    throw new Error(
      `Could not extract jobs from the active Chrome tab. Raw result: ${rawPreview} Active tab: ${tabInfo.url || "unknown"} (${tabInfo.title || "untitled"})`
    );
  }

  throw new Error(
    `Could not extract jobs from the active Chrome tab. Active tab: ${tabInfo.url || "unknown"} (${tabInfo.title || "untitled"})`
  );
}

function buildIndeedExtractionScript(nativeFilterState = null) {
  return `
(() => {
  try {
    const nativeFilterState = ${JSON.stringify(nativeFilterState || null)};
    const normalize = (value) =>
      typeof value === "string" ? value.replace(/\\s+/g, " ").trim() : "";
    const toAbsoluteUrl = (href) => {
      const value = normalize(href);
      if (!value) return "";
      try {
        return new URL(value, location.origin).toString();
      } catch {
        return value;
      }
    };
    const parseExpectedCountFromText = (text) => {
      const normalized = normalize(text).toLowerCase();
      if (!normalized) {
        return null;
      }
      const patterns = [
        /page\\s+\\d+\\s+of\\s+([\\d,]+)\\s+jobs?\\b/i,
        /showing\\s+\\d+\\s*[-–]\\s*\\d+\\s+of\\s+([\\d,]+)\\s+jobs?\\b/i
      ];
      for (const pattern of patterns) {
        const match = normalized.match(pattern);
        if (!match?.[1]) continue;
        const parsed = Number(String(match[1]).replace(/,/g, ""));
        if (Number.isFinite(parsed) && parsed > 0) {
          return Math.round(parsed);
        }
      }
      return null;
    };
    const extractExpectedCount = () => {
      const selectors = ${JSON.stringify(INDEED_EXPECTED_COUNT_SELECTORS)};
      let best = null;
      for (const selector of selectors) {
        for (const node of document.querySelectorAll(selector)) {
          const parsed = parseExpectedCountFromText(node?.innerText || node?.textContent || "");
          if (Number.isFinite(parsed) && parsed > 0 && (best === null || parsed > best)) {
            best = parsed;
          }
        }
      }
      return best;
    };
    const parseExternalId = (url) => {
      try {
        const parsed = new URL(url);
        return normalize(parsed.searchParams.get("jk") || parsed.searchParams.get("jobId") || "");
      } catch {
        return "";
      }
    };
    const findText = (root, selectors) => {
      for (const selector of selectors) {
        const node = root?.querySelector(selector);
        const text = normalize(node?.innerText || node?.textContent || "");
        if (text) {
          return text;
        }
      }
      return "";
    };
    const findInputValue = (selectors) => {
      for (const selector of selectors) {
        const node = document.querySelector(selector);
        const value = normalize(
          node?.value ||
          node?.getAttribute?.("value") ||
          node?.innerText ||
          node?.textContent ||
          ""
        );
        if (value) {
          return value;
        }
      }
      return "";
    };
    const findFilterButtonText = (label) => {
      const lowered = String(label || "").toLowerCase();
      const nodes = Array.from(document.querySelectorAll("button, [role='button']"));
      for (const node of nodes) {
        const text = normalize(node.innerText || node.textContent || "");
        if (text && text.toLowerCase().includes(lowered)) {
          return text;
        }
      }
      return "";
    };
    const parseCardLines = (root) =>
      String(root?.innerText || root?.textContent || "")
        .split(/\\n+/)
        .map((line) => normalize(line))
        .filter(Boolean)
        .slice(0, 24);
    const findLocation = (root, lines) =>
      findText(root, ['[data-testid*="text-location"]', '[data-testid*="company-location"]', '[class*="location"]']) ||
      lines.find((line) => /(remote|hybrid|on-site|onsite|san francisco|oakland|berkeley|walnut creek|pleasanton|milpitas|san jose|california|united states)/i.test(line)) ||
      "";
    const findSalary = (root, lines) =>
      findText(root, ['[data-testid*="attribute_snippet_testid"]', '[class*="salary"]']) ||
      lines.find((line) => /(?:[$€£]\\s*\\d[\\d,]*(?:\\.\\d+)?(?:[kKmM])?(?:\\s*[-–]\\s*[$€£]?\\s*\\d[\\d,]*(?:\\.\\d+)?(?:[kKmM])?)?|\\b\\d{2,3}\\s*[Kk]\\s*[-–]\\s*\\d{2,3}\\s*[Kk]\\b)(?:\\s*(?:annually|yearly|monthly|weekly|hourly|per\\s+(?:year|yr|hour|hr)|\\/(?:year|yr|hour|hr)))?/i.test(line)) ||
      "";
    const findEmploymentType = (lines) =>
      lines.find((line) => /(full[- ]?time|part[- ]?time|contract|temporary|internship|freelance|apprenticeship)/i.test(line)) ||
      "";
    const cardSelector = [
      '[data-jk]',
      '[data-testid="slider_item"]',
      '[data-testid*="job_seen_beacon"]',
      '[class*="job_seen_beacon"]'
    ].join(", ");
    const cards = Array.from(document.querySelectorAll(cardSelector))
      .filter((node) => node && normalize(node.innerText || node.textContent || ""));
    const seen = new Set();
    const jobs = [];
    for (const card of cards) {
      const anchor = card.querySelector('h2 a[href], a[href*="/viewjob"], a[href*="/rc/clk"]');
      const href = toAbsoluteUrl(anchor?.getAttribute("href") || "");
      if (!href || /\\/pagead\\/clk/i.test(href) || /\\/career(?:[/?#]|$)/i.test(href)) {
        continue;
      }
      const externalId = parseExternalId(href) || normalize(card.getAttribute("data-jk") || "");
      if (!externalId || seen.has(externalId)) {
        continue;
      }
      const title =
        normalize(anchor?.innerText || anchor?.textContent || "") ||
        findText(card, ['[data-testid="jobTitle"]', 'h2']);
      if (!title || title.length < 4 || title.length > 220) {
        continue;
      }
      const lines = parseCardLines(card);
      const company =
        findText(card, ['[data-testid="company-name"]', '[data-testid*="companyName"]', '[class*="companyName"]']) ||
        lines.find((line) => line && line.length <= 120 && !line.includes(title) && !/(remote|hybrid|on-site|onsite|full[- ]?time|part[- ]?time|contract|day|week|month|year|ago|posted)/i.test(line)) ||
        "Unknown company";
      const location = findLocation(card, lines) || null;
      const salaryText = findSalary(card, lines) || null;
      const employmentType = findEmploymentType(lines) || null;
      seen.add(externalId);
      jobs.push({
        externalId,
        title,
        company,
        location,
        postedAt: "within 3 days (search filter)",
        employmentType,
        easyApply: false,
        salaryText,
        summary: lines.slice(0, 6).join(" · ").slice(0, 500),
        description: normalize(lines.join(" · ")).slice(0, 1000),
        extractorProvenance: {
          postedAt: "inferred_search_filter",
          salaryText: salaryText ? "card" : "fallback_unknown",
          employmentType: employmentType ? "card" : "fallback_unknown",
          location: location ? "card" : "fallback_unknown",
          description: "card"
        },
        url: href
      });
    }
    return JSON.stringify({
      pageUrl: location.href,
      capturedAt: new Date().toISOString(),
      jobs,
      expectedCount: extractExpectedCount(),
      captureDiagnostics: {
        queryValue: findInputValue([
          'input[name="q"]',
          'input[placeholder*="Job title"]',
          'input[placeholder*="keywords"]'
        ]),
        locationValue: findInputValue([
          'input[name="l"]',
          'input[placeholder*="City, state"]',
          'input[placeholder*="Search location"]'
        ]),
        appliedPayFilter:
          normalize(findFilterButtonText("Pay")) ||
          normalize(nativeFilterState?.appliedPayFilter || ""),
        appliedDatePostedFilter:
          normalize(findFilterButtonText("Date posted")) ||
          normalize(nativeFilterState?.appliedDatePostedFilter || ""),
        appliedDistanceFilter:
          normalize(findFilterButtonText("Distance")) ||
          normalize(nativeFilterState?.appliedDistanceFilter || ""),
        pageTitle: normalize(document.title || ""),
        expectedState: nativeFilterState
      },
      debug: {
        cards: cards.length,
        jobs: jobs.length
      }
    });
  } catch (error) {
    return JSON.stringify({
      pageUrl: location.href,
      capturedAt: new Date().toISOString(),
      jobs: [],
      expectedCount: null,
      debug: null,
      error: String(error && error.message ? error.message : error)
    });
  }
})()
  `.trim();
}

function readIndeedJobsFromChrome(searchUrl, options = {}) {
  const extractionScript = buildIndeedExtractionScript(options.nativeFilterState);
  const maxPages = Number(options.maxPages) > 0 ? Number(options.maxPages) : 8;
  const payload = capturePaginatedGenericBoardJobs({
    searchUrl,
    extractionScript,
    maxPages,
    pageUrlForIndex: (index) =>
      buildUrlWithSearchParam(searchUrl, "start", String(index * 10)),
    options
  });
  payload.jobs = filterIndeedCapturedJobs(payload.jobs);
  return payload;
}

function readZipRecruiterJobsFromChrome(searchUrl, options = {}) {
  const extractionScript = `
(() => {
  try {
  const normalize = (value) => typeof value === "string"
    ? value.replace(/\\s+/g, " ").trim()
    : "";
  const parseExpectedCountFromText = (text) => {
    const normalized = normalize(text).toLowerCase();
    if (!normalized) {
      return null;
    }

    const match =
      normalized.match(/showing\\s+\\d+\\s*[-–]\\s*\\d+\\s+of\\s+([\\d,]+)\\s+jobs?/i) ||
      normalized.match(/([\\d,]+)\\s+jobs?\\b/i);
    if (!match || !match[1]) {
      return null;
    }

    const parsed = Number(String(match[1]).replace(/,/g, ""));
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
  };

  const toAbsoluteUrl = (href) => {
    const value = normalize(href);
    if (!value) return "";
    try {
      return new URL(value, location.origin).toString();
    } catch {
      return value;
    }
  };

  const CARD_SELECTOR = [
    'div[class*="job_result_two_pane"]',
    'article[class*="job_result"]',
    'li[class*="job_result"]',
    'li[data-testid*="job"]',
    'div[data-testid*="job-result"]',
    'div[data-testid*="jobCard"]',
    'div[data-testid*="job_card"]'
  ].join(", ");

  const getCards = () => Array.from(document.querySelectorAll(CARD_SELECTOR));

  const uniqueElements = (elements) => {
    const output = [];
    const seen = new Set();
    for (const element of elements) {
      if (!element || seen.has(element)) {
        continue;
      }
      seen.add(element);
      output.push(element);
    }
    return output;
  };

  const scoreScrollCandidate = (element) => {
    if (!element || typeof element.querySelectorAll !== "function") {
      return 0;
    }
    const style = window.getComputedStyle(element);
    const overflowY = String(style?.overflowY || "").toLowerCase();
    const scrollable =
      element.scrollHeight > element.clientHeight + 40 &&
      /(auto|scroll|overlay)/.test(overflowY) &&
      element.clientHeight >= 200;
    if (!scrollable) {
      return 0;
    }
    const cardCount = element.querySelectorAll(CARD_SELECTOR).length;
    return cardCount * 1000 + element.clientHeight;
  };

  const findScrollContainers = () => {
    const seeded = Array.from(document.querySelectorAll([
      'main',
      '[role="main"]',
      '[data-testid*="results"]',
      '[data-testid*="searchResults"]',
      '[class*="results"]',
      '[class*="Results"]',
      '[class*="job_results"]',
      '[class*="jobResults"]',
      '[class*="jobs_results"]',
      '[class*="jobsResults"]',
      '[class*="left-pane"]',
      '[class*="leftPane"]'
    ].join(", ")));
    const ancestorCandidates = [];
    for (const card of getCards()) {
      let node = card?.parentElement;
      let depth = 0;
      while (node && depth < 10) {
        ancestorCandidates.push(node);
        node = node.parentElement;
        depth += 1;
      }
    }

    const ordered = uniqueElements([...seeded, ...ancestorCandidates])
      .map((element) => ({ element, score: scoreScrollCandidate(element) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .map((entry) => entry.element);

    const scrollingElement =
      document.scrollingElement || document.documentElement || document.body || null;
    return uniqueElements([...ordered, scrollingElement].filter(Boolean));
  };

  const parseDetailHints = (text) => {
    const normalizedText = normalize(text);
    if (!normalizedText) {
      return {
        postedAt: "",
        salaryText: "",
        employmentType: "",
        location: ""
      };
    }

    const postedAt =
      normalizedText.match(
        /(\\d+\\s+(?:hour|day|week|month|year)s?\\s+ago|today|yesterday|just posted|reposted|posted(?:\\s+on)?\\s+[a-z]{3,9}\\s+\\d{1,2},?\\s+\\d{2,4})/i
      )?.[1] || "";
    const salaryText =
      normalizedText.match(
        /(?:[$€£]\\s*\\d[\\d,]*(?:\\.\\d+)?(?:[kKmM])?(?:\\s*[-–]\\s*[$€£]?\\s*\\d[\\d,]*(?:\\.\\d+)?(?:[kKmM])?)?|\\b\\d{2,3}\\s*[Kk]\\s*[-–]\\s*\\d{2,3}\\s*[Kk]\\b)(?:\\s*(?:annually|yearly|monthly|weekly|hourly|per\\s+(?:year|yr|hour|hr)|\\/(?:year|yr|hour|hr)))?/i
      )?.[0] || "";
    const employmentType =
      normalizedText.match(
        /\\b(full[- ]?time|part[- ]?time|contract|temporary|internship|freelance|apprenticeship)\\b/i
      )?.[1] || "";
    const location =
      normalizedText.match(
        /\\b(remote|hybrid|on-site|onsite|in-office|san francisco(?:,\\s*ca)?|new york(?:,\\s*ny)?|seattle(?:,\\s*wa)?|austin(?:,\\s*tx)?|los angeles(?:,\\s*ca)?|california|united states)\\b/i
      )?.[1] || "";

    return {
      postedAt: normalize(postedAt),
      salaryText: normalize(salaryText),
      employmentType: normalize(employmentType),
      location: normalize(location)
    };
  };

  const jobs = [];
  const seen = new Set();
  const collectVisibleJobs = () => {
    const cards = getCards();
    for (const card of cards) {
      const titleNode = card.querySelector("h2");
      const title = normalize(titleNode?.innerText || titleNode?.textContent || "");
      if (!title || title.length < 4 || title.length > 180) {
        continue;
      }

      const jobLink =
        card.querySelector('a[href*="/jobs/"]') ||
        card.querySelector('a[href*="/job/"]') ||
        card.querySelector("a[href]");
      const companyLink = card.querySelector('a[href*="/co/"]');
      const companyNode =
        card.querySelector('[data-testid*="company"]') ||
        card.querySelector('[class*="company"]');
      const company = normalize(
        companyNode?.innerText ||
        companyNode?.textContent ||
        companyLink?.innerText ||
        companyLink?.textContent ||
        ""
      ) || "Unknown company";
      const url = toAbsoluteUrl(jobLink?.getAttribute("href") || location.href);

      const locationNode = card.querySelector('a[href*="jobs-search?location="]');
      const location = normalize(
        locationNode?.innerText || locationNode?.textContent || ""
      ) || null;
      const cardText = normalize(card.innerText || card.textContent || "");
      const detailHints = parseDetailHints(cardText);
      const cardSalaryText =
        normalize(
          cardText.match(/\\$\\d[\\d,]*(?:K)?\\s*-\\s*\\$\\d[\\d,]*(?:K)?\\/?(?:yr|year|hr|hour)?/i)?.[0]
        ) || null;
      const cardPostedAt =
        normalize(cardText.match(/\\b(new|\\d+\\s*[dhm])\\b/i)?.[0]) || null;
      const salaryText = cardSalaryText || detailHints.salaryText || null;
      const postedAt = cardPostedAt || detailHints.postedAt || null;
      const employmentType = detailHints.employmentType || null;
      const resolvedLocation = location || detailHints.location || null;

      const externalId = normalize([company, title, location || "", url].join("|"));
      if (seen.has(externalId)) {
        continue;
      }
      seen.add(externalId);

      jobs.push({
        externalId: externalId || null,
        title,
        company,
        location: resolvedLocation,
        postedAt,
        employmentType,
        easyApply: false,
        salaryText,
        summary: cardText.slice(0, 500),
        description: cardText.slice(0, 1000),
        extractorProvenance: {
          postedAt: cardPostedAt ? "card" : detailHints.postedAt ? "detail" : "fallback_unknown",
          salaryText: cardSalaryText ? "card" : detailHints.salaryText ? "detail" : "fallback_unknown",
          employmentType: detailHints.employmentType ? "detail" : "fallback_unknown",
          location: location ? "card" : detailHints.location ? "detail" : "fallback_unknown",
          description: "card"
        },
        url
      });
    }
  };

  collectVisibleJobs();

  for (const container of findScrollContainers()) {
    let stagnantPasses = 0;
    let lastCount = jobs.length;
    let previousScrollTop = -1;

    for (let pass = 0; pass < 12 && stagnantPasses < 3; pass += 1) {
      const scrollTopBefore =
        container === document.scrollingElement || container === document.documentElement || container === document.body
          ? window.scrollY
          : container.scrollTop;
      const scrollDelta =
        container === document.scrollingElement || container === document.documentElement || container === document.body
          ? Math.max(window.innerHeight * 0.85, 500)
          : Math.max(container.clientHeight * 0.85, 300);

      if (container === document.scrollingElement || container === document.documentElement || container === document.body) {
        window.scrollTo(0, scrollTopBefore + scrollDelta);
      } else {
        container.scrollTop = scrollTopBefore + scrollDelta;
      }

      const start = Date.now();
      while (Date.now() - start < 180) {
        // allow virtualization/rendering to catch up
      }

      collectVisibleJobs();

      const scrollTopAfter =
        container === document.scrollingElement || container === document.documentElement || container === document.body
          ? window.scrollY
          : container.scrollTop;

      if (jobs.length === lastCount && scrollTopAfter === previousScrollTop) {
        stagnantPasses += 1;
      } else if (jobs.length === lastCount && scrollTopAfter === scrollTopBefore) {
        stagnantPasses += 1;
      } else {
        stagnantPasses = 0;
      }

      lastCount = jobs.length;
      previousScrollTop = scrollTopAfter;
    }
  }

  return JSON.stringify({
    pageUrl: location.href,
    capturedAt: new Date().toISOString(),
    jobs,
    expectedCount: parseExpectedCountFromText(document.body?.innerText || "")
  });
  } catch (error) {
    return JSON.stringify({
      pageUrl: location.href,
      capturedAt: new Date().toISOString(),
      jobs: [],
      error: String(error?.message || error || "ziprecruiter extraction failed")
    });
  }
})()
  `.trim();
  const maxPages = Number(options.maxPages) > 0 ? Number(options.maxPages) : 3;
  return capturePaginatedGenericBoardJobs({
    searchUrl,
    extractionScript,
    maxPages,
    pageUrlForIndex: (index) =>
      buildZipRecruiterPageUrl(searchUrl, index + 1),
    options
  });
}

function readRemoteOkJobsFromChrome(searchUrl, options = {}) {
  const extractionScript = `
(() => {
  const normalize = (value) => typeof value === "string"
    ? value.replace(/\\s+/g, " ").trim()
    : "";

  const toAbsoluteUrl = (href) => {
    const value = normalize(href);
    if (!value) return "";
    try {
      return new URL(value, location.origin).toString();
    } catch {
      return value;
    }
  };

  const jobs = [];
  const seen = new Set();
  const rows = Array.from(document.querySelectorAll("tr.job"));

  for (const row of rows) {
    const titleNode =
      row.querySelector(".company_and_position h2") ||
      row.querySelector("h2");
    const companyNode =
      row.querySelector(".company_and_position h3") ||
      row.querySelector("h3");
    const linkNode =
      row.querySelector('a[itemprop="url"]') ||
      row.querySelector('td.company_and_position a[href*="/remote-"]');

    const title = normalize(titleNode?.innerText || titleNode?.textContent || "");
    const company = normalize(
      companyNode?.innerText || companyNode?.textContent || ""
    );
    const url = toAbsoluteUrl(linkNode?.getAttribute("href") || "");

    if (!title || !company || !url || !/\\/remote-jobs\\//i.test(url)) {
      continue;
    }

    const externalId = normalize(url.split("/remote-jobs/")[1]?.split(/[?#]/)[0] || "");
    const dedupeKey = externalId || url.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    const rowText = normalize(row.innerText || row.textContent || "");
    const location =
      normalize(
        row.querySelector(".location")?.innerText ||
        row.querySelector(".company_and_position .location")?.textContent ||
        ""
      ) || null;
    const postedAt = normalize(row.querySelector(".time")?.innerText || "") || null;
    const salaryText =
      normalize(row.querySelector(".salary")?.innerText || "") || null;

    jobs.push({
      externalId: externalId || null,
      title,
      company,
      location,
      postedAt,
      employmentType: null,
      easyApply: false,
      salaryText,
      summary: rowText.slice(0, 500),
      description: rowText.slice(0, 1000),
      url
    });
  }

  return JSON.stringify({
    pageUrl: location.href,
    capturedAt: new Date().toISOString(),
    jobs
  });
})()
  `.trim();
  return readGenericBoardJobsFromChrome(searchUrl, extractionScript, options);
}

function buildGoogleBrowserExtractionScript() {
  return `
(() => {
  const normalize = (value) => typeof value === "string"
    ? value.replace(/\\s+/g, " ").trim()
    : "";

  const toAbsoluteUrl = (href) => {
    const value = normalize(href);
    if (!value) return "";
    try {
      return new URL(value, location.origin).toString();
    } catch {
      return value;
    }
  };

  const decodeGoogleRedirect = (url) => {
    const absolute = toAbsoluteUrl(url);
    if (!absolute) return "";
    try {
      const parsed = new URL(absolute);
      const redirected = parsed.searchParams.get("q") || parsed.searchParams.get("url");
      if (!redirected) return absolute;
      return toAbsoluteUrl(decodeURIComponent(redirected));
    } catch {
      return absolute;
    }
  };

  const isGoogleUrl = (url) => {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return host.includes("google.");
    } catch {
      return false;
    }
  };

  const isLikelyJobUrl = (url) => {
    const value = String(url || "").toLowerCase();
    return (
      value.includes("/jobs/") ||
      value.includes("jobid=") ||
      value.includes("gh_jid=") ||
      value.includes("jk=") ||
      value.includes("lever.co") ||
      value.includes("greenhouse.io") ||
      value.includes("ashbyhq.com")
    );
  };

  const extractGoogleWidgetId = (url) => {
    const text = String(url || "");
    const encodedMatch = text.match(/docid%3D([^%&]+)/i);
    if (encodedMatch) return encodedMatch[1];
    const plainMatch = text.match(/[?#&]docid=([^&]+)/i);
    if (plainMatch) return plainMatch[1];
    const vhidMatch = text.match(/[?#&]vhid=([^&]+)/i);
    return vhidMatch ? vhidMatch[1] : "";
  };

  const guessCompanyFromUrl = (url) => {
    try {
      const hostParts = new URL(url).hostname
        .replace(/^www\\./i, "")
        .split(".")
        .filter(Boolean);
      if (hostParts.length === 0) return "";
      const root =
        hostParts.length > 1 ? hostParts[hostParts.length - 2] : hostParts[0];
      return normalize(root.replace(/[-_]+/g, " "));
    } catch {
      return "";
    }
  };

  const findSalaryText = (text) => {
    const match = String(text || "").match(
      /(?:[$€£]\\s*\\d[\\d,]*(?:\\.\\d+)?(?:[kKmM])?(?:\\s*[-–]\\s*[$€£]?\\s*\\d[\\d,]*(?:\\.\\d+)?(?:[kKmM])?)?|\\b\\d{2,3}\\s*[Kk]\\s*[-–]\\s*\\d{2,3}\\s*[Kk]\\b)(?:\\s*(?:annually|yearly|monthly|weekly|hourly|per\\s+(?:year|yr|hour|hr)|\\/(?:year|yr|hour|hr)))?/i
    );
    return match ? normalize(match[0]) : null;
  };

  const jobs = [];
  const seen = new Set();
  const anchors = Array.from(document.querySelectorAll("a[href]"));

  for (const anchor of anchors) {
    const href = decodeGoogleRedirect(anchor.getAttribute("href") || "");
    if (!href || isGoogleUrl(href) || !isLikelyJobUrl(href)) {
      continue;
    }

    const titleNode = anchor.querySelector("h3");
    const title = normalize(titleNode?.innerText || anchor.innerText || anchor.textContent || "");
    if (!title || title.length < 4 || title.length > 180) {
      continue;
    }

    const dedupeKey = title.toLowerCase() + "|" + href.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    const card = anchor.closest("div, li, article");
    const text = normalize(card?.innerText || card?.textContent || "");
    const locationMatch = text.match(
      /\b(san francisco|new york|remote|seattle|austin|los angeles|california)\b/i
    );
    const postedAtMatch = text.match(
      /(\\d+\\s+(?:hour|day|week|month|year)s?\\s+ago|today|yesterday)/i
    );
    const salaryText = findSalaryText(text);
    jobs.push({
      externalId: null,
      title,
      company: guessCompanyFromUrl(href) || "Unknown company",
      location: locationMatch ? locationMatch[1] : null,
      postedAt: postedAtMatch ? postedAtMatch[1] : null,
      employmentType: null,
      easyApply: false,
      salaryText,
      summary: text.slice(0, 320) || title,
      description: text || title,
      url: href
    });

    if (jobs.length >= 120) {
      break;
    }
  }

  if (jobs.length === 0) {
    for (const anchor of anchors) {
      const rawHref = toAbsoluteUrl(anchor.getAttribute("href") || "");
      if (!rawHref || !/vssid=jobs-detail-viewer/i.test(rawHref)) {
        continue;
      }

      const text = normalize(anchor.innerText || anchor.textContent || "");
      if (!text || text.length < 20) {
        continue;
      }

      const widgetId = extractGoogleWidgetId(rawHref);
      if (!widgetId || seen.has(widgetId)) {
        continue;
      }
      seen.add(widgetId);

      const cleaned = text.replace(/^new\\s+/i, "").trim();
      const splitByVia = cleaned.split(" • via ");
      const left = normalize(splitByVia[0] || cleaned);
      const right = normalize(splitByVia[1] || "");
      const postedAtMatch = cleaned.match(
        /(\\d+\\s+(?:hour|day|week|month|year)s?\\s+ago|today|yesterday)/i
      );
      const locationMatch = left.match(
        /(san francisco, ca|new york, ny|remote|seattle, wa|austin, tx|los angeles, ca|california)/i
      );
      const salaryText = findSalaryText(cleaned);

      let company = right.replace(
        /(\\d+\\s+(?:hour|day|week|month|year)s?\\s+ago|today|yesterday|just posted)[\\s\\S]*$/i,
        ""
      ).trim();
      if (!company) {
        company = "Unknown company";
      }

      let title = left;
      if (company && company !== "Unknown company") {
        const lowerLeft = left.toLowerCase();
        const lowerCompany = company.toLowerCase();
        if (lowerLeft.endsWith(" " + lowerCompany)) {
          title = left.slice(0, left.length - company.length).trim();
        }
      }

      jobs.push({
        externalId: widgetId,
        title: title || left,
        company,
        location: locationMatch ? locationMatch[1] : null,
        postedAt: postedAtMatch ? postedAtMatch[1] : null,
        employmentType: null,
        easyApply: false,
        salaryText,
        summary: cleaned.slice(0, 320),
        description: cleaned,
        url: rawHref
      });

      if (jobs.length >= 120) {
        break;
      }
    }
  }

  return JSON.stringify({
    pageUrl: location.href,
    capturedAt: new Date().toISOString(),
    jobs
  });
})()
  `.trim();
}

function readGoogleJobsFromChrome(searchUrl, options = {}) {
  const extractionScript = buildGoogleBrowserExtractionScript();
  return readGenericBoardJobsFromChrome(searchUrl, extractionScript, options);
}

function buildAshbyExtractionScript() {
  return `
(() => {
  const normalize = (value) => typeof value === "string"
    ? value.replace(/\\s+/g, " ").trim()
    : "";

  const toAbsoluteUrl = (href) => {
    const value = normalize(href);
    if (!value) return "";
    try {
      return new URL(value, location.origin).toString();
    } catch {
      return value;
    }
  };

  const decodeGoogleRedirect = (href) => {
    const absolute = toAbsoluteUrl(href);
    if (!absolute) return "";
    try {
      const parsed = new URL(absolute);
      if (!/google\\./i.test(parsed.hostname)) {
        return absolute;
      }
      const redirect = parsed.searchParams.get("q") || parsed.searchParams.get("url");
      if (!redirect) {
        return absolute;
      }
      return toAbsoluteUrl(decodeURIComponent(redirect));
    } catch {
      return absolute;
    }
  };

  const extractExternalId = (url) => {
    const match = String(url || "").match(/\\/([a-f0-9]{24,}|[0-9]{5,})(?:[/?#]|$)/i);
    return match ? match[1] : "";
  };

  const titleLooksValid = (value) => {
    const text = normalize(value);
    if (!text || text.length < 4 || text.length > 220) {
      return false;
    }
    const lowered = text.toLowerCase();
    const blocked = new Set(["apply", "learn more", "view all", "all jobs", "careers", "home"]);
    if (blocked.has(lowered)) {
      return false;
    }
    return /[a-z]/i.test(text);
  };

  const companyFromUrl = (url) => {
    try {
      const parsed = new URL(url);
      if (parsed.hostname.toLowerCase() === "jobs.ashbyhq.com") {
        const segment = parsed.pathname.split("/").filter(Boolean)[0] || "";
        return normalize(segment.replace(/[-_]+/g, " "));
      }

      const hostPrefix = parsed.hostname.split(".")[0] || "";
      return normalize(hostPrefix.replace(/[-_]+/g, " "));
    } catch {
      return "";
    }
  };

  const jobs = [];
  const seen = new Set();

  const pushJob = ({
    title,
    company,
    location,
    postedAt,
    employmentType,
    salaryText,
    summary,
    description,
    url
  }) => {
    const normalizedTitle = normalize(title);
    const normalizedCompany = normalize(company);
    const normalizedUrl = toAbsoluteUrl(url).replace(/[?#].*$/, "");

    if (!titleLooksValid(normalizedTitle) || !normalizedCompany || !normalizedUrl) {
      return;
    }

    if (!/ashbyhq\\.com/i.test(normalizedUrl)) {
      return;
    }
    if (/\\/(privacy|security|disclosure|terms|blog|about|careers?)(?:[/?#]|$)/i.test(normalizedUrl)) {
      return;
    }

    try {
      const parsed = new URL(normalizedUrl);
      const host = parsed.hostname.toLowerCase();
      const segments = parsed.pathname.split("/").filter(Boolean);
      if (host === "ashbyhq.com" || host === "www.ashbyhq.com") {
        return;
      }
      if (host === "jobs.ashbyhq.com" && segments.length < 2) {
        return;
      }
    } catch {
      return;
    }

    const externalId = extractExternalId(normalizedUrl) || null;
    const dedupeKey = (externalId ? "ashby:" + externalId : normalizedUrl.toLowerCase());
    if (seen.has(dedupeKey)) {
      return;
    }
    seen.add(dedupeKey);

    const normalizedSummary = normalize(summary || description || normalizedTitle);
    const normalizedDescription = normalize(description || summary || normalizedTitle);

    jobs.push({
      externalId,
      title: normalizedTitle,
      company: normalizedCompany,
      location: normalize(location) || null,
      postedAt: normalize(postedAt) || null,
      employmentType: normalize(employmentType) || null,
      easyApply: false,
      salaryText: normalize(salaryText) || null,
      summary: normalizedSummary.slice(0, 500),
      description: normalizedDescription || normalizedSummary,
      url: normalizedUrl
    });
  };

  const pageTitle = normalize(document.title || "")
    .replace(/^jobs at\\s*/i, "")
    .replace(/^open roles at\\s*/i, "")
    .replace(/\\s*\\|.*$/, "");

  const nextData = document.querySelector('#__NEXT_DATA__');
  if (nextData && nextData.textContent) {
    try {
      const parsed = JSON.parse(nextData.textContent);
      const queue = [parsed];

      while (queue.length > 0) {
        const next = queue.shift();
        if (!next || typeof next !== "object") {
          continue;
        }

        if (Array.isArray(next)) {
          queue.push(...next);
          continue;
        }

        const title = normalize(next.title || next.name || next.jobTitle || "");
        const url = normalize(
          next.jobUrl ||
          next.absoluteUrl ||
          next.url ||
          next.applyUrl ||
          next.canonicalUrl ||
          next.slug ||
          next.jobSlug ||
          ""
        );

        if (title && url) {
          pushJob({
            title,
            company:
              normalize(
                next.companyName ||
                next.organizationName ||
                next.company ||
                next.organization ||
                pageTitle ||
                companyFromUrl(url)
              ) || "Unknown company",
            location: normalize(
              next.locationName ||
              next.location?.name ||
              next.location ||
              next.workplaceType ||
              ""
            ),
            postedAt: normalize(next.publishedAt || next.postedAt || next.createdAt || ""),
            employmentType: normalize(next.employmentType || next.commitment || ""),
            salaryText: normalize(next.salaryText || next.compensationText || ""),
            summary: normalize(next.summary || next.description || title),
            description: normalize(next.description || next.summary || title),
            url
          });
        }

        for (const value of Object.values(next)) {
          if (value && typeof value === "object") {
            queue.push(value);
          }
        }
      }
    } catch {
      // noop
    }
  }

  const anchors = Array.from(document.querySelectorAll("a[href]"));
  for (const anchor of anchors) {
    const hrefRaw = anchor.getAttribute("href") || "";
    const hrefResolved = decodeGoogleRedirect(hrefRaw);
    if (!/ashbyhq\\.com/i.test(hrefResolved)) {
      continue;
    }

    const title = normalize(anchor.innerText || anchor.textContent || "");
    if (!titleLooksValid(title)) {
      continue;
    }

    const card = anchor.closest("article, li, div") || anchor.parentElement;
    const text = normalize(card?.innerText || card?.textContent || "");
    const locationMatch = text.match(
      /(remote|hybrid|on-site|onsite|san francisco|new york|seattle|austin|los angeles|california|united states)/i
    );
    const postedAtMatch = text.match(
      /(\\d+\\s+(?:hour|day|week|month|year)s?\\s+ago|today|yesterday|just posted|reposted)/i
    );
    const employmentTypeMatch = text.match(
      /(full[- ]?time|part[- ]?time|contract|temporary|internship|freelance)/i
    );
    const salaryMatch = text.match(
      /(?:[$€£]\\s*\\d[\\d,]*(?:\\.\\d+)?(?:[kKmM])?(?:\\s*[-–]\\s*[$€£]?\\s*\\d[\\d,]*(?:\\.\\d+)?(?:[kKmM])?)?|\\b\\d{2,3}\\s*[Kk]\\s*[-–]\\s*\\d{2,3}\\s*[Kk]\\b)(?:\\s*(?:annually|yearly|monthly|weekly|hourly|per\\s+(?:year|yr|hour|hr)|\\/(?:year|yr|hour|hr)))?/i
    );

    pushJob({
      title,
      company: pageTitle || companyFromUrl(hrefResolved) || "Unknown company",
      location: locationMatch ? locationMatch[1] : "",
      postedAt: postedAtMatch ? postedAtMatch[1] : "",
      employmentType: employmentTypeMatch ? employmentTypeMatch[1] : "",
      salaryText: salaryMatch ? salaryMatch[0] : "",
      summary: text || title,
      description: text || title,
      url: hrefResolved
    });
  }

  return JSON.stringify({
    pageUrl: location.href,
    capturedAt: new Date().toISOString(),
    jobs
  });
})()
  `.trim();
}

function buildAshbyBoardDiscoveryScript() {
  return `
(() => {
  const normalize = (value) => typeof value === "string"
    ? value.replace(/\\s+/g, " ").trim()
    : "";

  const toAbsoluteUrl = (href) => {
    const value = normalize(href);
    if (!value) return "";
    try {
      return new URL(value, location.origin).toString();
    } catch {
      return value;
    }
  };

  const decodeGoogleRedirect = (href) => {
    const absolute = toAbsoluteUrl(href);
    if (!absolute) return "";
    try {
      const parsed = new URL(absolute);
      if (!/google\\./i.test(parsed.hostname)) {
        return absolute;
      }
      const redirect = parsed.searchParams.get("q") || parsed.searchParams.get("url");
      if (!redirect) {
        return absolute;
      }
      return toAbsoluteUrl(decodeURIComponent(redirect));
    } catch {
      return absolute;
    }
  };

  const toBoardUrl = (urlText) => {
    try {
      const parsed = new URL(String(urlText || "").trim());
      const host = parsed.hostname.toLowerCase();
      if (!host.endsWith("ashbyhq.com")) {
        return "";
      }

      if (host === "jobs.ashbyhq.com") {
        const segment = parsed.pathname.split("/").filter(Boolean)[0] || "";
        if (!segment) {
          return "";
        }
        return "https://jobs.ashbyhq.com/" + segment;
      }

      return parsed.protocol + "//" + parsed.hostname + "/";
    } catch {
      return "";
    }
  };

  const urls = new Set();
  const anchors = Array.from(document.querySelectorAll("a[href]"));
  for (const anchor of anchors) {
    const href = decodeGoogleRedirect(anchor.getAttribute("href") || "");
    if (!/ashbyhq\\.com/i.test(href)) {
      continue;
    }

    const boardUrl = toBoardUrl(href);
    if (boardUrl) {
      urls.add(boardUrl);
    }
  }

  return JSON.stringify({
    pageUrl: location.href,
    boardUrls: Array.from(urls)
  });
})()
  `.trim();
}

function isGoogleSearchUrl(searchUrl) {
  try {
    const parsed = new URL(String(searchUrl || "").trim());
    return /(^|\.)google\./i.test(parsed.hostname);
  } catch {
    return false;
  }
}

function resolveAshbyDiscoveryUrl(searchUrl) {
  if (isGoogleSearchUrl(searchUrl)) {
    return String(searchUrl || "").trim();
  }

  try {
    const parsed = new URL(String(searchUrl || "").trim());
    const host = parsed.hostname.toLowerCase();
    const query = String(parsed.searchParams.get("q") || "").trim();
    if (host === "jobs.ashbyhq.com" && parsed.pathname === "/" && query) {
      const params = new URLSearchParams({
        q: query,
        udm: "14"
      });
      return `https://www.google.com/search?${params.toString()}`;
    }
  } catch {
    return "";
  }

  return "";
}

function toAshbyBoardUrl(urlText) {
  try {
    const parsed = new URL(String(urlText || "").trim());
    const host = parsed.hostname.toLowerCase();
    if (!host.endsWith("ashbyhq.com")) {
      return "";
    }
    if (host === "ashbyhq.com" || host === "www.ashbyhq.com") {
      return "";
    }

    if (host === "jobs.ashbyhq.com") {
      const segment = parsed.pathname.split("/").filter(Boolean)[0] || "";
      if (
        !segment ||
        /^(privacy|security|disclosure|terms|blog|about|careers?)$/i.test(segment)
      ) {
        return "";
      }
      if (!segment) {
        return "";
      }

      return `https://jobs.ashbyhq.com/${segment}`;
    }

    return `${parsed.protocol}//${parsed.hostname}/`;
  } catch {
    return "";
  }
}

function parseBridgeJsonPayload(raw) {
  try {
    const payload = JSON.parse(raw);
    if (!payload || typeof payload !== "object") {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function buildLevelsFyiApiBodyScript() {
  return `
(() => {
  const body = document.body || document.documentElement;
  const text = body ? String(body.innerText || "") : "";
  return JSON.stringify({
    text
  });
})()
  `.trim();
}

function buildLevelsFyiNextDataScript() {
  return `
(() => {
  const el = document.getElementById("__NEXT_DATA__");
  return JSON.stringify({
    href: String(location.href || ""),
    title: String(document.title || ""),
    nextData: el ? String(el.textContent || "") : "",
  });
})()
  `.trim();
}

function runDetailEnrichment(source, jobs, options = {}) {
  const sourceType = String(source?.type || "").trim().toLowerCase();
  const sourceDefaultMaxJobs = sourceType === "linkedin_capture_file" ? 80 : 25;
  const detailEnrichMaxJobs =
    Number(options.detailEnrichMaxJobs) > 0
      ? Number(options.detailEnrichMaxJobs)
      : Number(source?.maxJobs) > 0
        ? Number(source.maxJobs)
        : sourceDefaultMaxJobs;
  const detailTimeoutMsDefault = sourceType === "linkedin_capture_file" ? 6_000 : 15_000;

  return enrichJobsWithDetailPages(source?.type, jobs, {
    maxJobs: detailEnrichMaxJobs,
    timeoutMs:
      Number(options.detailTimeoutMs) > 0
        ? Number(options.detailTimeoutMs)
        : detailTimeoutMsDefault
  });
}

function parseMaxAgeDaysFromSource(source) {
  try {
    const parsed = new URL(String(source?.searchUrl || "").trim());
    if (parsed.searchParams.has("fromage")) {
      const days = Number(parsed.searchParams.get("fromage"));
      return Number.isFinite(days) && days > 0 ? Math.round(days) : null;
    }
    if (parsed.searchParams.has("days")) {
      const days = Number(parsed.searchParams.get("days"));
      return Number.isFinite(days) && days > 0 ? Math.round(days) : null;
    }
    if (parsed.searchParams.has("f_TPR")) {
      const raw = String(parsed.searchParams.get("f_TPR") || "");
      const secondsMatch = raw.match(/^r(\\d+)$/i);
      if (secondsMatch) {
        const days = Math.max(1, Math.round(Number(secondsMatch[1]) / 86_400));
        return Number.isFinite(days) ? days : null;
      }
    }
    if (parsed.searchParams.has("tbs")) {
      const tbs = String(parsed.searchParams.get("tbs") || "");
      const qdrMatch = tbs.match(/qdr:([hdwmy])(\\d+)?/i);
      if (qdrMatch) {
        const unit = qdrMatch[1].toLowerCase();
        const qty = Number(qdrMatch[2] || "1");
        const factor =
          unit === "h" ? 1 / 24 : unit === "d" ? 1 : unit === "w" ? 7 : unit === "m" ? 30 : 365;
        const days = Math.max(1, Math.round(qty * factor));
        return Number.isFinite(days) ? days : null;
      }
    }
  } catch {
    return null;
  }

  return null;
}

function parseMinSalaryFromSource(source) {
  try {
    const parsed = new URL(String(source?.searchUrl || "").trim());
    const fromZip = Number(parsed.searchParams.get("refine_by_salary"));
    if (Number.isFinite(fromZip) && fromZip > 0) {
      return Math.round(fromZip);
    }

    const salaryType = String(parsed.searchParams.get("salaryType") || "");
    const salaryTypeDigits = salaryType.match(/(\\d[\\d,]{2,})/);
    if (salaryTypeDigits) {
      const parsedSalary = Number(salaryTypeDigits[1].replace(/,/g, ""));
      if (Number.isFinite(parsedSalary) && parsedSalary > 0) {
        return Math.round(parsedSalary);
      }
    }

    const query = String(parsed.searchParams.get("q") || "");
    const queryDigits = query.match(/\\$(\\d[\\d,]{2,})\\+?/);
    if (queryDigits) {
      const parsedSalary = Number(queryDigits[1].replace(/,/g, ""));
      if (Number.isFinite(parsedSalary) && parsedSalary > 0) {
        return Math.round(parsedSalary);
      }
    }
  } catch {
    return null;
  }

  return null;
}

function readLevelsFyiJobsFromChrome(searchUrl, options = {}) {
  const settleMs = Number(options.settleMs) > 0 ? Number(options.settleMs) : 2200;
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 20_000;
  const maxPages = Number(options.maxPages) > 0 ? Number(options.maxPages) : 12;
  const limitPerCompany = "25";
  const limit = Number(options.limit) > 0 ? Math.min(25, Number(options.limit)) : 25;
  const expectedStopBuffer = Number(options.expectedStopBuffer) > 0 ? Number(options.expectedStopBuffer) : 0;

  navigateAutomationTab(searchUrl, "Refreshing Levels.fyi source...");
  sleepSync(settleMs);

  const collected = [];
  const seen = new Set();
  const offsets = [];
  let expectedCount = null;
  let stopReason = "maxPages";
  let lastCount = 0;
  let apiFailures = 0;
  let usedFallback = false;
  let apiSample = null;
  let apiParsedKeys = null;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const offset = pageIndex * limit;
    offsets.push(offset);
    const apiUrl = buildLevelsFyiApiUrlFromSearchUrl(searchUrl, {
      offset: String(offset),
      limit: String(limit),
      limitPerCompany
    });
    let payloadWrapper = null;
    try {
      navigateAutomationTab(apiUrl, "Fetching Levels.fyi API...");
      sleepSync(900);
      const raw = executeInAutomationWindowFrontEncoded(
        buildLevelsFyiApiBodyScript(),
        timeoutMs
      );
      payloadWrapper = parseBridgeJsonPayload(raw);
    } catch (error) {
      apiFailures += 1;
      break;
    }

    if (!payloadWrapper || !payloadWrapper.text) {
      apiFailures += 1;
      break;
    }

    if (apiSample === null) {
      apiSample =
        typeof payloadWrapper.text === "string"
          ? payloadWrapper.text.slice(0, 400)
          : null;
    }
    const apiPayload = parseBridgeJsonPayload(payloadWrapper.text);
    if (!apiPayload) {
      apiFailures += 1;
      break;
    }
    if (apiParsedKeys === null && apiPayload && typeof apiPayload === "object") {
      apiParsedKeys = Object.keys(apiPayload).slice(0, 8);
    }

    if (expectedCount === null) {
      const parsedExpected = Number(apiPayload.totalMatchingJobs || apiPayload.total || null);
      if (Number.isFinite(parsedExpected) && parsedExpected > 0) {
        expectedCount = Math.round(parsedExpected);
      }
    }

    const pageJobs = parseLevelsFyiSearchPayload(apiPayload, searchUrl);
    if (!Array.isArray(pageJobs) || pageJobs.length === 0) {
      stopReason = "emptyPage";
      break;
    }

    for (const job of pageJobs) {
      const key = String(job?.externalId || "").trim();
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      collected.push(job);
    }

    if (collected.length === lastCount) {
      stopReason = "noGrowth";
      break;
    }
    lastCount = collected.length;

    if (
      Number.isFinite(expectedCount) &&
      expectedCount > 0 &&
      collected.length + expectedStopBuffer >= expectedCount
    ) {
      stopReason = "expectedCount";
      break;
    }
  }

  if (collected.length === 0) {
    navigateAutomationTab(searchUrl, "Refreshing Levels.fyi source...");
    sleepSync(settleMs);
    const raw = executeInAutomationWindowFrontEncoded(
      buildLevelsFyiNextDataScript(),
      timeoutMs
    );
    const payload = parseBridgeJsonPayload(raw);
    if (payload?.nextData) {
      usedFallback = true;
      const html = `<script id="__NEXT_DATA__" type="application/json">${payload.nextData}</script>`;
      const fallbackJobs = parseLevelsFyiSearchHtml(html, searchUrl);
      for (const job of Array.isArray(fallbackJobs) ? fallbackJobs : []) {
        const key = String(job?.externalId || "").trim();
        if (!key || seen.has(key)) {
          continue;
        }
        seen.add(key);
        collected.push(job);
      }
      try {
        const parsed = JSON.parse(payload.nextData);
        const total =
          parsed?.props?.pageProps?.initialJobsData?.totalMatchingJobs ||
          parsed?.props?.pageProps?.initialJobsData?.total ||
          null;
        if (Number.isFinite(Number(total)) && Number(total) > 0) {
          expectedCount = Math.round(Number(total));
        }
      } catch {}
    }
  }

  return {
    pageUrl: searchUrl,
    capturedAt: new Date().toISOString(),
    expectedCount,
    jobs: collected,
    captureDiagnostics: {
      offsets,
      expectedCount,
      apiFailures,
      apiFetchMode: "navigate",
      apiSample,
      apiParsedKeys,
      stopReason,
      usedFallback
    }
  };
}

function applySearchFilterInferences(source, jobs) {
  const maxAgeDays = parseMaxAgeDaysFromSource(source);
  const minSalary = parseMinSalaryFromSource(source);
  if (!maxAgeDays && !minSalary) {
    return Array.isArray(jobs) ? jobs : [];
  }

  const sourceType = String(source?.type || "").trim().toLowerCase();
  const allowPostedInference = new Set([
    "indeed_search",
    "ziprecruiter_search",
    "google_search",
    "ashby_search"
  ]);
  const allowSalaryInference = new Set(["ziprecruiter_search", "google_search"]);
  const inferredPostedText = maxAgeDays ? `within ${maxAgeDays} days (search filter)` : "";
  const inferredSalaryText = minSalary ? `>= $${minSalary.toLocaleString()} (search filter)` : "";

  return (Array.isArray(jobs) ? jobs : []).map((job) => {
    if (!job || typeof job !== "object") {
      return job;
    }

    const provenance =
      job.extractorProvenance && typeof job.extractorProvenance === "object"
        ? { ...job.extractorProvenance }
        : {};
    const next = { ...job };
    const hasPostedAt = String(job.postedAt || "").trim() && String(job.postedAt || "").toLowerCase() !== "unknown";
    const hasSalary = String(job.salaryText || "").trim() && String(job.salaryText || "").toLowerCase() !== "unknown";

    if (!hasPostedAt && inferredPostedText && allowPostedInference.has(sourceType)) {
      next.postedAt = inferredPostedText;
      provenance.postedAt = "inferred_search_filter";
    }
    if (!hasSalary && inferredSalaryText && allowSalaryInference.has(sourceType)) {
      next.salaryText = inferredSalaryText;
      provenance.salaryText = "inferred_search_filter";
    }

    if (Object.keys(provenance).length > 0) {
      next.extractorProvenance = provenance;
    }

    return next;
  });
}

function runExtractionAttempts(
  extractionScript,
  maxAttempts,
  attemptDelayMs,
  timeoutMs
) {
  let lastPayload = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const raw = executeInAutomationTab(extractionScript, timeoutMs);
    const payload = parseBridgeJsonPayload(raw);

    if (
      payload &&
      (Array.isArray(payload.jobs) || Array.isArray(payload.rowSnapshots))
    ) {
      lastPayload = payload;
      const resultCount = Array.isArray(payload.jobs)
        ? payload.jobs.length
        : Array.isArray(payload.rowSnapshots)
          ? payload.rowSnapshots.length
          : 0;
      if (resultCount > 0) {
        return payload;
      }
    }

    sleepSync(attemptDelayMs);
  }

  return lastPayload;
}

function dedupeAshbyJobs(jobs) {
  const deduped = new Map();

  for (const job of Array.isArray(jobs) ? jobs : []) {
    if (!job || typeof job !== "object") {
      continue;
    }

    const key = String(job.externalId || job.url || "").toLowerCase();
    if (!key) {
      continue;
    }

    if (!deduped.has(key)) {
      deduped.set(key, job);
    }
  }

  return Array.from(deduped.values());
}

function readAshbyJobsFromChrome(searchUrl, options = {}) {
  navigateAutomationTab(searchUrl, "Refreshing Ashby source...");

  const settleMs = Number(options.settleMs) > 0 ? Number(options.settleMs) : 3000;
  const maxAttempts = Number(options.maxAttempts) > 0 ? Number(options.maxAttempts) : 6;
  const attemptDelayMs =
    Number(options.attemptDelayMs) > 0 ? Number(options.attemptDelayMs) : 1200;
  const extractionScript = buildAshbyExtractionScript();
  const boardDiscoveryScript = buildAshbyBoardDiscoveryScript();
  const boardSettleMs =
    Number(options.boardSettleMs) > 0 ? Number(options.boardSettleMs) : 2200;
  const boardMaxAttempts =
    Number(options.boardMaxAttempts) > 0 ? Number(options.boardMaxAttempts) : 4;
  const maxBoards = Number(options.maxBoards) > 0 ? Number(options.maxBoards) : 12;

  sleepSync(settleMs);

  const initialPayload = runExtractionAttempts(
    extractionScript,
    maxAttempts,
    attemptDelayMs
  );
  const collectedJobs = Array.isArray(initialPayload?.jobs) ? [...initialPayload.jobs] : [];
  const discoveryUrl = resolveAshbyDiscoveryUrl(searchUrl);
  if (discoveryUrl && discoveryUrl !== searchUrl) {
    collectedJobs.length = 0;
    navigateAutomationTab(discoveryUrl, "Refreshing Ashby discovery...");
    sleepSync(boardSettleMs);
  }

  if (isGoogleSearchUrl(searchUrl) || Boolean(discoveryUrl)) {
    const boardPayload = parseBridgeJsonPayload(
      executeInAutomationTab(boardDiscoveryScript)
    );
    const boardUrlSet = new Set();

    for (const job of collectedJobs) {
      const boardUrl = toAshbyBoardUrl(job?.url);
      if (boardUrl) {
        boardUrlSet.add(boardUrl);
      }
    }

    for (const url of Array.isArray(boardPayload?.boardUrls)
      ? boardPayload.boardUrls
      : []) {
      const boardUrl = toAshbyBoardUrl(url);
      if (boardUrl) {
        boardUrlSet.add(boardUrl);
      }
    }

    const boardUrls = Array.from(boardUrlSet).slice(0, maxBoards);
    for (const boardUrl of boardUrls) {
      navigateAutomationTab(boardUrl, "Refreshing Ashby board...");
      sleepSync(boardSettleMs);

      const boardJobsPayload = runExtractionAttempts(
        extractionScript,
        boardMaxAttempts,
        attemptDelayMs
      );
      if (Array.isArray(boardJobsPayload?.jobs) && boardJobsPayload.jobs.length > 0) {
        collectedJobs.push(...boardJobsPayload.jobs);
      }
    }
  }

  const dedupedJobs = dedupeAshbyJobs(collectedJobs);
  if (dedupedJobs.length > 0 || initialPayload) {
    return {
      pageUrl: searchUrl,
      capturedAt: new Date().toISOString(),
      jobs: dedupedJobs
    };
  }

  throw new Error("Could not extract Ashby jobs from the active Chrome tab.");
}

function buildYcExtractionScript() {
  return `
(() => {
  try {
    const jobCards = (() => {
      const anchors = Array.from(document.querySelectorAll("a[href]"));
      const jobs = new Map();
      const jobIds = [];
      for (const anchor of anchors) {
        const href = anchor.getAttribute("href");
        if (!href || !href.includes("/jobs/")) continue;
        const match = href.match(/\\/jobs\\/(\\d+)/);
        if (!match) continue;
        const jobId = match[1];
        const absolute = href.startsWith("http") ? href : String(location.origin || "") + href;
        if (jobs.has(absolute)) continue;
        if (jobId) jobIds.push(jobId);
        let card =
          anchor.closest("div.w-full") ||
          anchor.closest("div.job-card") ||
          anchor.closest("div");
        if (card) {
          let parent = card.parentElement;
          for (let i = 0; i < 6 && parent; i += 1) {
            const hasJob = parent.querySelector("a[href*='/jobs/']");
            const hasCompany = parent.querySelector(
              "a[href^='/companies/'], a[href^='https://www.workatastartup.com/companies/']"
            );
            if (hasJob && hasCompany) {
              card = parent;
              break;
            }
            parent = parent.parentElement;
          }
        }
        const companyEl =
          card?.querySelector("a[href^='/companies/']") ||
          card?.querySelector("a[href^='https://www.workatastartup.com/companies/']");
        jobs.set(absolute, {
          href: absolute,
          title: String(anchor.textContent || "").trim(),
          company: String(companyEl?.textContent || "").trim(),
          companyUrl: String(companyEl?.getAttribute("href") || ""),
          cardText: String(card?.innerText || anchor.textContent || "").trim()
        });
      }
      return {
        cards: Array.from(jobs.values()),
        jobIds: Array.from(new Set(jobIds))
      };
    })();
    const matchingCount = (() => {
      const text = String(document.body?.innerText || "");
      const match = text.match(/showing\\s+(\\d+)\\s+matching startups/i);
      if (!match) return null;
      const parsed = Number.parseInt(match[1], 10);
      return Number.isFinite(parsed) ? parsed : null;
    })();
    return JSON.stringify({
      href: String(location.href || ""),
      title: String(document.title || ""),
      jobCards: jobCards.cards,
      jobIds: jobCards.jobIds,
      jobCardsCount: jobCards.cards.length,
      jobCardsSample: jobCards.cards.slice(0, 3),
      jobCardsJobsSample: jobCards.cards
        .filter((card) => /jobs/i.test(String(card?.title || "")))
        .slice(0, 3),
      matchingCount
    });
  } catch (error) {
    return JSON.stringify({
      error: String(error || "unknown"),
      href: String(location?.href || ""),
      title: String(document?.title || "")
    });
  }
})()
`;
}

function readYcJobsFromChrome(searchUrl, options = {}) {
  const settleMs = Number(options.settleMs) > 0 ? Number(options.settleMs) : 2500;
  const maxAttempts = Number(options.maxAttempts) > 0 ? Number(options.maxAttempts) : 5;
  const attemptDelayMs =
    Number(options.attemptDelayMs) > 0 ? Number(options.attemptDelayMs) : 1200;
  const timeoutMs =
    Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 20_000;
  const maxScrollPasses =
    Number(options.maxScrollPasses) > 0 ? Number(options.maxScrollPasses) : 12;
  const maxJobs = Number(options.maxJobs) > 0 ? Number(options.maxJobs) : null;
  const recencyFraction =
    Number(options.recencyFraction) > 0 ? Number(options.recencyFraction) : 1;
  let targetCount =
    Number(options.targetCount) > 0 ? Number(options.targetCount) : null;
  const extractionScript = buildYcExtractionScript();
  const scrollScript = `
(() => {
  const el = document.scrollingElement || document.documentElement || document.body;
  const before = el ? el.scrollTop : 0;
  if (el) {
    el.scrollBy(0, Math.max(window.innerHeight * 0.9, 600));
  }
  const after = el ? el.scrollTop : 0;
  return JSON.stringify({
    before,
    after,
    height: el ? el.scrollHeight : 0
  });
})()
`;
  const ycUrlNeedle = "workatastartup.com/companies";
  const matchingTabs = listTabUrlsMatchingSubstring(ycUrlNeedle, 12);
  const shouldUseAutomationWindow = true;

  if (shouldUseAutomationWindow) {
    navigateAutomationTab(searchUrl, "Refreshing YC Jobs source...");
  }

  sleepSync(settleMs);

  let lastPayload = null;
  let lastResult = null;
  let lastJobIdsCount = 0;
  let noGrowthPasses = 0;
  let matchingCount = null;
  let scrollPasses = 0;
  let stopReason = "maxScrollPasses";

  const runExtractionOnce = () => {
    let rawPayload = null;
    try {
      rawPayload = shouldUseAutomationWindow
        ? executeInAutomationWindowFront(extractionScript, timeoutMs)
        : executeInMatchingTabWithActivation(
            extractionScript,
            ycUrlNeedle,
            timeoutMs
          );
    } catch (error) {
      const diagnostics = {
        jobCardsCount: null,
        jobCardsSample: null,
        jobCardsJobsSample: null,
        jobIdsCount: null,
        matchingCount: null,
        dataPagePresent: false,
        dataPageSize: null,
        isLoggedIn: null,
        error: String(error || "execute_failed"),
        domStats: null,
        parseFailed: true,
        rawLength: null,
        rawSample: null,
        matchingTabsCount: matchingTabs.length,
        matchingTabsSample: matchingTabs.slice(0, 5),
        usedAutomationWindow: shouldUseAutomationWindow,
        recencyFraction,
        targetCount,
        scrollPasses
      };
      return {
        payload: null,
        result: {
          pageUrl: searchUrl,
          capturedAt: new Date().toISOString(),
          expectedCount: 0,
          jobs: [],
          captureDiagnostics: diagnostics
        },
        jobs: [],
        diagnostics
      };
    }
    const payload = parseBridgeJsonPayload(rawPayload);
    const jobIdsCount = Array.isArray(payload?.jobIds) ? payload.jobIds.length : 0;
    const diagnostics = {
      jobCardsCount: payload?.jobCardsCount ?? null,
      jobCardsSample: payload?.jobCardsSample ?? null,
      jobCardsJobsSample: payload?.jobCardsJobsSample ?? null,
      jobIdsCount,
      matchingCount: payload?.matchingCount ?? null,
      dataPagePresent: Boolean(String(payload?.dataPage || "").trim()),
      dataPageSize: payload?.dataPageSize ?? null,
      isLoggedIn: payload?.isLoggedIn ?? null,
      error: payload?.error ?? null,
      domStats: payload?.domStats ?? null,
      parseFailed: !payload,
      rawLength: typeof rawPayload === "string" ? rawPayload.length : null,
      rawSample:
        typeof rawPayload === "string" ? rawPayload.slice(0, 400) : null,
      matchingTabsCount: matchingTabs.length,
      matchingTabsSample: matchingTabs.slice(0, 5),
      usedAutomationWindow: shouldUseAutomationWindow,
      recencyFraction,
      targetCount,
      scrollPasses
    };
    const pageUrl = String(payload?.href || searchUrl);
    const capturedAt = new Date().toISOString();

    let jobs = [];
    if (String(payload?.dataPage || "").trim()) {
      jobs = parseYcJobsPayload(payload.dataPage, searchUrl);
    }

    if (Array.isArray(payload?.jobCards) && payload.jobCards.length > 0) {
      jobs = parseYcJobsPayload(payload.jobCards, { searchUrl, domCards: true });
    }

    const result = {
      pageUrl,
      capturedAt,
      expectedCount: jobs.length,
      jobs,
      captureDiagnostics: diagnostics,
      jobCardsCount: diagnostics.jobCardsCount,
      dataPagePresent: diagnostics.dataPagePresent,
      domStats: diagnostics.domStats,
      isLoggedIn: diagnostics.isLoggedIn,
      parseFailed: diagnostics.parseFailed,
      rawLength: diagnostics.rawLength,
      rawSample: diagnostics.rawSample
    };

    return { payload, result, jobs, diagnostics };
  };

  for (let pass = 0; pass < maxScrollPasses; pass += 1) {
    let attemptResult = null;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      attemptResult = runExtractionOnce();
      if (attemptResult.jobs.length > 0 || attempt === maxAttempts - 1) {
        break;
      }
      sleepSync(attemptDelayMs);
    }

    if (!attemptResult) {
      break;
    }

    const payload = attemptResult.payload;
    const jobs = attemptResult.jobs;
    const diagnostics = attemptResult.diagnostics;
    lastPayload = payload;
    lastResult = attemptResult.result;

    if (process.env.JOB_FINDER_DEBUG_YC) {
      console.log("YC diagnostics", JSON.stringify(diagnostics, null, 2));
    }

    if (matchingCount === null && Number.isFinite(payload?.matchingCount)) {
      matchingCount = payload.matchingCount;
    }

    if (!targetCount && Number.isFinite(matchingCount) && matchingCount > 0) {
      targetCount = Math.ceil(matchingCount * recencyFraction);
      if (maxJobs && maxJobs > 0) {
        targetCount = Math.min(targetCount, maxJobs);
      }
    } else if (!targetCount && maxJobs && maxJobs > 0) {
      targetCount = maxJobs;
    }

    const jobIdsCount = diagnostics.jobIdsCount ?? jobs.length;
    if (targetCount && jobIdsCount >= targetCount) {
      stopReason = "targetReached";
      lastResult.captureDiagnostics.targetCount = targetCount;
      lastResult.captureDiagnostics.recencyFraction = recencyFraction;
      lastResult.captureDiagnostics.matchingCount = matchingCount;
      lastResult.captureDiagnostics.jobIdsCount = jobIdsCount;
      lastResult.captureDiagnostics.scrollPasses = scrollPasses;
      lastResult.captureDiagnostics.stopReason = stopReason;
      return lastResult;
    }

    if (jobIdsCount <= lastJobIdsCount) {
      noGrowthPasses += 1;
    } else {
      noGrowthPasses = 0;
      lastJobIdsCount = jobIdsCount;
    }

    if (noGrowthPasses >= 2) {
      stopReason = "noGrowth";
      break;
    }

    scrollPasses += 1;
    try {
      if (shouldUseAutomationWindow) {
        executeInAutomationWindowFront(scrollScript, timeoutMs);
      } else {
        executeInMatchingTabWithActivation(scrollScript, ycUrlNeedle, timeoutMs);
      }
    } catch {}
    sleepSync(attemptDelayMs);
  }

  if (lastResult) {
    const diagnostics = lastResult.captureDiagnostics;
    if (
      diagnostics &&
      diagnostics.isLoggedIn === false
    ) {
      throw new Error(
        "YC Jobs requires a logged-in Work at a Startup session in the automation window."
      );
    }
    if (
      diagnostics &&
      diagnostics.dataPagePresent &&
      Number(diagnostics.jobCardsCount || 0) === 0
    ) {
      throw new Error(
        "YC Jobs page loaded but no job links were found. The automation window may not be logged in to Work at a Startup."
      );
    }
    diagnostics.targetCount = targetCount;
    diagnostics.recencyFraction = recencyFraction;
    diagnostics.matchingCount = matchingCount;
    diagnostics.jobIdsCount = diagnostics.jobIdsCount ?? lastJobIdsCount;
    diagnostics.scrollPasses = scrollPasses;
    diagnostics.stopReason = stopReason;
    return lastResult;
  }

  throw new Error(
    `Could not extract YC jobs from the active Chrome tab.${lastPayload?.title ? ` Last title: ${lastPayload.title}` : ""}`
  );
}

export function captureLinkedInSourceWithChromeAppleScript(
  source,
  _snapshotPath,
  options = {}
) {
  if (!source || source.type !== "linkedin_capture_file") {
    throw new Error("Chrome AppleScript capture requires a linkedin_capture_file source.");
  }

  const startedAt = new Date().toISOString();
  const payload = readLinkedInJobsFromChrome(source.searchUrl, {
    ...options,
    timeoutMs:
      Number(source.timeoutMs) > 0
        ? Number(source.timeoutMs)
        : Number(options.timeoutMs) > 0
          ? Number(options.timeoutMs)
          : 60_000,
    maxPages: Number(source.maxPages) > 0 ? Number(source.maxPages) : options.maxPages,
    maxScrollSteps:
      Number(source.maxScrollSteps) > 0
        ? Number(source.maxScrollSteps)
        : options.maxScrollSteps,
    maxIdleScrollSteps:
      Number(source.maxIdleScrollSteps) > 0
        ? Number(source.maxIdleScrollSteps)
        : options.maxIdleScrollSteps
  });
  const enrichedJobs = applySearchFilterInferences(source, payload.jobs);
  const telemetry = buildCaptureTelemetry(source, payload, {
    startedAt,
    tabInfo: readAutomationTabInfo()
  });
  if (payload.captureDiagnostics) {
    telemetry.captureDiagnostics = payload.captureDiagnostics;
  }

  return {
    ...writeLinkedInCaptureFile(source, enrichedJobs, {
      capturedAt: payload.capturedAt,
      pageUrl: payload.pageUrl,
      expectedCount: payload.expectedCount,
      captureDiagnostics: payload.captureDiagnostics,
      captureTelemetry: telemetry
    }),
    provider: "chrome_applescript",
    status: "completed"
  };
}

export function captureYcSourceWithChromeAppleScript(
  source,
  _snapshotPath,
  options = {}
) {
  if (!source || source.type !== "yc_jobs") {
    throw new Error("Chrome AppleScript capture requires a yc_jobs source.");
  }

  const startedAt = new Date().toISOString();
  const globalCriteria = loadSearchCriteria().criteria;
  const recencyFraction = resolveYcRecencyFraction(source, globalCriteria);
  const payload = readYcJobsFromChrome(source.searchUrl, {
    ...options,
    maxJobs: Number(source.maxJobs) > 0 ? Number(source.maxJobs) : options.maxJobs,
    recencyFraction
  });
  if (process.env.JOB_FINDER_DEBUG_YC) {
    console.log(
      "YC payload debug",
      JSON.stringify(
        {
          jobCardsCount: payload.jobCardsCount,
          dataPagePresent: payload.dataPagePresent,
          captureDiagnostics: payload.captureDiagnostics
        },
        null,
        2
      )
    );
  }
  const enrichedJobs = applySearchFilterInferences(source, payload.jobs);
  const captureDiagnostics =
    payload.captureDiagnostics || {
      jobCardsCount: payload.jobCardsCount ?? null,
      dataPagePresent: payload.dataPagePresent ?? null,
      domStats: payload.domStats ?? null,
      isLoggedIn: payload.isLoggedIn ?? null,
      error: payload.error ?? null,
      parseFailed: payload.parseFailed ?? null,
      rawLength: payload.rawLength ?? null,
      rawSample: payload.rawSample ?? null
    };
  const telemetry = buildCaptureTelemetry(source, payload, {
    startedAt,
    tabInfo: readAutomationTabInfo()
  });
  if (captureDiagnostics) {
    telemetry.captureDiagnostics = captureDiagnostics;
  }

  return {
    ...writeYcCaptureFile(source, enrichedJobs, {
      capturedAt: payload.capturedAt,
      pageUrl: payload.pageUrl,
      expectedCount: payload.expectedCount,
      captureDiagnostics,
      captureTelemetry: telemetry
    }),
    provider: "chrome_applescript",
    status: "completed"
  };
}

export function captureWellfoundSourceWithChromeAppleScript(
  source,
  _snapshotPath,
  options = {}
) {
  if (!source || source.type !== "wellfound_search") {
    throw new Error("Chrome AppleScript capture requires a wellfound_search source.");
  }

  const startedAt = new Date().toISOString();
  const payload = readWellfoundJobsFromChrome(source.searchUrl, options);
  const enrichedJobs = applySearchFilterInferences(
    source,
    runDetailEnrichment(source, payload.jobs, options)
  );
  const telemetry = buildCaptureTelemetry(source, payload, {
    startedAt,
    tabInfo: readAutomationTabInfo()
  });

  return {
    ...writeWellfoundCaptureFile(source, enrichedJobs, {
      capturedAt: payload.capturedAt,
      pageUrl: payload.pageUrl,
      expectedCount: payload.expectedCount,
      captureTelemetry: telemetry
    }),
    provider: "chrome_applescript",
    status: "completed"
  };
}

export function captureAshbySourceWithChromeAppleScript(
  source,
  _snapshotPath,
  options = {}
) {
  if (!source || source.type !== "ashby_search") {
    throw new Error("Chrome AppleScript capture requires an ashby_search source.");
  }

  const startedAt = new Date().toISOString();
  const payload = readAshbyJobsFromChrome(source.searchUrl, {
    ...options,
    maxBoards: Number(source.maxBoards) > 0 ? Number(source.maxBoards) : options.maxBoards
  });
  const enrichedJobs = applySearchFilterInferences(
    source,
    runDetailEnrichment(source, payload.jobs, options)
  );
  const telemetry = buildCaptureTelemetry(source, payload, {
    startedAt,
    tabInfo: readAutomationTabInfo()
  });

  return {
    ...writeAshbyCaptureFile(source, enrichedJobs, {
      capturedAt: payload.capturedAt,
      pageUrl: payload.pageUrl,
      expectedCount: payload.expectedCount,
      captureTelemetry: telemetry
    }),
    provider: "chrome_applescript",
    status: "completed"
  };
}

export function captureIndeedSourceWithChromeAppleScript(
  source,
  _snapshotPath,
  options = {}
) {
  if (!source || source.type !== "indeed_search") {
    throw new Error("Chrome AppleScript capture requires an indeed_search source.");
  }

  const nativeFilterState = getIndeedNativeFilterState(source);
  const startedAt = new Date().toISOString();
  const payload = readIndeedJobsFromChrome(source.searchUrl, {
    ...options,
    nativeFilterState,
    maxPages: Number(source.maxPages) > 0 ? Number(source.maxPages) : options.maxPages
  });
  const enrichedJobs = filterIndeedCapturedJobs(
    applySearchFilterInferences(
      source,
      runDetailEnrichment(source, payload.jobs, options)
    )
  );
  const telemetry = buildCaptureTelemetry(source, payload, {
    startedAt,
    tabInfo: readAutomationTabInfo()
  });

  return {
    ...writeIndeedCaptureFile(source, enrichedJobs, {
      capturedAt: payload.capturedAt,
      pageUrl: payload.pageUrl,
      expectedCount: payload.expectedCount,
      captureDiagnostics: payload.captureDiagnostics || nativeFilterState,
      captureTelemetry: telemetry
    }),
    provider: "chrome_applescript",
    status: "completed"
  };
}

export function captureGoogleSourceWithChromeAppleScript(
  source,
  _snapshotPath,
  options = {}
) {
  if (!source || source.type !== "google_search") {
    throw new Error("Chrome AppleScript capture requires a google_search source.");
  }

  const startedAt = new Date().toISOString();
  const payload = readGoogleJobsFromChrome(source.searchUrl, options);
  const enrichedJobs = applySearchFilterInferences(
    source,
    runDetailEnrichment(source, payload.jobs, options)
  );
  const telemetry = buildCaptureTelemetry(source, payload, {
    startedAt,
    tabInfo: readAutomationTabInfo()
  });

  return {
    ...writeGoogleCaptureFile(source, enrichedJobs, {
      capturedAt: payload.capturedAt,
      pageUrl: payload.pageUrl,
      expectedCount: payload.expectedCount,
      captureTelemetry: telemetry
    }),
    provider: "chrome_applescript",
    status: "completed"
  };
}

export function captureZipRecruiterSourceWithChromeAppleScript(
  source,
  _snapshotPath,
  options = {}
) {
  if (!source || source.type !== "ziprecruiter_search") {
    throw new Error("Chrome AppleScript capture requires a ziprecruiter_search source.");
  }

  const startedAt = new Date().toISOString();
  const payload = readZipRecruiterJobsFromChrome(source.searchUrl, {
    ...options,
    timeoutMs:
      Number(source.timeoutMs) > 0
        ? Number(source.timeoutMs)
        : Number(options.timeoutMs) > 0
          ? Number(options.timeoutMs)
          : 30_000,
    maxPages: Number(source.maxPages) > 0 ? Number(source.maxPages) : options.maxPages
  });
  const enrichedJobs = applySearchFilterInferences(
    source,
    runDetailEnrichment(source, payload.jobs, options)
  );
  const telemetry = buildCaptureTelemetry(source, payload, {
    startedAt,
    tabInfo: readAutomationTabInfo()
  });

  return {
    ...writeZipRecruiterCaptureFile(source, enrichedJobs, {
      capturedAt: payload.capturedAt,
      pageUrl: payload.pageUrl,
      expectedCount: payload.expectedCount,
      captureTelemetry: telemetry
    }),
    provider: "chrome_applescript",
    status: "completed"
  };
}

export function captureLevelsFyiSourceWithChromeAppleScript(
  source,
  _snapshotPath,
  options = {}
) {
  if (!source || source.type !== "levelsfyi_search") {
    throw new Error("Chrome AppleScript capture requires a levelsfyi_search source.");
  }

  const startedAt = new Date().toISOString();
  const payload = readLevelsFyiJobsFromChrome(source.searchUrl, {
    ...options,
    maxPages: Number(source.maxPages) > 0 ? Number(source.maxPages) : options.maxPages
  });
  const enrichedJobs = applySearchFilterInferences(source, payload.jobs);
  const telemetry = buildCaptureTelemetry(source, payload, {
    startedAt,
    tabInfo: readAutomationTabInfo()
  });

  if (payload.captureDiagnostics) {
    telemetry.captureDiagnostics = payload.captureDiagnostics;
  }

  return {
    ...writeLevelsFyiCaptureFile(source, enrichedJobs, {
      capturedAt: payload.capturedAt,
      pageUrl: payload.pageUrl,
      expectedCount: payload.expectedCount,
      captureDiagnostics: payload.captureDiagnostics,
      captureTelemetry: telemetry
    }),
    provider: "chrome_applescript",
    status: "completed"
  };
}

export function captureRemoteOkSourceWithChromeAppleScript(
  source,
  _snapshotPath,
  options = {}
) {
  if (!source || source.type !== "remoteok_search") {
    throw new Error("Chrome AppleScript capture requires a remoteok_search source.");
  }

  const startedAt = new Date().toISOString();
  const payload = readRemoteOkJobsFromChrome(source.searchUrl, options);
  const telemetry = buildCaptureTelemetry(source, payload, {
    startedAt,
    tabInfo: readAutomationTabInfo()
  });

  return {
    ...writeRemoteOkCaptureFile(source, payload.jobs, {
      capturedAt: payload.capturedAt,
      pageUrl: payload.pageUrl,
      expectedCount: payload.expectedCount,
      captureTelemetry: telemetry
    }),
    provider: "chrome_applescript",
    status: "completed"
  };
}

export function captureSourceWithChromeAppleScript(source, snapshotPath, options = {}) {
  if (source?.type === "linkedin_capture_file") {
    return captureLinkedInSourceWithChromeAppleScript(source, snapshotPath, options);
  }

  if (source?.type === "wellfound_search") {
    return captureWellfoundSourceWithChromeAppleScript(source, snapshotPath, options);
  }

  if (source?.type === "ashby_search") {
    return captureAshbySourceWithChromeAppleScript(source, snapshotPath, options);
  }

  if (source?.type === "google_search") {
    return captureGoogleSourceWithChromeAppleScript(source, snapshotPath, options);
  }

  if (source?.type === "indeed_search") {
    return captureIndeedSourceWithChromeAppleScript(source, snapshotPath, options);
  }

  if (source?.type === "ziprecruiter_search") {
    return captureZipRecruiterSourceWithChromeAppleScript(source, snapshotPath, options);
  }

  if (source?.type === "levelsfyi_search") {
    return captureLevelsFyiSourceWithChromeAppleScript(source, snapshotPath, options);
  }

  if (source?.type === "yc_jobs") {
    return captureYcSourceWithChromeAppleScript(source, snapshotPath, options);
  }

  if (source?.type === "remoteok_search") {
    return captureRemoteOkSourceWithChromeAppleScript(source, snapshotPath, options);
  }

  throw new Error(
    `Chrome AppleScript provider currently supports linkedin_capture_file, wellfound_search, ashby_search, google_search, indeed_search, ziprecruiter_search, levelsfyi_search, yc_jobs, and remoteok_search. "${source?.name || "unknown"}" is ${source?.type || "unknown"}.`
  );
}
