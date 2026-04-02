import { execFileSync } from "node:child_process";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

function normalizeText(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value) {
  const input = String(value || "");
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&#(\d+);/g, (_, numeric) => {
      const code = Number.parseInt(numeric, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "));
}

function normalizeLocationCandidate(value) {
  const text = normalizeText(value);
  if (!text) {
    return "";
  }
  if (/^(job description|responsibilities|requirements)$/i.test(text)) {
    return "";
  }
  return text;
}

function parseSalaryFromBaseSalary(baseSalary) {
  if (!baseSalary) {
    return "";
  }

  if (typeof baseSalary === "number") {
    return `$${Math.round(baseSalary).toLocaleString()}`;
  }

  if (typeof baseSalary === "string") {
    return normalizeText(baseSalary);
  }

  if (typeof baseSalary !== "object") {
    return "";
  }

  const value = baseSalary.value || baseSalary;
  if (typeof value === "number") {
    return `$${Math.round(value).toLocaleString()}`;
  }

  if (value && typeof value === "object") {
    const minValue = Number(value.minValue);
    const maxValue = Number(value.maxValue);
    const unitText = normalizeText(value.unitText || "");
    if (Number.isFinite(minValue) && Number.isFinite(maxValue)) {
      return `$${Math.round(minValue).toLocaleString()} - $${Math.round(maxValue).toLocaleString()}${unitText ? ` ${unitText}` : ""}`;
    }
    if (Number.isFinite(minValue)) {
      return `$${Math.round(minValue).toLocaleString()}${unitText ? ` ${unitText}` : ""}`;
    }
  }

  return "";
}

function extractLocationFromJobPosting(jobPosting) {
  if (!jobPosting || typeof jobPosting !== "object") {
    return "";
  }

  const candidates = [];
  const pushCandidate = (value) => {
    const normalized = normalizeLocationCandidate(value);
    if (normalized) {
      candidates.push(normalized);
    }
  };

  const collectLocation = (rawLocation) => {
    if (!rawLocation) {
      return;
    }
    if (Array.isArray(rawLocation)) {
      for (const entry of rawLocation) {
        collectLocation(entry);
      }
      return;
    }
    if (typeof rawLocation === "string") {
      pushCandidate(rawLocation);
      return;
    }
    if (typeof rawLocation !== "object") {
      return;
    }

    pushCandidate(rawLocation.name);
    const address = rawLocation.address;
    if (address && typeof address === "object") {
      const parts = [
        address.addressLocality,
        address.addressRegion,
        address.addressCountry
      ]
        .map((item) => normalizeLocationCandidate(item))
        .filter(Boolean);
      if (parts.length > 0) {
        pushCandidate(parts.join(", "));
      }
    }
  };

  collectLocation(jobPosting.jobLocation);
  collectLocation(jobPosting.applicantLocationRequirements);
  collectLocation(jobPosting.jobLocationType);

  if (candidates.length > 0) {
    return candidates[0];
  }

  return "";
}

function findJobPostingCandidates(parsed) {
  const candidates = [];
  const queue = Array.isArray(parsed) ? [...parsed] : [parsed];

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next || typeof next !== "object") {
      continue;
    }

    if (Array.isArray(next)) {
      queue.push(...next);
      continue;
    }

    const typeValue = next["@type"];
    const isJobPosting = Array.isArray(typeValue)
      ? typeValue.some((item) => normalizeText(String(item)).toLowerCase() === "jobposting")
      : normalizeText(String(typeValue || "")).toLowerCase() === "jobposting";

    if (isJobPosting) {
      candidates.push(next);
    }

    for (const value of Object.values(next)) {
      if (value && typeof value === "object") {
        queue.push(value);
      }
    }
  }

  return candidates;
}

export function parseJobPostingFromHtml(html) {
  const scriptPattern =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let best = null;

  for (const match of String(html || "").matchAll(scriptPattern)) {
    const payloadText = decodeHtmlEntities(String(match[1] || "").trim());
    if (!payloadText) {
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(payloadText);
    } catch {
      continue;
    }

    const candidates = findJobPostingCandidates(parsed);
    for (const jobPosting of candidates) {
      const description = normalizeText(stripTags(jobPosting.description || ""));
      const next = {
        postedAt: normalizeText(jobPosting.datePosted || jobPosting.datePublished || ""),
        salaryText: parseSalaryFromBaseSalary(jobPosting.baseSalary),
        employmentType: Array.isArray(jobPosting.employmentType)
          ? normalizeText(jobPosting.employmentType.filter(Boolean).join(" · "))
          : normalizeText(jobPosting.employmentType || ""),
        location: extractLocationFromJobPosting(jobPosting),
        description
      };

      if (!best || next.description.length > best.description.length) {
        best = next;
      }
    }
  }

  return best || {
    postedAt: "",
    salaryText: "",
    employmentType: "",
    location: "",
    description: ""
  };
}

