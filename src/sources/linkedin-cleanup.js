function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseUrlSafe(rawUrl) {
  try {
    return new URL(String(rawUrl || "").trim());
  } catch {
    return null;
  }
}

function extractLinkedInExternalIdFromUrl(rawUrl) {
  const parsed = parseUrlSafe(rawUrl);
  if (!parsed) {
    return "";
  }

  const pathMatch = parsed.pathname.match(/\/jobs\/view\/(\d+)/i);
  if (pathMatch?.[1]) {
    return pathMatch[1];
  }

  const paramId = parsed.searchParams.get("currentJobId") || parsed.searchParams.get("jobId");
  return /^\d+$/.test(String(paramId || "")) ? String(paramId) : "";
}

function canonicalizeLinkedInUrl(rawUrl, externalId) {
  const linkedInId = normalizeText(externalId) || extractLinkedInExternalIdFromUrl(rawUrl);
  if (linkedInId) {
    return `https://www.linkedin.com/jobs/view/${linkedInId}/`;
  }

  const parsed = parseUrlSafe(rawUrl);
  if (!parsed) {
    return normalizeText(rawUrl);
  }

  if (
    parsed.hostname === "linkedin.com" ||
    parsed.hostname.endsWith(".linkedin.com")
  ) {
    if (/\/jobs\/search-results\/?/i.test(parsed.pathname)) {
      return parsed.toString();
    }
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString();
  }

  return normalizeText(rawUrl);
}

function buildLinkedInSearchUrl(title, company) {
  const query = [normalizeText(title), normalizeText(company)].filter(Boolean).join(" ");
  const params = new URLSearchParams({
    keywords: query
  });

  return `https://www.linkedin.com/jobs/search-results/?${params.toString()}`;
}

function collapseRepeatedPhrase(value) {
  let current = normalizeText(value);
  if (!current) {
    return "";
  }

  const duplicatePrefixMatch = current.match(/^(.+?)\s+\1(?:\s+.*)?$/i);
  if (duplicatePrefixMatch?.[1]) {
    current = duplicatePrefixMatch[1];
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
}

function splitDescriptionTokens(value) {
  return normalizeText(value)
    .split(/\s*·\s*/)
    .map((token) => normalizeText(token))
    .filter(Boolean);
}

function isNoiseToken(value) {
  const token = normalizeText(value);
  if (!token) {
    return true;
  }

  return (
    /^\d{1,2}$/.test(token) ||
    /\b(?:easy apply|actively reviewing applicants|saved|viewed|applied)\b/i.test(token) ||
    /\b\d+\s+(?:school alumni works? here|school alumni work here|connections? works? here)\b/i.test(
      token
    ) ||
    /^posted on /i.test(token) ||
    /(?:hour|day|week|month|year)s?\s+ago/i.test(token) ||
    /\b(?:medical|vision|dental|401\(k\)|benefits?)\b/i.test(token)
  );
}

function looksLikeEmploymentType(value) {
  return /\b(full[- ]?time|part[- ]?time|contract|temporary|internship|freelance|apprenticeship)\b/i.test(
    normalizeText(value)
  );
}

function looksLikeSalary(value) {
  return /[$€£]\s*\d|\b\d{2,3}\s*[Kk]\b/.test(normalizeText(value));
}

export function sanitizeLinkedInTitle(value, { company = "", location = "" } = {}) {
  let sanitized = normalizeText(value)
    .replace(/\s*\(Verified job\)\s*/gi, " ")
    .replace(/\s+with verification\b/gi, " ")
    .replace(/\b(?:easy apply|actively reviewing applicants|saved|viewed|applied)\b/gi, " ")
    .replace(/\b\d+\s+(?:school alumni works? here|school alumni work here|connections? works? here)\b/gi, " ")
    .replace(/posted on .+$/i, " ")
    .replace(/benefits?.*$/i, " ")
    .replace(/medical,.*$/i, " ")
    .replace(/vision,.*$/i, " ")
    .replace(/dental,.*$/i, " ")
    .replace(/401\(k\).*$/i, " ");

  const companyText = normalizeText(company);
  if (companyText) {
    const companyIndex = sanitized.toLowerCase().indexOf(companyText.toLowerCase());
    if (companyIndex > 0) {
      sanitized = sanitized.slice(0, companyIndex);
    }
  }

  const locationText = normalizeText(location);
  if (locationText) {
    const locationIndex = sanitized.toLowerCase().indexOf(locationText.toLowerCase());
    if (locationIndex > 0) {
      sanitized = sanitized.slice(0, locationIndex);
    }
  }

  sanitized = collapseRepeatedPhrase(normalizeText(sanitized));
  sanitized = collapseRepeatedPhrase(normalizeText(sanitized.replace(/ · /g, " ")));
  return normalizeText(sanitized);
}

function parseLinkedInSalaryFloor(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  const match = normalized.match(/\$\s*([\d,]+(?:\.\d+)?)([kKmM])?/);
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
}

export function sanitizeLinkedInSalaryText(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  const salaryFloor = parseLinkedInSalaryFloor(normalized);
  if (!Number.isFinite(salaryFloor)) {
    return null;
  }

  return salaryFloor >= 20_000 && salaryFloor <= 1_500_000 ? normalized : null;
}

export function chooseLinkedInSalaryText(cardSalaryText, detailSalaryText) {
  const card = sanitizeLinkedInSalaryText(cardSalaryText);
  if (card) {
    return card;
  }

  return sanitizeLinkedInSalaryText(detailSalaryText);
}

function inferLinkedInCompany(job, title, location) {
  const currentCompany = normalizeText(job?.company);
  const cleanedCurrentCompany = sanitizeLinkedInCompany(currentCompany, { title, location });
  if (cleanedCurrentCompany && cleanedCurrentCompany !== title) {
    return cleanedCurrentCompany;
  }

  for (const token of splitDescriptionTokens(job?.description || job?.summary || "")) {
    if (
      !token ||
      token === title ||
      token === location ||
      isNoiseToken(token) ||
      looksLikeEmploymentType(token) ||
      looksLikeSalary(token)
    ) {
      continue;
    }

    return sanitizeLinkedInCompany(token, { title, location });
  }

  return cleanedCurrentCompany;
}

function sanitizeLinkedInCompany(value, { title = "", location = "" } = {}) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }

  const tokens = splitDescriptionTokens(normalized)
    .map((token) => normalizeText(token))
    .filter(Boolean);

  const locationText = normalizeText(location);
  const filtered = tokens.filter((token) => {
    if (!token || token === title) {
      return false;
    }
    if (locationText && (token === locationText || token.includes(locationText))) {
      return false;
    }
    if (isNoiseToken(token) || looksLikeEmploymentType(token) || looksLikeSalary(token)) {
      return false;
    }
    return true;
  });

  return normalizeText(filtered[0] || normalized);
}

