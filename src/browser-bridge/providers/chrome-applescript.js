import { spawnSync } from "node:child_process";

import { writeAshbyCaptureFile } from "../../sources/ashby-jobs.js";
import { writeLinkedInCaptureFile } from "../../sources/linkedin-saved-search.js";
import { writeWellfoundCaptureFile } from "../../sources/wellfound-jobs.js";

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

  const toAbsoluteUrl = (href) => {
    const value = normalize(href);
    if (!value) return "";
    try {
      return new URL(value, location.origin).toString();
    } catch {
      return value;
    }
  };

  const extractLinkedInExternalId = (url) => {
    const match = String(url || "").match(/\\/jobs\\/view\\/(\\d+)/i);
    return match ? match[1] : "";
  };

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

  const findCardRoot = (dismissButton) =>
    dismissButton?.closest("li") ||
    dismissButton?.closest('[data-occludable-job-id]') ||
    dismissButton?.closest('div[class*="job-card"]') ||
    dismissButton?.parentElement ||
    null;

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
    const cardRoot = findCardRoot(dismissButton);
    const card = findTextContainer(dismissButton) || cardRoot;
    if (!card) {
      continue;
    }

    const titleAnchor = (cardRoot || card).querySelector('a[href*="/jobs/view/"]');
    const companyNode = (cardRoot || card).querySelector(
      '.artdeco-entity-lockup__subtitle span, .base-search-card__subtitle a, .base-search-card__subtitle'
    );
    const locationNode = (cardRoot || card).querySelector(
      '.artdeco-entity-lockup__caption, .job-search-card__location, .base-search-card__metadata'
    );

    const directUrl = toAbsoluteUrl(titleAnchor?.getAttribute("href") || "");
    const externalId = extractLinkedInExternalId(directUrl) || null;
    const domTitle = normalizeTitle(titleAnchor?.innerText || titleAnchor?.textContent || "");
    const domCompany = normalize(companyNode?.innerText || companyNode?.textContent || "");
    const domLocation = normalize(locationNode?.innerText || locationNode?.textContent || "");

    const cardLines = parseCardLines(card.innerText || card.textContent || "");
    if (cardLines.length < 2) {
      continue;
    }

    let title = domTitle || normalizeTitle(cardLines[0]);
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

    const href = directUrl || buildSearchUrl(title, company);
    const dedupeKey = externalId
      ? "linkedin:" + externalId
      : [title.toLowerCase(), company.toLowerCase()].join("|");

    if (seenJobs.has(dedupeKey)) {
      continue;
    }
    seenJobs.add(dedupeKey);

    jobs.push({
      externalId,
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
  navigateFrontTab(searchUrl);

  const settleMs = Number(options.settleMs) > 0 ? Number(options.settleMs) : 3000;
  const maxAttempts = Number(options.maxAttempts) > 0 ? Number(options.maxAttempts) : 6;
  const attemptDelayMs =
    Number(options.attemptDelayMs) > 0 ? Number(options.attemptDelayMs) : 1500;
  const extractionScript = buildWellfoundExtractionScript();

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

  throw new Error("Could not extract Wellfound jobs from the active Chrome tab.");
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

    pushJob({
      title,
      company: pageTitle || companyFromUrl(hrefResolved) || "Unknown company",
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

function toAshbyBoardUrl(urlText) {
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

function runExtractionAttempts(extractionScript, maxAttempts, attemptDelayMs) {
  let lastPayload = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const raw = executeInFrontTab(extractionScript);
    const payload = parseBridgeJsonPayload(raw);

    if (payload && Array.isArray(payload.jobs)) {
      lastPayload = payload;
      if (payload.jobs.length > 0) {
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
  navigateFrontTab(searchUrl);

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

  if (isGoogleSearchUrl(searchUrl)) {
    const boardPayload = parseBridgeJsonPayload(
      executeInFrontTab(boardDiscoveryScript)
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
      navigateFrontTab(boardUrl);
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

export function captureWellfoundSourceWithChromeAppleScript(
  source,
  _snapshotPath,
  options = {}
) {
  if (!source || source.type !== "wellfound_search") {
    throw new Error("Chrome AppleScript capture requires a wellfound_search source.");
  }

  const payload = readWellfoundJobsFromChrome(source.searchUrl, options);

  return {
    ...writeWellfoundCaptureFile(source, payload.jobs, {
      capturedAt: payload.capturedAt,
      pageUrl: payload.pageUrl
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

  const payload = readAshbyJobsFromChrome(source.searchUrl, options);

  return {
    ...writeAshbyCaptureFile(source, payload.jobs, {
      capturedAt: payload.capturedAt,
      pageUrl: payload.pageUrl
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

  throw new Error(
    `Chrome AppleScript provider currently supports linkedin_capture_file, wellfound_search, and ashby_search. "${source?.name || "unknown"}" is ${source?.type || "unknown"}.`
  );
}
