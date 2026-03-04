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

  const jobs = [];
  const seenJobs = new Set();
  const dismissButtons = Array.from(
    document.querySelectorAll('[aria-label^="Dismiss "][aria-label$=" job"]')
  );

  const findTextContainer = (dismissButton) => {
    let current = dismissButton?.parentElement || null;

    while (current) {
      const text = normalize(current.innerText || current.textContent || "");
      if (text) {
        return current;
      }

      current = current.parentElement;
    }

    return null;
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

  const normalizeTitle = (value) =>
    normalize(value).replace(/\\s*\\(Verified job\\)\\s*/gi, " ");

  const buildSearchUrl = (title, company) => {
    const params = new URLSearchParams({
      keywords: [title, company].filter(Boolean).join(" ")
    });

    return "https://www.linkedin.com/jobs/search-results/?" + params.toString();
  };

  for (const dismissButton of dismissButtons) {
    const card = findTextContainer(dismissButton);
    if (!card) {
      continue;
    }

    const cardLines = parseCardLines(card.innerText || card.textContent || "");
    if (cardLines.length < 2) {
      continue;
    }

    let title = normalizeTitle(cardLines[0]);
    let company = normalize(cardLines[1]);
    let location = normalize(cardLines[2] || "");

    if (company && normalizeTitle(company) === title) {
      company = normalize(cardLines[2] || "");
      location = normalize(cardLines[3] || "");
    }

    if (!title || !company) {
      continue;
    }

    const salaryText =
      cardLines.find((line) => /[$€£]\\s*\\d|\\b\\d+(?:\\.\\d+)?[Kk]\\b.*\\/yr|\\/hr/i.test(line)) || null;

    const postedLine =
      cardLines.find((line) => /^Posted on /i.test(line)) ||
      cardLines.find((line) => /(hour|day|week|month)s? ago/i.test(line)) ||
      null;

    const employmentType =
      cardLines.find((line) => /^(full-time|part-time|contract|temporary|internship)$/i.test(line)) || null;

    const easyApply = /easy apply/i.test(card.innerText || "");

    const href = buildSearchUrl(title, company);
    const dedupeKey = [title, company, location].join("|");

    if (seenJobs.has(dedupeKey)) {
      continue;
    }
    seenJobs.add(dedupeKey);

    jobs.push({
      externalId: null,
      title,
      company,
      location,
      postedAt: postedLine ? postedLine.replace(/^Posted on /i, "").trim() : null,
      employmentType,
      easyApply,
      salaryText,
      summary: normalize((card.innerText || card.textContent || "")).slice(0, 500),
      description: normalize(cardLines.join(" · ")),
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
