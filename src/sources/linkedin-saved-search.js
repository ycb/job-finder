import fs from "node:fs";
import path from "node:path";

import { collectBuiltInJobsFromSearch } from "./builtin-jobs.js";

function readSourceJson(filePath, errorLabel) {
  const resolvedPath = path.resolve(filePath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(
      `${errorLabel} not found: ${resolvedPath}. Update config/sources.json with a valid path.`
    );
  }

  const rawText = fs.readFileSync(resolvedPath, "utf8");

  try {
    return JSON.parse(rawText);
  } catch (error) {
    throw new Error(`Invalid JSON in ${resolvedPath}: ${error.message}`);
  }
}

function readSourceText(filePath, errorLabel) {
  const resolvedPath = path.resolve(filePath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(
      `${errorLabel} not found: ${resolvedPath}. Update the path and try again.`
    );
  }

  return fs.readFileSync(resolvedPath, "utf8");
}

function buildLinkedInSearchUrl(title, company) {
  const query = [title, company].filter(Boolean).join(" ");
  const params = new URLSearchParams({
    keywords: query
  });

  return `https://www.linkedin.com/jobs/search-results/?${params.toString()}`;
}

function isJobButtonLine(line) {
  const match = line.match(/^(\s*)- button "(.+)" \[ref=[^\]]+\] \[cursor=pointer\]:$/);
  if (!match) {
    return null;
  }

  const [, indent, label] = match;
  if (!label.includes(" Dismiss ") || label.startsWith("Dismiss ")) {
    return null;
  }

  return {
    indent: indent.length,
    label
  };
}

function extractInlineText(line) {
  const directMatch = line.match(/^\s*- (?:paragraph|generic) \[ref=[^\]]+\]: (.+)$/);
  if (directMatch) {
    return directMatch[1].trim();
  }

  const textMatch = line.match(/^\s*- text: (.+)$/);
  if (textMatch) {
    return textMatch[1].trim();
  }

  return null;
}

function normalizeTitle(value) {
  return String(value || "")
    .replace(/\s*\(Verified job\)\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isNoiseText(value) {
  const normalized = String(value || "").trim();

  if (!normalized) {
    return true;
  }

  return [
    normalized === "·",
    normalized === "Easy Apply",
    normalized === "Viewed",
    normalized === "Saved",
    normalized === "Applied",
    normalized === "Actively reviewing applicants",
    normalized === "Be an early applicant",
    normalized.startsWith("Dismiss "),
    normalized.startsWith("Posted on "),
    /school alumni work here/i.test(normalized),
    /connection works here/i.test(normalized),
    /\bbenefits?\b/i.test(normalized)
  ].some(Boolean);
}

function parseSnapshotJobBlock(lines, startIndex, buttonLine) {
  const blockLines = [];

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      continue;
    }

    const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
    if (indent <= buttonLine.indent) {
      break;
    }

    blockLines.push(line);
  }

  const inlineTexts = blockLines
    .map((line) => extractInlineText(line))
    .filter((value) => typeof value === "string");
  const primaryTexts = [];

  for (const value of inlineTexts) {
    if (isNoiseText(value)) {
      continue;
    }

    const normalizedValue = normalizeTitle(value);
    if (!normalizedValue) {
      continue;
    }

    if (primaryTexts[primaryTexts.length - 1] !== normalizedValue) {
      primaryTexts.push(normalizedValue);
    }
  }

  const title = primaryTexts[0] || "";
  const company = primaryTexts[1] || "";
  const location = primaryTexts[2] || "";
  const salaryText =
    inlineTexts.find((value) => /\$\d|\b\d+\/hr\b|\b\d+\/yr\b/i.test(value)) || null;
  const postedLabel =
    inlineTexts.find((value) => value.startsWith("Posted on ")) || null;
  const easyApply = inlineTexts.includes("Easy Apply");

  if (!title || !company) {
    return null;
  }

  return {
    externalId: null,
    title,
    company,
    location,
    postedAt: postedLabel
      ? postedLabel.replace(/^Posted on /, "").trim()
      : null,
    employmentType: null,
    easyApply,
    salaryText,
    summary: buttonLine.label,
    description: buttonLine.label,
    url: buildLinkedInSearchUrl(title, company)
  };
}

export function parseLinkedInSnapshot(snapshotText) {
  const lines = String(snapshotText || "").split(/\r?\n/);
  const jobs = [];

  for (let index = 0; index < lines.length; index += 1) {
    const buttonLine = isJobButtonLine(lines[index]);
    if (!buttonLine) {
      continue;
    }

    const job = parseSnapshotJobBlock(lines, index, buttonLine);
    if (job) {
      jobs.push(job);
    }
  }

  return jobs;
}

export function writeLinkedInCaptureFile(
  source,
  jobs,
  options = {}
) {
  if (!source || source.type !== "linkedin_capture_file") {
    throw new Error("LinkedIn capture write requires a linkedin_capture_file source.");
  }

  const payload = {
    sourceId: source.id,
    sourceName: source.name,
    searchUrl: source.searchUrl,
    capturedAt: options.capturedAt || new Date().toISOString(),
    jobs: Array.isArray(jobs) ? jobs : []
  };

  if (options.pageUrl) {
    payload.pageUrl = options.pageUrl;
  }

  fs.writeFileSync(source.capturePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  return {
    source,
    capturePath: source.capturePath,
    jobsImported: payload.jobs.length,
    capturedAt: payload.capturedAt,
    pageUrl: payload.pageUrl || null
  };
}

export function importLinkedInSnapshot(source, snapshotPath) {
  if (!source || source.type !== "linkedin_capture_file") {
    throw new Error("LinkedIn snapshot import requires a linkedin_capture_file source.");
  }

  const snapshotText = readSourceText(snapshotPath, "LinkedIn snapshot file");
  const jobs = parseLinkedInSnapshot(snapshotText);
  return writeLinkedInCaptureFile(source, jobs);
}

export function collectMockLinkedInSavedSearch(source) {
  const records = readSourceJson(source.mockResultsPath, "Mock LinkedIn fixture");

  if (!Array.isArray(records)) {
    throw new Error(
      `Mock LinkedIn results in ${path.resolve(source.mockResultsPath)} must be an array.`
    );
  }

  return records;
}

export function collectLinkedInCaptureFile(source) {
  const payload = readSourceJson(source.capturePath, "LinkedIn capture file");

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(
      `LinkedIn capture in ${path.resolve(source.capturePath)} must be an object with a jobs array.`
    );
  }

  if (!Array.isArray(payload.jobs)) {
    throw new Error(
      `LinkedIn capture in ${path.resolve(source.capturePath)} must include a jobs array.`
    );
  }

  return payload.jobs;
}

export function collectJobsFromSource(source) {
  if (source.type === "mock_linkedin_saved_search") {
    return collectMockLinkedInSavedSearch(source);
  }

  if (source.type === "linkedin_capture_file") {
    return collectLinkedInCaptureFile(source);
  }

  if (source.type === "builtin_search") {
    return collectBuiltInJobsFromSearch(source);
  }

  throw new Error(`Unsupported source type: ${source.type}`);
}
