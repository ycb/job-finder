const KNOWN_SENIORITY_LEVELS = [
  "intern",
  "associate",
  "junior",
  "mid",
  "senior",
  "staff",
  "lead",
  "principal",
  "group",
  "director",
  "head",
  "vp",
  "vice president",
  "chief"
];

const WORK_TYPE_TOKENS = {
  remote: ["remote", "work from home", "wfh", "anywhere"],
  hybrid: ["hybrid", "flexible location"],
  "in-person": ["onsite", "on-site", "in office", "in-office", "office"]
};

function normalizeText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function containsTerm(haystack, term) {
  return haystack.includes(term);
}

function findMatchingTerms(haystack, terms) {
  const matches = [];

  for (const term of terms) {
    if (containsTerm(haystack, term) && !matches.includes(term)) {
      matches.push(term);
    }
  }

  return matches;
}

function pickStrongestMatch(matches) {
  return [...matches].sort((left, right) => right.length - left.length)[0] ?? null;
}

function extractSeniorityMatches(title) {
  return findMatchingTerms(title, KNOWN_SENIORITY_LEVELS);
}

function parseCompensationFloor(salaryText) {
  if (!salaryText) {
    return null;
  }

  const matches = salaryText.match(/\$?(\d{2,3})(?:,\d{3})?/g);
  if (!matches || matches.length === 0) {
    return null;
  }

  const parsed = matches
    .map((match) => Number(match.replace(/[^0-9]/g, "")))
    .filter((value) => Number.isFinite(value));

  if (parsed.length === 0) {
    return null;
  }

  if (parsed[0] < 1000) {
    return parsed[0] * 1000;
  }

  return parsed[0];
}

function parseDateToIso(value) {
  const raw = normalizeText(value);
  if (!raw) {
    return null;
  }

  const date = new Date(raw.replace(/^posted on\s+/i, ""));
  if (!Number.isNaN(date.getTime())) {
    return date.toISOString();
  }

  const relativeMatch = raw.match(/^(\d+)\s+(hour|day|week|month|year)s?\s+ago$/);
  if (relativeMatch) {
    const amount = Number(relativeMatch[1]);
    const unit = relativeMatch[2];
    const now = new Date();
    if (unit === "hour") {
      now.setHours(now.getHours() - amount);
    } else if (unit === "day") {
      now.setDate(now.getDate() - amount);
    } else if (unit === "week") {
      now.setDate(now.getDate() - amount * 7);
    } else if (unit === "month") {
      now.setMonth(now.getMonth() - amount);
    } else if (unit === "year") {
      now.setFullYear(now.getFullYear() - amount);
    }
    return now.toISOString();
  }

  if (raw === "today") {
    return new Date().toISOString();
  }

  if (raw === "yesterday") {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return yesterday.toISOString();
  }

  return null;
}

function inferWorkType(searchableText) {
  const normalized = normalizeText(searchableText);
  const matched = [];

  for (const [type, tokens] of Object.entries(WORK_TYPE_TOKENS)) {
    if (tokens.some((token) => normalized.includes(token))) {
      matched.push(type);
    }
  }

  return matched;
}

function calcFreshnessDays(job) {
  const posted = parseDateToIso(job.posted_at || job.postedAt);
  const updated = parseDateToIso(job.updated_at || job.updatedAt);
  const best = posted || updated;

  if (!best) {
    return null;
  }

  const ms = Date.now() - new Date(best).getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  return Number.isFinite(days) && days >= 0 ? days : null;
}

function calcFreshnessScore(days) {
  if (days === null) {
    return { delta: 0, reason: "freshness unknown" };
  }

  if (days <= 3) {
    return { delta: 10, reason: "very fresh posting" };
  }

  if (days <= 7) {
    return { delta: 6, reason: "fresh posting" };
  }

  if (days <= 14) {
    return { delta: 2, reason: "recent posting" };
  }

  if (days <= 30) {
    return { delta: -4, reason: "older posting" };
  }

  if (days <= 45) {
    return { delta: -8, reason: "stale posting" };
  }

  return { delta: -12, reason: "very stale posting" };
}

