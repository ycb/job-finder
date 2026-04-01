import { spawnSync } from "node:child_process";

import { extractLinkedInStructuredJobsFromHtml } from "../src/sources/linkedin-structured-payload.js";

function runAppleScript(script, timeoutMs = 45_000) {
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

function fetchOuterHtmlFromChrome(url, options = {}) {
  const settleMs = Number(options.settleMs) > 0 ? Number(options.settleMs) : 8_000;
  const openScript = [
    'tell application "Google Chrome"',
    "set _window to make new window",
    `set URL of active tab of _window to "${escapeAppleScriptString(url)}"`,
    "set bounds of _window to {90, 90, 1280, 900}",
    "return id of _window",
    "end tell"
  ].join("\n");

  const windowId = Number(runAppleScript(openScript));
  if (!Number.isInteger(windowId)) {
    throw new Error("Could not create Chrome window for LinkedIn POC.");
  }

  sleepSync(settleMs);

  const js = [
    "(() => {",
    "  return JSON.stringify({",
    "    href: String(location.href || ''),",
    "    title: String(document.title || ''),",
    "    outerHTML: String(document.documentElement?.outerHTML || '')",
    "  });",
    "})()"
  ].join("");

  const execScript = [
    'tell application "Google Chrome"',
    `set _window to window id ${windowId}`,
    'tell active tab of _window',
    `set resultText to execute javascript "${escapeAppleScriptString(js)}"`,
    "end tell",
    "return resultText",
    "end tell"
  ].join("\n");

  try {
    return JSON.parse(runAppleScript(execScript));
  } finally {
    const closeScript = [
      'tell application "Google Chrome"',
      `close window id ${windowId}`,
      "end tell"
    ].join("\n");
    try {
      runAppleScript(closeScript);
    } catch {
      // no-op
    }
  }
}

const url =
  process.argv[2] ||
  "https://www.linkedin.com/jobs/search/?distance=25&f_SB2=9&f_TPR=r259200&keywords=Product%20manager%20ai&location=San%20Francisco%2C%20CA";

const page = fetchOuterHtmlFromChrome(url);
const jobs = extractLinkedInStructuredJobsFromHtml(page.outerHTML);

console.log(
  JSON.stringify(
    {
      url,
      pageUrl: page.href,
      pageTitle: page.title,
      extractedCount: jobs.length,
      jobs: jobs.slice(0, 25)
    },
    null,
    2
  )
);