function sanitizeLinkedInDescription(value) {
  const deduped = [];

  for (const token of splitDescriptionTokens(value)) {
    const cleaned = sanitizeLinkedInTitle(token);
    if (!cleaned || isNoiseToken(cleaned) || deduped.includes(cleaned)) {
      continue;
    }
    deduped.push(cleaned);
  }

  return deduped.join(" · ");
}

function looksLikeLinkedInMetadataSummary(value) {
  const tokens = splitDescriptionTokens(value);
  if (tokens.length < 3) {
    return false;
  }

  return tokens.every((token) => {
    if (!token || token.length > 80) {
      return false;
    }
    return !/[.!?]/.test(token);
  });
}

function sanitizeLinkedInDetailDescription(value) {
  return normalizeText(value)
    .replace(/\bsee more\b/gi, " ")
    .replace(/\bshow more\b/gi, " ")
    .replace(/\babout the job\b[:\s-]*/i, "About the job ")
    .replace(/\s+/g, " ")
    .trim();
}

export function chooseLinkedInDescription(
  { description = "", summary = "", detailDescription = "", detail_description = "" } = {}
) {
  const detail = sanitizeLinkedInDetailDescription(detailDescription || detail_description);
  const fallback = sanitizeLinkedInDescription(description || summary || "");

  if (
    detail &&
    (!looksLikeLinkedInMetadataSummary(detail) || detail.length > fallback.length + 40)
  ) {
    return detail;
  }

  return fallback;
}

function chooseTrustedLinkedInDetail(job, externalId) {
  const detailExternalId = normalizeText(
    job?.detailExternalId || job?.detail_external_id
  );
  if (detailExternalId && externalId && detailExternalId === externalId) {
    return {
      detailDescription: job?.detailDescription || job?.detail_description || "",
      detailExternalId
    };
  }

  return {
    detailDescription: "",
    detailExternalId
  };
}

export function isLinkedInSourceType(sourceType) {
  const normalized = normalizeText(sourceType).toLowerCase();
  return normalized === "linkedin_capture_file" || normalized === "mock_linkedin_saved_search";
}

export function isLinkedInJob(job = {}, context = {}) {
  return (
    isLinkedInSourceType(
      context?.sourceType || job?.source || job?.sourceType || job?.type
    ) || String(context?.sourceId || job?.sourceId || "").toLowerCase().includes("linkedin")
  );
}

export function sanitizeLinkedInJob(job = {}, context = {}) {
  if (!isLinkedInJob(job, context)) {
    return job;
  }

  const currentUrl = normalizeText(job.url || job.sourceUrl);
  const externalId =
    normalizeText(job.externalId) || extractLinkedInExternalIdFromUrl(currentUrl);
  const trustedDetail = chooseTrustedLinkedInDetail(job, externalId);
  const location = normalizeText(job.location);
  let title = sanitizeLinkedInTitle(job.title, {
    company: job.company,
    location
  });
  const company = inferLinkedInCompany(job, title, location);
  title = sanitizeLinkedInTitle(title, { company, location });
  const description = chooseLinkedInDescription({
    ...job,
    detailDescription: trustedDetail.detailDescription,
    detail_description: trustedDetail.detailDescription
  });
  const salaryText = chooseLinkedInSalaryText(
    job.salaryText || job.salary_text,
    ""
  );
  const summary = normalizeText([title, company, location].filter(Boolean).join(" · "));
  const canonicalUrl =
    /linkedin\.com\/jobs\/search-results\/?/i.test(currentUrl) && !externalId
      ? buildLinkedInSearchUrl(title, company)
      : canonicalizeLinkedInUrl(currentUrl, externalId);

  return {
    ...job,
    title: title || normalizeText(job.title),
    company: company || normalizeText(job.company),
    location: location || normalizeText(job.location),
    description: description || normalizeText(job.description),
    summary: summary || normalizeText(job.summary),
    externalId: externalId || null,
    detailExternalId: trustedDetail.detailExternalId || null,
    detail_external_id: Object.prototype.hasOwnProperty.call(job, "detail_external_id")
      ? trustedDetail.detailExternalId || null
      : job.detail_external_id,
    url: Object.prototype.hasOwnProperty.call(job, "url") ? canonicalUrl : job.url,
    sourceUrl: Object.prototype.hasOwnProperty.call(job, "sourceUrl")
      ? canonicalUrl
      : job.sourceUrl,
    salaryText,
    salary_text:
      Object.prototype.hasOwnProperty.call(job, "salary_text") ? salaryText : job.salary_text
  };
}