function calcDataConfidence(job, parsedWorkTypes) {
  let confidence = 35;

  if (normalizeText(job.title)) confidence += 8;
  if (normalizeText(job.company)) confidence += 8;
  if (normalizeText(job.location)) confidence += 8;
  if (normalizeText(job.employment_type || job.employmentType)) confidence += 8;
  if (normalizeText(job.salary_text || job.salaryText)) confidence += 10;
  if (parseDateToIso(job.posted_at || job.postedAt)) confidence += 10;
  if (parsedWorkTypes.length > 0) confidence += 6;

  const descriptionLength = normalizeText(job.description).length;
  if (descriptionLength >= 500) confidence += 12;
  else if (descriptionLength >= 220) confidence += 8;
  else if (descriptionLength >= 120) confidence += 4;

  return clampScore(confidence);
}

function sourceQualityDelta(job) {
  const source = normalizeText(job.source);
  if (source === "builtin_search") {
    return 3;
  }
  if (source === "wellfound_search") {
    return 2;
  }
  if (source === "ashby_search") {
    return 2;
  }
  if (source === "linkedin_capture_file") {
    return 2;
  }
  return 0;
}

function buildLearningModel(jobs) {
  const byCompany = new Map();

  for (const job of jobs) {
    const company = normalizeText(job.company);
    if (!company) {
      continue;
    }

    const current = byCompany.get(company) || {
      applied: 0,
      rejected: 0,
      skipped: 0
    };

    const status = normalizeText(job.status || "new");
    if (status === "applied") {
      current.applied += 1;
    } else if (status === "rejected") {
      current.rejected += 1;
    } else if (status === "skip_for_now") {
      current.skipped += 1;
    }

    byCompany.set(company, current);
  }

  return { byCompany };
}

function computeLearningDelta(learningModel, company) {
  if (!learningModel?.byCompany) {
    return { delta: 0, reason: null };
  }

  const stats = learningModel.byCompany.get(company);
  if (!stats) {
    return { delta: 0, reason: null };
  }

  const delta = Math.max(
    -12,
    Math.min(12, stats.applied * 3 - stats.rejected * 2 - stats.skipped)
  );

  if (delta === 0) {
    return { delta: 0, reason: null };
  }

  if (delta > 0) {
    return {
      delta,
      reason: `historical positive signal at "${company}" (+${delta})`
    };
  }

  return {
    delta,
    reason: `historical negative signal at "${company}" (${delta})`
  };
}

function matchAnyTerm(haystack, terms) {
  const normalizedTerms = Array.isArray(terms) ? terms : [];
  return findMatchingTerms(haystack, normalizedTerms);
}

function evaluateHardFilters({
  profile,
  searchableText,
  workTypes,
  salaryFloor,
  reasons
}) {
  const blockedReasons = [];
  const excludedKeywordMatches = matchAnyTerm(searchableText, profile.excludeKeywords);
  const strongestExcludedKeyword = pickStrongestMatch(excludedKeywordMatches);

  if (strongestExcludedKeyword) {
    blockedReasons.push(`hard filter hit: exclude keyword "${strongestExcludedKeyword}"`);
  }

  if (
    Number.isFinite(profile?.dealBreakers?.salaryMinimum) &&
    profile.dealBreakers.salaryMinimum > 0 &&
    salaryFloor !== null &&
    salaryFloor < profile.dealBreakers.salaryMinimum
  ) {
    blockedReasons.push("hard filter hit: salary below deal-breaker minimum");
  }

  const hardWorkTypes = Array.isArray(profile?.dealBreakers?.workType)
    ? profile.dealBreakers.workType
    : [];
  if (hardWorkTypes.length > 0 && workTypes.length > 0) {
    const normalizedHardTypes = new Set(hardWorkTypes.map((value) => normalizeText(value)));
    const hasMatch = workTypes.some((value) => normalizedHardTypes.has(normalizeText(value)));
    if (!hasMatch) {
      blockedReasons.push(
        `hard filter hit: work type outside deal-breaker range (${hardWorkTypes.join(", ")})`
      );
    }
  }

  for (const blockedReason of blockedReasons) {
    reasons.push(blockedReason);
  }

  return {
    blocked: blockedReasons.length > 0,
    blockedReasons
  };
}

