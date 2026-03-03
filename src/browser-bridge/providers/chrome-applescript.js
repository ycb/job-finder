import { spawnSync } from "node:child_process";

import { writeLinkedInCaptureFile } from "../../sources/linkedin-saved-search.js";

function sleepSync(milliseconds) {
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, milliseconds);
}

function escapeAppleScriptString(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

function runAppleScript(script, timeoutMs = 15_000) {
  const result = spawnSync("osascript", ["-e", script], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: timeoutMs
  });

  if (result.error) {
    if (result.error.code === "ETIMEDOUT") {
      throw new Error(`Chrome AppleScript timed out after ${timeoutMs}ms.`);
    }

    throw result.error;
  }

  if (result.status !== 0) {
    const errorText = String(result.stderr || result.stdout || "").trim();
    if (/Allow JavaScript from Apple Events/i.test(errorText)) {
      throw new Error(
        'Chrome is blocking JavaScript automation. In Chrome, enable View > Developer > "Allow JavaScript from Apple Events", then rerun capture.'
      );
    }

    throw new Error(errorText || `AppleScript exited with status ${result.status}.`);
  }

  return String(result.stdout || "").trim();
}

function navigateFrontTab(url) {
  const escapedUrl = escapeAppleScriptString(url);
  runAppleScript(
    [
      'tell application "Google Chrome"',
      "if (count of windows) = 0 then make new window",
      `set URL of active tab of front window to "${escapedUrl}"`,
      "activate",
      "end tell"
    ].join("\n")
  );
}

function executeInFrontTab(javaScript) {
  const escapedJavaScript = escapeAppleScriptString(javaScript);
  return runAppleScript(
    [
      'tell application "Google Chrome"',
      'tell active tab of front window',
      `set resultText to execute javascript "${escapedJavaScript}"`,
      "end tell",
      "return resultText",
      "end tell"
    ].join("\n")
  );
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

  let cards = Array.from(document.querySelectorAll(".job-card-container"));
  if (!cards.length) {
    cards = Array.from(document.querySelectorAll("li.jobs-search-results__list-item, li.scaffold-layout__list-item"));
  }

  const jobs = [];
  const seenJobs = new Set();

  for (const card of cards) {
    const link = card.querySelector('a[href*="/jobs/view/"]');
    const href = link?.href ? new URL(link.href, location.origin).toString() : "";
    const externalIdMatch = href.match(/\\/jobs\\/view\\/(\\d+)/);

    const title = unique([
      card.querySelector(".job-card-list__title")?.textContent,
      card.querySelector(".job-card-container__link")?.textContent,
      link?.textContent
    ])[0] || "";

    const company = unique([
      card.querySelector(".artdeco-entity-lockup__subtitle")?.textContent,
      card.querySelector(".job-card-container__company-name")?.textContent,
      card.querySelector(".job-card-container__primary-description")?.textContent
    ])[0] || "";

    const location = unique([
      card.querySelector(".job-card-container__metadata-item")?.textContent,
      card.querySelector(".artdeco-entity-lockup__caption")?.textContent,
      Array.from(card.querySelectorAll("li, span"))
        .map((node) => normalize(node.textContent))
        .find((text) => /(remote|hybrid|on-site|onsite|,\\s*[A-Z]{2}|bay area)/i.test(text))
    ])[0] || "";

    const postedAt = unique([
      card.querySelector(".job-card-container__footer-item")?.textContent,
      card.querySelector(".job-card-container__listed-time")?.textContent,
      Array.from(card.querySelectorAll("time, span"))
        .map((node) => normalize(node.textContent))
        .find((text) => /(hour|day|week|month)s? ago|reposted|active/i.test(text))
    ])[0] || null;

    const allTexts = unique(
      Array.from(card.querySelectorAll("*"))
        .map((node) => normalize(node.textContent))
        .filter(Boolean)
    );

    const salaryText =
      allTexts.find((text) => /[$€£]\\s*\\d|\\b\\d+[Kk]\\b.*\\/yr|\\/hr/i.test(text)) || null;

    const employmentType =
      allTexts.find((text) => /^(full-time|part-time|contract|temporary|internship)$/i.test(text)) || null;

    const easyApply = allTexts.some((text) => /easy apply/i.test(text));

    if (!title || !company) {
      continue;
    }

    const dedupeKey = [title, company, location, href].join("|");
    if (seenJobs.has(dedupeKey)) {
      continue;
    }
    seenJobs.add(dedupeKey);

    jobs.push({
      externalId: externalIdMatch ? externalIdMatch[1] : null,
      title,
      company,
      location,
      postedAt,
      employmentType,
      easyApply,
      salaryText,
      summary: normalize(card.textContent).slice(0, 500),
      description: normalize(card.textContent),
      url: href || location.href
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

function readLinkedInJobsFromChrome(searchUrl, options = {}) {
  navigateFrontTab(searchUrl);

  const settleMs = Number(options.settleMs) > 0 ? Number(options.settleMs) : 2500;
  const maxAttempts = Number(options.maxAttempts) > 0 ? Number(options.maxAttempts) : 5;
  const attemptDelayMs =
    Number(options.attemptDelayMs) > 0 ? Number(options.attemptDelayMs) : 1200;
  const extractionScript = buildExtractionScript();

  sleepSync(settleMs);

  let lastPayload = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const raw = executeInFrontTab(extractionScript);
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

  throw new Error("Could not extract LinkedIn jobs from the active Chrome tab.");
}

export function captureLinkedInSourceWithChromeAppleScript(
  source,
  _snapshotPath,
  options = {}
) {
  if (!source || source.type !== "linkedin_capture_file") {
    throw new Error("Chrome AppleScript capture requires a linkedin_capture_file source.");
  }

  const payload = readLinkedInJobsFromChrome(source.searchUrl, options);

  return {
    ...writeLinkedInCaptureFile(source, payload.jobs, {
      capturedAt: payload.capturedAt,
      pageUrl: payload.pageUrl
    }),
    provider: "chrome_applescript",
    status: "completed"
  };
}
