import { spawnSync } from "node:child_process";
import fs from "node:fs";

import { writeAshbyCaptureFile } from "../../sources/ashby-jobs.js";
import { writeGoogleCaptureFile } from "../../sources/google-jobs.js";
import { writeIndeedCaptureFile } from "../../sources/indeed-jobs.js";
import { writeLinkedInCaptureFile } from "../../sources/linkedin-saved-search.js";
import { writeRemoteOkCaptureFile } from "../../sources/remoteok-jobs.js";
import { writeWellfoundCaptureFile } from "../../sources/wellfound-jobs.js";
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

let automationWindowId = null;

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

function navigateAutomationTab(url, message) {
  const windowId = ensureAutomationWindow(message);
  showAutomationMessage(message);
  runAppleScript(
    [
      'tell application "Google Chrome"',
      `set _window to window id ${windowId}`,
      `set URL of active tab of _window to "${escapeAppleScriptString(url)}"`,
      "end tell"
    ].join("\n")
  );
}

function executeInAutomationTab(javaScript) {
  const windowId = ensureAutomationWindow("Refreshing sources...");
  return runAppleScript(
    [
      'tell application "Google Chrome"',
      `set _window to window id ${windowId}`,
      'tell active tab of _window',
      `set resultText to execute javascript "${escapeAppleScriptString(javaScript)}"`,
      "end tell",
      "return resultText",
      "end tell"
    ].join("\n")
  );
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

  const findTextContainer = (startNode) => {
    let current = startNode?.parentElement || null;

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

  const buildCardSeeds = () => {
    const seeds = [];
    const seenKeys = new Set();

    const addSeed = (cardRoot, dismissButton = null, seededAnchor = null) => {
      if (!cardRoot) {
        return;
      }

      const key = normalize(
        cardRoot.getAttribute("data-occludable-job-id") ||
          cardRoot.getAttribute("data-job-id") ||
          seededAnchor?.getAttribute("href") ||
          ""
      );
      if (key && seenKeys.has(key)) {
        return;
      }
      if (key) {
        seenKeys.add(key);
      }

      seeds.push({
        cardRoot,
        dismissButton,
        seededAnchor
      });
    };

    const anchors = Array.from(
      document.querySelectorAll('a[href*="/jobs/view/"], a[href*="currentJobId="]')
    );
    for (const anchor of anchors) {
      const anchorText = normalize(anchor.innerText || anchor.textContent || "");
      if (
        !anchorText ||
        anchorText.length < 8 ||
        anchorText.length > 180 ||
        !/[a-z]/i.test(anchorText) ||
        !/\\s/.test(anchorText) ||
        /^(more|about|accessibility|help center|privacy|terms|ad choices|advertising|business services)$/i.test(
          anchorText
        ) ||
        /are these results helpful|your feedback helps/i.test(anchorText)
      ) {
        continue;
      }

      const cardRoot =
        anchor.closest("li") ||
        anchor.closest('[data-occludable-job-id]') ||
        anchor.closest('div[class*="job-card"]') ||
        anchor.parentElement;
      if (!cardRoot) {
        continue;
      }
      addSeed(
        cardRoot,
        null,
        anchor
      );
    }

    for (const dismissButton of dismissButtons) {
      addSeed(findCardRoot(dismissButton), dismissButton, null);
    }

    return seeds;
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

  const readDetailHints = (cardRoot, dismissButton, titleAnchor) => {
    const clickTarget =
      (cardRoot || dismissButton)?.querySelector('a[href*="/jobs/view/"]') ||
      titleAnchor ||
      cardRoot ||
      dismissButton;
    if (clickTarget && typeof clickTarget.click === "function") {
      clickTarget.click();
    }

    const selectors = [
      ".jobs-unified-top-card__primary-description-container",
      ".jobs-unified-top-card__job-insight-view-model-secondary",
      ".jobs-box__html-content",
      ".jobs-description-content__text",
      ".jobs-search__job-details--wrapper",
      ".jobs-search__job-details",
      ".scaffold-layout__detail"
    ];

    let bestText = "";
    let resolvedExternalId = extractLinkedInExternalId(location.href);
    const startedAt = Date.now();
    while (Date.now() - startedAt < 70) {
      for (const selector of selectors) {
        const node = document.querySelector(selector);
        const text = normalize(node?.innerText || node?.textContent || "");
        if (text.length > bestText.length) {
          bestText = text;
        }
      }
      const hrefNode = document.querySelector(
        '.jobs-search__job-details a[href*="/jobs/view/"], .jobs-search__job-details a[href*="currentJobId="], .scaffold-layout__detail a[href*="/jobs/view/"], .scaffold-layout__detail a[href*="currentJobId="]'
      );
      const hintedExternalId = extractLinkedInExternalId(
        toAbsoluteUrl(hrefNode?.getAttribute("href") || location.href)
      );
      if (hintedExternalId) {
        resolvedExternalId = hintedExternalId;
      }

      const hints = parseDetailHints(bestText);
      if (hints.postedAt || hints.salaryText || hints.employmentType || hints.location) {
        return {
          ...hints,
          externalId: resolvedExternalId
        };
      }

      spinWait(35);
    }

    return {
      ...parseDetailHints(bestText),
      externalId: resolvedExternalId
    };
  };

  let detailReadBudget = 120;
  for (const seed of buildCardSeeds()) {
    const cardRoot = seed.cardRoot;
    const dismissButton = seed.dismissButton;
    const card = findTextContainer(dismissButton || seed.seededAnchor || cardRoot) || cardRoot;
    if (!card) {
      continue;
    }

    const titleAnchor =
      seed.seededAnchor ||
      (cardRoot || card).querySelector('a[href*="/jobs/view/"]') ||
      (cardRoot || card).querySelector('a[href*="currentJobId="]') ||
      (cardRoot || card).querySelector("a[href]");
    const companyNode = (cardRoot || card).querySelector(
      '.artdeco-entity-lockup__subtitle span, .base-search-card__subtitle a, .base-search-card__subtitle'
    );
    const locationNode = (cardRoot || card).querySelector(
      '.artdeco-entity-lockup__caption, .job-search-card__location, .base-search-card__metadata'
    );

    const directUrl = toAbsoluteUrl(titleAnchor?.getAttribute("href") || "");
    const cardExternalId = normalize(
      (cardRoot || card).getAttribute("data-occludable-job-id") ||
        (cardRoot || card).getAttribute("data-job-id") ||
        ""
    );
    const externalId =
      extractLinkedInExternalId(directUrl) ||
      (cardExternalId.match(/\\d{6,}/)?.[0] || "") ||
      null;
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
    if (location && !looksLikeLocation(location)) {
      location = "";
    }

    if (!title || !company) {
      continue;
    }

    const salaryPattern =
      /(?:[$€£]\\s*\\d[\\d,]*(?:\\.\\d+)?(?:[kKmM])?(?:\\s*[-–]\\s*[$€£]?\\s*\\d[\\d,]*(?:\\.\\d+)?(?:[kKmM])?)?|\\b\\d{2,3}\\s*[Kk]\\s*[-–]\\s*\\d{2,3}\\s*[Kk]\\b)(?:\\s*(?:annually|yearly|monthly|weekly|hourly|per\\s+(?:year|yr|hour|hr)|\\/(?:year|yr|hour|hr)))?/i;
    const cardSalaryText = cardLines.find((line) => salaryPattern.test(line)) || null;

    const cardPostedLine =
      normalize(
        (cardRoot || card).querySelector(
          "time, .job-search-card__listdate, .job-search-card__listdate--new"
        )?.innerText ||
          (cardRoot || card).querySelector(
            "time, .job-search-card__listdate, .job-search-card__listdate--new"
          )?.textContent ||
          ""
      ) ||
      cardLines.find((line) => /^Posted on /i.test(line)) ||
      cardLines.find((line) => /(?:hour|day|week|month|year)s? ago/i.test(line)) ||
      cardLines.find((line) => /\\b(today|yesterday|just posted|reposted)\\b/i.test(line)) ||
      null;

    const cardEmploymentHint = normalize(
      (cardRoot || card).querySelector(
        '.job-card-container__metadata-item, [class*="job-insight"]'
      )?.innerText ||
        (cardRoot || card).querySelector(
          '.job-card-container__metadata-item, [class*="job-insight"]'
        )?.textContent ||
        ""
    );

    const cardEmploymentType =
      (/\\b(full[- ]?time|part[- ]?time|contract|temporary|internship|freelance|apprenticeship)\\b/i.test(
        cardEmploymentHint
      )
        ? cardEmploymentHint
        : "") ||
      cardLines.find((line) =>
        /\\b(full[- ]?time|part[- ]?time|contract|temporary|internship|freelance|apprenticeship)\\b/i.test(
          line
        )
      ) || null;
    let detailHints = {
      ...parseDetailHints(""),
      externalId: ""
    };
    if (
      detailReadBudget > 0 &&
      (!cardPostedLine || !cardSalaryText || !cardEmploymentType || !location)
    ) {
      detailHints = readDetailHints(cardRoot, dismissButton, titleAnchor);
      detailReadBudget -= 1;
    }
    const resolvedExternalId = externalId || detailHints.externalId || null;
    const salaryText = cardSalaryText || detailHints.salaryText || null;
    const postedLine = cardPostedLine || detailHints.postedAt || null;
    const employmentType = cardEmploymentType || detailHints.employmentType || null;
    const resolvedLocation = location || detailHints.location || "";

    const easyApply = /easy apply/i.test(card.innerText || "");

    const href =
      (resolvedExternalId
        ? "https://www.linkedin.com/jobs/view/" + resolvedExternalId + "/"
        : "") ||
      directUrl ||
      buildSearchUrl(title, company);
    const roleKey = [title.toLowerCase(), company.toLowerCase()].join("|");
    const dedupeKey = resolvedExternalId
      ? "linkedin:" + resolvedExternalId
      : "role:" + roleKey;

    if (seenJobs.has(dedupeKey) || seenJobs.has("role:" + roleKey)) {
      continue;
    }
    seenJobs.add(dedupeKey);
    seenJobs.add("role:" + roleKey);

    jobs.push({
      externalId: resolvedExternalId,
      title,
      company,
      location: resolvedLocation || null,
      postedAt: postedLine ? postedLine.replace(/^Posted on /i, "").trim() : null,
      employmentType,
      easyApply,
      salaryText,
      summary: normalize((card.innerText || card.textContent || "")).slice(0, 500),
      description: normalize(cardLines.join(" · ")),
      extractorProvenance: {
        postedAt: cardPostedLine ? "card" : detailHints.postedAt ? "detail" : "fallback_unknown",
        salaryText: cardSalaryText ? "card" : detailHints.salaryText ? "detail" : "fallback_unknown",
        employmentType: cardEmploymentType
          ? "card"
          : detailHints.employmentType
            ? "detail"
            : "fallback_unknown",
        location: location ? "card" : detailHints.location ? "detail" : "fallback_unknown",
        description: "card"
      },
      url: href
    });
  }

  return JSON.stringify({
    pageUrl: location.href,
    capturedAt: new Date().toISOString(),
    jobs,
    expectedCount: extractExpectedCount()
  });
})()
  `.trim();
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
  attemptDelayMs
}) {
  const collected = [];
  let lastPayload = runExtractionAttempts(extractionScript, maxAttempts, attemptDelayMs);
  let expectedCount = null;
  let sawValidPayload = Boolean(lastPayload && Array.isArray(lastPayload.jobs));

  if (Array.isArray(lastPayload?.jobs) && lastPayload.jobs.length > 0) {
    collected.push(...lastPayload.jobs);
  }
  if (Number.isFinite(Number(lastPayload?.expectedCount))) {
    const parsed = Math.round(Number(lastPayload.expectedCount));
    if (parsed > 0) {
      expectedCount = parsed;
    }
  }

  let lastCollectedCount = dedupeJobsByIdentity(collected).length;
  let idleSteps = 0;

  for (let step = 0; step < maxScrollSteps; step += 1) {
    executeInAutomationTab(scrollScript);
    sleepSync(scrollDelayMs);

    const payload = runExtractionAttempts(extractionScript, maxAttempts, attemptDelayMs);
    if (payload) {
      lastPayload = payload;
      sawValidPayload = true;
    }

    if (Array.isArray(payload?.jobs) && payload.jobs.length > 0) {
      collected.push(...payload.jobs);
    }
    if (Number.isFinite(Number(payload?.expectedCount))) {
      const parsed = Math.round(Number(payload.expectedCount));
      if (parsed > 0 && (expectedCount === null || parsed > expectedCount)) {
        expectedCount = parsed;
      }
    }

    const dedupedCount = dedupeJobsByIdentity(collected).length;
    if (dedupedCount > lastCollectedCount) {
      lastCollectedCount = dedupedCount;
      idleSteps = 0;
    } else {
      idleSteps += 1;
    }

    if (idleSteps >= maxIdleScrollSteps) {
      break;
    }
  }

  return {
    pageUrl: lastPayload?.pageUrl || null,
    capturedAt: new Date().toISOString(),
    jobs: dedupeJobsByIdentity(collected),
    expectedCount,
    sawValidPayload
  };
}

export function buildLinkedInPageUrl(searchUrl, pageIndex = 0) {
  const normalizedPageIndex =
    Number.isInteger(pageIndex) && pageIndex > 0 ? pageIndex : 0;
  const startOffset = normalizedPageIndex * 25;
  return buildUrlWithSearchParam(searchUrl, "start", String(startOffset));
}

function readLinkedInJobsFromChrome(searchUrl, options = {}) {
  const settleMs = Number(options.settleMs) > 0 ? Number(options.settleMs) : 2500;
  const maxAttempts = Number(options.maxAttempts) > 0 ? Number(options.maxAttempts) : 5;
  const attemptDelayMs =
    Number(options.attemptDelayMs) > 0 ? Number(options.attemptDelayMs) : 1200;
  const maxPages = Number(options.maxPages) > 0 ? Number(options.maxPages) : 4;
  const maxScrollSteps = Number(options.maxScrollSteps) > 0
    ? Number(options.maxScrollSteps)
    : 14;
  const maxIdleScrollSteps = Number(options.maxIdleScrollSteps) > 0
    ? Number(options.maxIdleScrollSteps)
    : 3;
  const scrollDelayMs = Number(options.scrollDelayMs) > 0
    ? Number(options.scrollDelayMs)
    : 1000;
  const extractionScript = buildExtractionScript();
  const scrollScript = buildLinkedInScrollStepScript();

  const collected = [];
  let sawValidPayload = false;
  let expectedCount = null;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const pageUrl = buildLinkedInPageUrl(searchUrl, pageIndex);
    navigateAutomationTab(pageUrl, "Refreshing LinkedIn source...");
    sleepSync(settleMs);

    const pagePayload = harvestLinkedInPageJobs({
      extractionScript,
      scrollScript,
      maxScrollSteps,
      maxIdleScrollSteps,
      scrollDelayMs,
      maxAttempts,
      attemptDelayMs
    });

    if (pagePayload?.sawValidPayload === true) {
      sawValidPayload = true;
    }
    if (Number.isFinite(Number(pagePayload?.expectedCount))) {
      const parsed = Math.round(Number(pagePayload.expectedCount));
      if (parsed > 0 && (expectedCount === null || parsed > expectedCount)) {
        expectedCount = parsed;
      }
    }

    const pageJobs = Array.isArray(pagePayload?.jobs) ? pagePayload.jobs : [];
    if (pageJobs.length === 0) {
      break;
    }

    const priorCount = collected.length;
    collected.push(...pageJobs);
    const deduped = dedupeJobsByIdentity(collected);
    collected.length = 0;
    collected.push(...deduped);

    if (collected.length === priorCount) {
      break;
    }
  }

  if (collected.length > 0 || sawValidPayload) {
    return {
      pageUrl: searchUrl,
      capturedAt: new Date().toISOString(),
      jobs: dedupeJobsByIdentity(collected),
      expectedCount
    };
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
  blockedIncludes = []
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
  const titleNoise = /^(apply|save|share|learn more|continue|see more|show more|company|location)$/i;
  const parseExpectedCountFromText = (text) => {
    const normalized = normalize(text).toLowerCase();
    if (!normalized) {
      return null;
    }

    const match =
      normalized.match(/showing\\s+\\d+\\s*[-–]\\s*\\d+\\s+of\\s+([\\d,]+)\\s+(?:jobs?|results?)/i) ||
      normalized.match(/([\\d,]+)\\s+(?:jobs?|results?)\\b/i) ||
      normalized.match(/of\\s+([\\d,]+)\\s+(?:jobs?|results?)\\b/i);

    if (!match || !match[1]) {
      return null;
    }

    const parsed = Number(String(match[1]).replace(/,/g, ""));
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
  };

  const extractExpectedCount = () => {
    const selectors = [
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
    const raw = executeInAutomationTab(extractionScript);
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

function readIndeedJobsFromChrome(searchUrl, options = {}) {
  const extractionScript = buildGenericBoardExtractionScript({
    siteKey: "indeed",
    hostIncludes: ["indeed.com"],
    urlIncludes: ["/viewjob", "/rc/clk", "jk="],
    blockedIncludes: ["/cmp/", "/companies/", "/career-advice/"]
  });
  const maxPages = Number(options.maxPages) > 0 ? Number(options.maxPages) : 8;
  return capturePaginatedGenericBoardJobs({
    searchUrl,
    extractionScript,
    maxPages,
    pageUrlForIndex: (index) =>
      buildUrlWithSearchParam(searchUrl, "start", String(index * 10)),
    options
  });
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

  const readDetailHints = (clickNode) => {
    if (clickNode && typeof clickNode.click === "function") {
      clickNode.click();
    }

    const start = Date.now();
    while (Date.now() - start < 150) {
      // allow detail pane repaint
    }

    const selectors = [
      '[data-testid*="job-description"]',
      '[class*="job_description"]',
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
  const cards = Array.from(
    document.querySelectorAll('div[class*="job_result_two_pane"], article[class*="job_result"]')
  );

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
    const detailHints = readDetailHints(jobLink || titleNode || companyLink || card);

    const cardText = normalize(card.innerText || card.textContent || "");
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

    const externalId = normalize([company, title, location || ""].join("|"));
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
      buildUrlWithSearchParam(searchUrl, "page", String(index + 1)),
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
      /\\b(san francisco|new york|remote|seattle|austin|los angeles|california)\\b/i
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

function runExtractionAttempts(extractionScript, maxAttempts, attemptDelayMs) {
  let lastPayload = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const raw = executeInAutomationTab(extractionScript);
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

export function captureLinkedInSourceWithChromeAppleScript(
  source,
  _snapshotPath,
  options = {}
) {
  if (!source || source.type !== "linkedin_capture_file") {
    throw new Error("Chrome AppleScript capture requires a linkedin_capture_file source.");
  }

  const payload = readLinkedInJobsFromChrome(source.searchUrl, {
    ...options,
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
  const enrichedJobs = applySearchFilterInferences(
    source,
    runDetailEnrichment(source, payload.jobs, options)
  );

  return {
    ...writeLinkedInCaptureFile(source, enrichedJobs, {
      capturedAt: payload.capturedAt,
      pageUrl: payload.pageUrl,
      expectedCount: payload.expectedCount
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
  const enrichedJobs = applySearchFilterInferences(
    source,
    runDetailEnrichment(source, payload.jobs, options)
  );

  return {
    ...writeWellfoundCaptureFile(source, enrichedJobs, {
      capturedAt: payload.capturedAt,
      pageUrl: payload.pageUrl,
      expectedCount: payload.expectedCount
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

  const payload = readAshbyJobsFromChrome(source.searchUrl, {
    ...options,
    maxBoards: Number(source.maxBoards) > 0 ? Number(source.maxBoards) : options.maxBoards
  });
  const enrichedJobs = applySearchFilterInferences(
    source,
    runDetailEnrichment(source, payload.jobs, options)
  );

  return {
    ...writeAshbyCaptureFile(source, enrichedJobs, {
      capturedAt: payload.capturedAt,
      pageUrl: payload.pageUrl,
      expectedCount: payload.expectedCount
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

  const payload = readIndeedJobsFromChrome(source.searchUrl, {
    ...options,
    maxPages: Number(source.maxPages) > 0 ? Number(source.maxPages) : options.maxPages
  });
  const enrichedJobs = applySearchFilterInferences(
    source,
    runDetailEnrichment(source, payload.jobs, options)
  );

  return {
    ...writeIndeedCaptureFile(source, enrichedJobs, {
      capturedAt: payload.capturedAt,
      pageUrl: payload.pageUrl,
      expectedCount: payload.expectedCount
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

  const payload = readGoogleJobsFromChrome(source.searchUrl, options);
  const enrichedJobs = applySearchFilterInferences(
    source,
    runDetailEnrichment(source, payload.jobs, options)
  );

  return {
    ...writeGoogleCaptureFile(source, enrichedJobs, {
      capturedAt: payload.capturedAt,
      pageUrl: payload.pageUrl,
      expectedCount: payload.expectedCount
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

  const payload = readZipRecruiterJobsFromChrome(source.searchUrl, {
    ...options,
    maxPages: Number(source.maxPages) > 0 ? Number(source.maxPages) : options.maxPages
  });
  const enrichedJobs = applySearchFilterInferences(
    source,
    runDetailEnrichment(source, payload.jobs, options)
  );

  return {
    ...writeZipRecruiterCaptureFile(source, enrichedJobs, {
      capturedAt: payload.capturedAt,
      pageUrl: payload.pageUrl,
      expectedCount: payload.expectedCount
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

  const payload = readRemoteOkJobsFromChrome(source.searchUrl, options);

  return {
    ...writeRemoteOkCaptureFile(source, payload.jobs, {
      capturedAt: payload.capturedAt,
      pageUrl: payload.pageUrl,
      expectedCount: payload.expectedCount
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

  if (source?.type === "remoteok_search") {
    return captureRemoteOkSourceWithChromeAppleScript(source, snapshotPath, options);
  }

  throw new Error(
    `Chrome AppleScript provider currently supports linkedin_capture_file, wellfound_search, ashby_search, google_search, indeed_search, ziprecruiter_search, and remoteok_search. "${source?.name || "unknown"}" is ${source?.type || "unknown"}.`
  );
}