function clampScore(score) {
  if (score < 0) {
    return 0;
  }

  if (score > 100) {
    return 100;
  }

  return Math.round(score);
}

function normalizeSearchCriteriaText(value) {
  return String(value || "").trim();
}

function splitSearchKeywords(value) {
  const normalized = normalizeSearchCriteriaText(value);
  if (!normalized) {
    return [];
  }

  return normalized
    .split(/[;,]/)
    .flatMap((segment) => segment.split(/\band\b/i))
    .map((token) => normalizeSearchCriteriaText(token).toLowerCase())
    .filter(Boolean);
}

function normalizeCriteriaTermList(rawTerms) {
  if (Array.isArray(rawTerms)) {
    const deduped = [];
    for (const term of rawTerms) {
      const normalized = normalizeSearchCriteriaText(term).toLowerCase();
      if (normalized && !deduped.includes(normalized)) {
        deduped.push(normalized);
      }
    }
    return deduped;
  }

  return splitSearchKeywords(rawTerms);
}

function normalizeKeywordMode(rawKeywordMode) {
  const normalized = normalizeSearchCriteriaText(rawKeywordMode).toLowerCase();
  return normalized === "or" ? "or" : "and";
}

function resolvePositiveKeywordTerms(rawCriteria = {}) {
  const deduped = [];
  const pushTerm = (term) => {
    if (term && !deduped.includes(term)) {
      deduped.push(term);
    }
  };

  for (const term of splitSearchKeywords(rawCriteria.keywords)) {
    pushTerm(term);
  }

  for (const term of normalizeCriteriaTermList(rawCriteria.includeTerms)) {
    pushTerm(term);
  }

  return deduped;
}

function resolveExcludeKeywordTerms(rawCriteria = {}) {
  return normalizeCriteriaTermList(rawCriteria.excludeTerms);
}

const SEARCH_CRITERIA_DATE_POSTED_TO_DAYS = new Map([
  ["1d", 1],
  ["3d", 3],
  ["1w", 7],
  ["2w", 14],
  ["1m", 30]
]);

const SEARCH_CRITERIA_WEIGHTS = {
  title: 35,
  keywords: 25,
  location: 15,
  salary: 15,
  freshness: 10
};

function isAiLikeTerm(term) {
  return term === "ai" || term === "ml" || term === "llm" || term === "genai";
}

function termMatchesSearchText(term, text) {
  if (!term) {
    return true;
  }

  if (!text) {
    return false;
  }

  if (isAiLikeTerm(term)) {
    return /\b(ai|a\.i\.|genai|gen ai|llm|ml|machine learning|artificial intelligence)\b/.test(
      text
    );
  }

  if (term === "product manager") {
    return /\bproduct manager\b/.test(text) || /\bpm\b/.test(text);
  }

  return text.includes(term);
}

function normalizeCriteriaTitleTokens(value) {
  return normalizeSearchCriteriaText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => (token === "pm" ? "product manager" : token))
    .filter((token) => token !== "and" && token !== "or");
}

function matchesTitleCriteria(jobTitle, criteriaTitle) {
  const normalizedJobTitle = normalizeText(jobTitle);
  const normalizedCriteriaTitle = normalizeSearchCriteriaText(criteriaTitle).toLowerCase();

  if (!normalizedJobTitle || !normalizedCriteriaTitle) {
    return false;
  }

  if (termMatchesSearchText(normalizedCriteriaTitle, normalizedJobTitle)) {
    return true;
  }

  const tokens = normalizeCriteriaTitleTokens(normalizedCriteriaTitle);
  if (tokens.length === 0) {
    return false;
  }

  return tokens.every((token) => termMatchesSearchText(token, normalizedJobTitle));
}