export function parseDetailHintsFromText(inputText) {
  const text = normalizeText(stripTags(inputText));
  if (!text) {
    return {
      postedAt: "",
      salaryText: "",
      employmentType: "",
      location: "",
      description: ""
    };
  }

  const postedAt =
    text.match(
      /(\d+\s+(?:hour|day|week|month|year)s?\s+ago|today|yesterday|just posted|posted(?:\s+on)?\s+[a-z]{3,9}\s+\d{1,2},?\s+\d{2,4})/i
    )?.[1] || "";
  const salaryText =
    text.match(
      /(?:[$€£]\s*\d[\d,]*(?:\.\d+)?(?:[kKmM])?(?:\s*[-–]\s*[$€£]?\s*\d[\d,]*(?:\.\d+)?(?:[kKmM])?)?|(?:\d{2,3}\s*[Kk]\s*[-–]\s*\d{2,3}\s*[Kk]))(?:\s*(?:annually|yearly|monthly|weekly|hourly|per\s+(?:year|yr|hour|hr)|\/(?:year|yr|hour|hr)))?/i
    )?.[0] || "";
  const employmentType =
    text.match(
      /\b(full[- ]?time|part[- ]?time|contract|temporary|internship|freelance|apprenticeship)\b/i
    )?.[1] || "";
  const location =
    text.match(
      /\b(remote|hybrid|on-site|onsite|in-office|san francisco(?:,\s*ca)?|new york(?:,\s*ny)?|seattle(?:,\s*wa)?|austin(?:,\s*tx)?|los angeles(?:,\s*ca)?|california|united states)\b/i
    )?.[1] || "";

  return {
    postedAt: normalizeText(postedAt),
    salaryText: normalizeText(salaryText),
    employmentType: normalizeText(employmentType),
    location: normalizeText(location),
    description: text
  };
}

function fetchDetailHtml(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs);
  const timeoutSeconds = Math.max(
    5,
    Math.ceil((Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15_000) / 1000)
  );
  const userAgent = normalizeText(options.userAgent) || DEFAULT_USER_AGENT;

  return execFileSync(
    "curl",
    ["-sS", "-L", "-A", userAgent, "--max-time", String(timeoutSeconds), String(url)],
    {
      encoding: "utf8",
      maxBuffer: 15 * 1024 * 1024
    }
  );
}

function buildInitialProvenance(job) {
  const hasValue = (value) => normalizeText(value) && normalizeText(value).toLowerCase() !== "unknown";
  return {
    postedAt: hasValue(job?.postedAt) ? "card" : "fallback_unknown",
    salaryText: hasValue(job?.salaryText) ? "card" : "fallback_unknown",
    employmentType: hasValue(job?.employmentType) ? "card" : "fallback_unknown",
    location: hasValue(job?.location) ? "card" : "fallback_unknown",
    description:
      hasValue(job?.description) && normalizeText(job?.description).length > 20
        ? "card"
        : "fallback_unknown"
  };
}

function chooseField(currentValue, detailValue) {
  const current = normalizeText(currentValue);
  if (current && current.toLowerCase() !== "unknown") {
    return {
      value: currentValue,
      fromDetail: false
    };
  }

  const detail = normalizeText(detailValue);
  if (detail && detail.toLowerCase() !== "unknown") {
    return {
      value: detailValue,
      fromDetail: true
    };
  }

  return {
    value: currentValue,
    fromDetail: false
  };
}

export function enrichJobsWithDetailPages(sourceType, jobs, options = {}) {
  const source = normalizeText(sourceType).toLowerCase();
  const allowed = new Set([
    "linkedin_capture_file",
    "builtin_search",
    "ashby_search",
    "google_search",
    "ziprecruiter_search"
  ]);
  if (!allowed.has(source)) {
    return Array.isArray(jobs) ? jobs : [];
  }

  const inputJobs = Array.isArray(jobs) ? jobs : [];
  const maxJobs = Number(options.maxJobs);
  const limit = Number.isInteger(maxJobs) && maxJobs > 0 ? maxJobs : 25;

  return inputJobs.map((job, index) => {
    if (!job || typeof job !== "object") {
      return job;
    }

    const provenance = {
      ...buildInitialProvenance(job),
      ...(job.extractorProvenance && typeof job.extractorProvenance === "object"
        ? job.extractorProvenance
        : {})
    };
    const url = normalizeText(job.url || "");
    if (!url || index >= limit) {
      return {
        ...job,
        extractorProvenance: provenance
      };
    }

    let html = "";
    try {
      if (typeof options.fetchHtml === "function") {
        html = String(options.fetchHtml(url, source, job, index) || "");
      } else {
        html = fetchDetailHtml(url, options);
      }
    } catch {
      return {
        ...job,
        extractorProvenance: provenance
      };
    }

    const jsonLdMeta = parseJobPostingFromHtml(html);
    const textMeta = parseDetailHintsFromText(html);

    const mergedDetail = {
      postedAt: jsonLdMeta.postedAt || textMeta.postedAt,
      salaryText: jsonLdMeta.salaryText || textMeta.salaryText,
      employmentType: jsonLdMeta.employmentType || textMeta.employmentType,
      location: jsonLdMeta.location || textMeta.location,
      description: jsonLdMeta.description || textMeta.description
    };

    const postedAtChoice = chooseField(job.postedAt, mergedDetail.postedAt);
    const salaryChoice = chooseField(job.salaryText, mergedDetail.salaryText);
    const employmentChoice = chooseField(job.employmentType, mergedDetail.employmentType);
    const locationChoice = chooseField(job.location, mergedDetail.location);
    const descriptionChoice = chooseField(job.description, mergedDetail.description);

    if (postedAtChoice.fromDetail) provenance.postedAt = "detail";
    if (salaryChoice.fromDetail) provenance.salaryText = "detail";
    if (employmentChoice.fromDetail) provenance.employmentType = "detail";
    if (locationChoice.fromDetail) provenance.location = "detail";
    if (descriptionChoice.fromDetail) provenance.description = "detail";

    return {
      ...job,
      postedAt: postedAtChoice.value,
      salaryText: salaryChoice.value,
      employmentType: employmentChoice.value,
      location: locationChoice.value,
      description: descriptionChoice.value,
      extractorProvenance: provenance
    };
  });
}
