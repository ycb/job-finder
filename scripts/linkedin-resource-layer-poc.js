import { spawnSync } from "node:child_process";

import { extractLinkedInStructuredJobsFromResponseBody } from "../src/sources/linkedin-structured-payload.js";

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

function snapshotResourceUrls(windowId) {
  const js = [
    "(() => {",
    "  const names = performance.getEntriesByType('resource')",
    "    .map((entry) => String(entry.name || ''))",
    "    .filter((name) => /voyagerJobsDashJobCards/i.test(name));",
    "  return JSON.stringify({",
    "    href: String(location.href || ''),",
    "    title: String(document.title || ''),",
    "    resourceNames: Array.from(new Set(names))",
    "  });",
    "})()"
  ].join("");
  return JSON.parse(executeInChromeWindow(windowId, js));
}

function fetchResourceBody(windowId, resourceUrl) {
  const js = [
    "(() => {",
    `  const url = ${JSON.stringify(resourceUrl)};`,
    "  const csrfFromCookie = (() => {",
    "    const match = document.cookie.match(/(?:^|;\\s*)JSESSIONID=\"?([^\"]+)\"?/);",
    "    return match ? match[1] : '';",
    "  })();",
    "  const csrfFromMeta = document.querySelector('meta[name=\"csrf-token\"]')?.getAttribute('content') || '';",
    "  const csrfToken = csrfFromMeta || csrfFromCookie;",
    "  const request = new XMLHttpRequest();",
    "  request.open('GET', url, false);",
    "  request.withCredentials = true;",
    "  if (csrfToken) request.setRequestHeader('csrf-token', csrfToken);",
    "  request.setRequestHeader('x-restli-protocol-version', '2.0.0');",
    "  request.send();",
    "  return JSON.stringify({",
    "    ok: request.status >= 200 && request.status < 300,",
    "    status: request.status,",
    "    url,",
    "    csrfTokenPresent: Boolean(csrfToken),",
    "    text: String(request.responseText || '')",
    "  });",
    "})()"
  ].join("");
  return JSON.parse(executeInChromeWindow(windowId, js, 90_000));
}

function pickFirstPageJobCardsUrl(resourceNames = []) {
  return resourceNames.find(
    (name) =>
      /voyagerJobsDashJobCards/i.test(name) &&
      /(?:\?|&)start=0(?:&|$)/.test(name)
  ) || null;
}

function collectTypes(value, limit = 30, results = new Set()) {
  if (results.size >= limit || !value || typeof value !== "object") {
    return results;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectTypes(item, limit, results);
      if (results.size >= limit) {
        break;
      }
    }
    return results;
  }
  if (typeof value.$type === "string" && value.$type) {
    results.add(value.$type);
  }
  for (const nested of Object.values(value)) {
    collectTypes(nested, limit, results);
    if (results.size >= limit) {
      break;
    }
  }
  return results;
}

function collectKeyCounts(value, counts = new Map(), limit = 2000) {
  if (counts.size >= limit || !value || typeof value !== "object") {
    return counts;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectKeyCounts(item, counts, limit);
      if (counts.size >= limit) {
        break;
      }
    }
    return counts;
  }
  for (const [key, nested] of Object.entries(value)) {
    counts.set(key, (counts.get(key) || 0) + 1);
    collectKeyCounts(nested, counts, limit);
    if (counts.size >= limit) {
      break;
    }
  }
  return counts;
}

function findObjectsWithKeys(value, requiredKeys = [], limit = 5, results = []) {
  if (results.length >= limit || !value || typeof value !== "object") {
    return results;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      findObjectsWithKeys(item, requiredKeys, limit, results);
      if (results.length >= limit) {
        break;
      }
    }
    return results;
  }
  if (requiredKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    results.push(value);
    return results;
  }
  for (const nested of Object.values(value)) {
    findObjectsWithKeys(nested, requiredKeys, limit, results);
    if (results.length >= limit) {
      break;
    }
  }
  return results;
}

const url =
  process.argv[2] ||
  "https://www.linkedin.com/jobs/search/?distance=25&f_SB2=9&f_TPR=r259200&keywords=Product%20manager%20ai&location=San%20Francisco%2C%20CA";
const settleMs = Number(process.argv[3]) > 0 ? Number(process.argv[3]) : 8_000;

const windowId = openChromeWindow(url);
try {
  sleepSync(settleMs);
  const snapshot = snapshotResourceUrls(windowId);
  const firstPageJobCardsUrl = pickFirstPageJobCardsUrl(snapshot.resourceNames);
  if (!firstPageJobCardsUrl) {
    throw new Error("Could not find a start=0 voyagerJobsDashJobCards resource URL on the live page.");
  }

  const resourceResponse = fetchResourceBody(windowId, firstPageJobCardsUrl);
  const jobs = extractLinkedInStructuredJobsFromResponseBody(resourceResponse.text);
  let parsedBody = null;
  try {
    parsedBody = JSON.parse(resourceResponse.text);
  } catch {
    parsedBody = null;
  }
  const keyCounts = parsedBody ? collectKeyCounts(parsedBody) : new Map();

  console.log(
    JSON.stringify(
      {
        url,
        pageUrl: snapshot.href,
        pageTitle: snapshot.title,
        firstPageJobCardsUrl,
        fetchOk: resourceResponse.ok,
        fetchStatus: resourceResponse.status,
        csrfTokenPresent: resourceResponse.csrfTokenPresent,
        parsedResponse: Boolean(parsedBody),
        responseTopLevelKeys:
          parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody)
            ? Object.keys(parsedBody).slice(0, 20)
            : [],
        responseTypeSamples: Array.from(collectTypes(parsedBody || {})),
        interestingKeyCounts: Object.fromEntries(
          ["entityUrn", "jobPostingTitle", "primaryDescription", "tertiaryDescription", "title", "company", "trackingUrn"]
            .map((key) => [key, keyCounts.get(key) || 0])
        ),
        sampleObjectsWithJobPostingTitle: findObjectsWithKeys(parsedBody || {}, ["jobPostingTitle"]).slice(0, 2),
        sampleObjectsWithPrimaryAndTertiary: findObjectsWithKeys(parsedBody || {}, ["primaryDescription", "tertiaryDescription"]).slice(0, 2),
        responsePreview: String(resourceResponse.text || "").slice(0, 1200),
        extractedCount: jobs.length,
        jobs: jobs.slice(0, 30)
      },
      null,
      2
    )
  );
} finally {
  closeChromeWindow(windowId);
}