function keywordMatchRatio(searchableText, keywordTerms) {
  const terms = Array.isArray(keywordTerms) ? keywordTerms : [];
  if (terms.length === 0) {
    return 0;
  }

  const matchedCount = terms.filter((term) => termMatchesSearchText(term, searchableText))
    .length;

  return matchedCount / terms.length;
}

function matchesLocationCriteria(jobLocation, criteriaLocation) {
  const normalizedJobLocation = normalizeText(jobLocation);
  const normalizedCriteriaLocation = normalizeSearchCriteriaText(criteriaLocation).toLowerCase();

  if (!normalizedJobLocation || !normalizedCriteriaLocation) {
    return false;
  }

  return (
    normalizedJobLocation.includes(normalizedCriteriaLocation) ||
    normalizedCriteriaLocation.includes(normalizedJobLocation)
  );
}

function resolveCriteriaFreshnessDays(datePosted) {
  const normalized = normalizeSearchCriteriaText(datePosted).toLowerCase();
  if (!normalized || normalized === "any") {
    return null;
  }

  return SEARCH_CRITERIA_DATE_POSTED_TO_DAYS.get(normalized) ?? null;
}

function hasSearchCriteriaSignal(rawCriteria = {}) {
  const title = normalizeSearchCriteriaText(rawCriteria.title);
  const keywords = resolvePositiveKeywordTerms(rawCriteria);
  const location = normalizeSearchCriteriaText(rawCriteria.location);
  const minSalary = Number(rawCriteria.minSalary);
  const freshnessDays = resolveCriteriaFreshnessDays(rawCriteria.datePosted);

  return (
    Boolean(title) ||
    keywords.length > 0 ||
    Boolean(location) ||
    (Number.isFinite(minSalary) && minSalary > 0) ||
    freshnessDays !== null
  );
}

export function buildScoringProfileFromSearchCriteria(rawCriteria = {}) {
  const title = normalizeSearchCriteriaText(rawCriteria.title).toLowerCase();
  const keywords = resolvePositiveKeywordTerms(rawCriteria);
  const excludeTerms = resolveExcludeKeywordTerms(rawCriteria);
  const location = normalizeSearchCriteriaText(rawCriteria.location).toLowerCase();
  const minSalaryValue = Number(rawCriteria.minSalary);
  const minSalary =
    Number.isFinite(minSalaryValue) && minSalaryValue > 0
      ? Math.round(minSalaryValue)
      : 0;

  return {
    candidateName: "Search Criteria",
    targetTitles: title ? [title] : ["product manager"],
    targetLocations: location ? [location] : [],
    remotePreference: "onsite_ok",
    workTypePreferences: [],
    salaryFloor: minSalary,
    seniorityLevels: [...KNOWN_SENIORITY_LEVELS],
    preferredIndustries: [],
    preferredBusinessModels: [],
    preferredCompanyMaturity: [],
    targetCompanies: [],
    includeKeywords: keywords,
    excludeKeywords: excludeTerms,
    dealBreakers: {
      salaryMinimum: minSalary,
      workType: [],
      companyMaturity: []
    }
  };
}

function evaluateJobFromSearchCriteria(criteria, job) {
  const titleCriteria = normalizeSearchCriteriaText(criteria?.title).toLowerCase();
  const keywordCriteria = resolvePositiveKeywordTerms(criteria);
  const excludeTerms = resolveExcludeKeywordTerms(criteria);
  const keywordMode = normalizeKeywordMode(criteria?.keywordMode);
  const locationCriteria = normalizeSearchCriteriaText(criteria?.location).toLowerCase();
  const minSalaryValue = Number(criteria?.minSalary);
  const minSalary =
    Number.isFinite(minSalaryValue) && minSalaryValue > 0
      ? Math.round(minSalaryValue)
      : 0;
  const freshnessDaysTarget = resolveCriteriaFreshnessDays(criteria?.datePosted);

  const title = normalizeText(job.title);
  const location = normalizeText(job.location);
  const description = normalizeText(job.description);
  const employment = normalizeText(job.employment_type || job.employmentType);
  const searchableText = [title, location, employment, description].join(" ");
  const parsedWorkTypes = inferWorkType(searchableText);
  const salaryFloor = parseCompensationFloor(job.salary_text || job.salaryText);
  const freshnessDays = calcFreshnessDays(job);
  const excludedMatches = findMatchingTerms(searchableText, excludeTerms);
  const strongestExcludedTerm = pickStrongestMatch(excludedMatches);

  if (strongestExcludedTerm) {
    const reason = `hard filter hit: exclude term "${strongestExcludedTerm}"`;
    return {
      jobId: job.id,
      score: 0,
      bucket: "reject",
      summary: `Score 0: ${reason}`,
      reasons: [reason],
      confidence: calcDataConfidence(job, parsedWorkTypes),
      freshnessDays,
      hardFiltered: true,
      evaluatedAt: new Date().toISOString()
    };
  }

  let matchedWeight = 0;
  let totalWeight = 0;
  const reasons = [];
  let titleMatched = true;

  if (titleCriteria) {
    totalWeight += SEARCH_CRITERIA_WEIGHTS.title;
    titleMatched = matchesTitleCriteria(title, titleCriteria);
    if (titleMatched) {
      matchedWeight += SEARCH_CRITERIA_WEIGHTS.title;
      reasons.push("title matched");
    } else {
      reasons.push("title did not match");
    }
  }

  if (keywordCriteria.length > 0) {
    totalWeight += SEARCH_CRITERIA_WEIGHTS.keywords;
    const ratio = keywordMatchRatio(searchableText, keywordCriteria);
    const matched = Math.round(ratio * keywordCriteria.length);
    if (keywordMode === "or") {
      if (matched > 0) {
        matchedWeight += SEARCH_CRITERIA_WEIGHTS.keywords;
        reasons.push(`keywords matched in OR mode (${matched}/${keywordCriteria.length})`);
      } else {
        reasons.push("keywords did not match in OR mode");
      }
    } else if (ratio >= 1) {
      matchedWeight += SEARCH_CRITERIA_WEIGHTS.keywords;
      reasons.push(`keywords matched all (${matched}/${keywordCriteria.length})`);
    } else if (ratio > 0) {
      matchedWeight += SEARCH_CRITERIA_WEIGHTS.keywords * ratio * 0.5;
      reasons.push(`keywords partially matched in AND mode (${matched}/${keywordCriteria.length})`);
    } else {
      reasons.push("keywords did not match in AND mode");
    }
  }

  if (locationCriteria) {
    totalWeight += SEARCH_CRITERIA_WEIGHTS.location;
    if (matchesLocationCriteria(location, locationCriteria)) {
      matchedWeight += SEARCH_CRITERIA_WEIGHTS.location;
      reasons.push("location matched");
    } else {
      reasons.push("location did not match");
    }
  }

  if (minSalary > 0) {
    totalWeight += SEARCH_CRITERIA_WEIGHTS.salary;
    if (salaryFloor !== null && salaryFloor >= minSalary) {
      matchedWeight += SEARCH_CRITERIA_WEIGHTS.salary;
      reasons.push("salary matched");
    } else if (salaryFloor === null) {
      reasons.push("salary unavailable");
    } else {
      reasons.push("salary below target");
    }
  }

  if (freshnessDaysTarget !== null) {
    totalWeight += SEARCH_CRITERIA_WEIGHTS.freshness;
    if (freshnessDays !== null && freshnessDays <= freshnessDaysTarget) {
      matchedWeight += SEARCH_CRITERIA_WEIGHTS.freshness;
      reasons.push("freshness matched");
    } else if (freshnessDays === null) {
      reasons.push("freshness unavailable");
    } else {
      reasons.push("freshness outside target");
    }
  }

  let finalScore =
    totalWeight > 0 ? clampScore((matchedWeight / totalWeight) * 100) : 0;
  if (titleCriteria && !titleMatched) {
    finalScore = Math.min(finalScore, 25);
  }
  const bucket =
    finalScore >= 70 ? "high_signal" : finalScore >= 40 ? "review_later" : "reject";
  const summary =
    reasons.length > 0
      ? `Score ${finalScore}: ${reasons.slice(0, 3).join(", ")}`
      : `Score ${finalScore}: no criteria provided`;

  return {
    jobId: job.id,
    score: finalScore,
    bucket,
    summary,
    reasons,
    confidence: calcDataConfidence(job, parsedWorkTypes),
    freshnessDays,
    hardFiltered: false,
    evaluatedAt: new Date().toISOString()
  };
}

export function evaluateJob(profile, job) {
  const title = normalizeText(job.title);
  const company = normalizeText(job.company);
  const location = normalizeText(job.location);
  const description = normalizeText(job.description);
  const employment = normalizeText(job.employment_type || job.employmentType);
  const searchableText = [title, location, employment, description].join(" ");
  const parsedWorkTypes = inferWorkType(searchableText);
  const salaryFloor = parseCompensationFloor(job.salary_text || job.salaryText);

  let score = 0;
  const reasons = [];

  const titleMatches = findMatchingTerms(title, profile.targetTitles);
  const strongestTitleMatch = pickStrongestMatch(titleMatches);
  if (strongestTitleMatch) {
    score += 35;
    reasons.push(`title family matches "${strongestTitleMatch}"`);
  } else {
    score -= 25;
    reasons.push("title family not in preferred set");
  }

  const titleSeniorityMatches = extractSeniorityMatches(title);
  const allowedSeniorityMatches = titleSeniorityMatches.filter((term) =>
    profile.seniorityLevels.includes(term)
  );
  const blockedSeniorityMatches = titleSeniorityMatches.filter(
    (term) => !profile.seniorityLevels.includes(term)
  );
  const strongestAllowedSeniority = pickStrongestMatch(allowedSeniorityMatches);
  const strongestBlockedSeniority = pickStrongestMatch(blockedSeniorityMatches);

  if (strongestAllowedSeniority) {
    score += 12;
    reasons.push(`seniority aligns with "${strongestAllowedSeniority}"`);
  } else if (strongestBlockedSeniority) {
    score -= 18;
    reasons.push(`seniority outside range "${strongestBlockedSeniority}"`);
  }

  const locationMatches = findMatchingTerms(location, profile.targetLocations);
  const strongestLocationMatch = pickStrongestMatch(locationMatches);
  if (strongestLocationMatch) {
    score += 12;
    reasons.push(`location aligns with "${strongestLocationMatch}"`);
  }

  const companyMatches = findMatchingTerms(company, profile.targetCompanies);
  const strongestCompanyMatch = pickStrongestMatch(companyMatches);
  if (strongestCompanyMatch) {
    score += 15;
    reasons.push(`target company match "${strongestCompanyMatch}"`);
  }

  const industryMatches = findMatchingTerms(searchableText, profile.preferredIndustries);
  if (industryMatches.length > 0) {
    score += Math.min(12, industryMatches.length * 6);
    reasons.push(`industry signal "${industryMatches.slice(0, 2).join('", "')}"`);
  }

  const businessModelMatches = findMatchingTerms(
    searchableText,
    profile.preferredBusinessModels
  );
  if (businessModelMatches.length > 0) {
    score += Math.min(10, businessModelMatches.length * 5);
    reasons.push(`business model signal "${businessModelMatches.slice(0, 2).join('", "')}"`);
  }

  const companyMaturityMatches = findMatchingTerms(
    searchableText,
    profile.preferredCompanyMaturity
  );
  if (companyMaturityMatches.length > 0) {
    score += Math.min(8, companyMaturityMatches.length * 4);
    reasons.push(
      `company maturity signal "${companyMaturityMatches.slice(0, 2).join('", "')}"`,
    );
  }

  const keywordMatches = findMatchingTerms(searchableText, profile.includeKeywords);
  if (keywordMatches.length > 0) {
    score += Math.min(14, keywordMatches.length * 7);
    reasons.push(`specialty signal "${keywordMatches.slice(0, 2).join('", "')}"`);
  }

  if (salaryFloor !== null && salaryFloor >= profile.salaryFloor) {
    score += 8;
    reasons.push("salary floor met");
  } else if (salaryFloor !== null && salaryFloor < profile.salaryFloor) {
    score -= 10;
    reasons.push("salary floor missed");
  }

  const mentionsRemote =
    containsTerm(location, "remote") ||
    containsTerm(description, "remote") ||
    parsedWorkTypes.includes("remote");
  if (profile.remotePreference === "remote_only") {
    if (mentionsRemote) {
      score += 15;
      reasons.push("remote requirement satisfied");
    } else {
      score -= 40;
      reasons.push("remote requirement not satisfied");
    }
  } else if (profile.remotePreference === "remote_friendly" && mentionsRemote) {
    score += 8;
    reasons.push("remote-friendly signal");
  }

  if (Array.isArray(profile.workTypePreferences) && profile.workTypePreferences.length > 0) {
    const normalizedPreferences = new Set(
      profile.workTypePreferences.map((value) => normalizeText(value))
    );
    if (parsedWorkTypes.some((value) => normalizedPreferences.has(normalizeText(value)))) {
      score += 8;
      reasons.push("work type preference matched");
    }
  }

  const sourceDelta = sourceQualityDelta(job);
  if (sourceDelta !== 0) {
    score += sourceDelta;
    reasons.push(`source quality bonus +${sourceDelta}`);
  }

  const freshnessDays = calcFreshnessDays(job);
  const freshness = calcFreshnessScore(freshnessDays);
  score += freshness.delta;
  reasons.push(freshness.reason);

  const confidence = calcDataConfidence(job, parsedWorkTypes);
  if (confidence < 45) {
    score -= 8;
    reasons.push(`low data confidence (${confidence})`);
  } else if (confidence >= 80) {
    score += 2;
    reasons.push(`high data confidence (${confidence})`);
  }

  const hardFilter = evaluateHardFilters({
    profile,
    searchableText,
    workTypes: parsedWorkTypes,
    salaryFloor,
    reasons
  });
  if (hardFilter.blocked) {
    return {
      jobId: job.id,
      score: 0,
      bucket: "reject",
      summary: `Score 0: ${hardFilter.blockedReasons[0]}`,
      reasons,
      confidence,
      freshnessDays,
      hardFiltered: true,
      evaluatedAt: new Date().toISOString()
    };
  }

  const finalScore = clampScore(score);
  const bucket =
    finalScore >= 70 ? "high_signal" : finalScore >= 40 ? "review_later" : "reject";
  const summary =
    reasons.length > 0
      ? `Score ${finalScore}: ${reasons.slice(0, 3).join(", ")}`
      : `Score ${finalScore}: no strong matching signals found`;

  return {
    jobId: job.id,
    score: finalScore,
    bucket,
    summary,
    reasons,
    confidence,
    freshnessDays,
    hardFiltered: false,
    evaluatedAt: new Date().toISOString()
  };
}

export function evaluateJobs(profile, jobs, options = {}) {
  const learningModel = options.learningModel || buildLearningModel(jobs);
  return jobs.map((job) => {
    const base = evaluateJob(profile, job);
    const learning = computeLearningDelta(learningModel, normalizeText(job.company));
    if (!learning.reason || base.hardFiltered) {
      return base;
    }

    const score = clampScore(base.score + learning.delta);
    const bucket = score >= 70 ? "high_signal" : score >= 40 ? "review_later" : "reject";
    const reasons = [...base.reasons, learning.reason];
    const summary =
      reasons.length > 0
        ? `Score ${score}: ${reasons.slice(0, 3).join(", ")}`
        : `Score ${score}: no strong matching signals found`;

    return {
      ...base,
      score,
      bucket,
      summary,
      reasons
    };
  });
}

export function evaluateJobsFromSearchCriteria(searchCriteria, jobs, options = {}) {
  const jobList = Array.isArray(jobs) ? jobs : [];
  if (!hasSearchCriteriaSignal(searchCriteria)) {
    const fallbackProfile = buildScoringProfileFromSearchCriteria(searchCriteria);
    return evaluateJobs(fallbackProfile, jobList, options);
  }

  return jobList.map((job) => evaluateJobFromSearchCriteria(searchCriteria, job, options));
}
