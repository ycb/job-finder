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

function clampScore(score) {
  if (score < 0) {
    return 0;
  }

  if (score > 100) {
    return 100;
  }

  return Math.round(score);
}

export function evaluateJob(profile, job) {
  const title = normalizeText(job.title);
  const company = normalizeText(job.company);
  const location = normalizeText(job.location);
  const description = normalizeText(job.description);
  const searchableText = [title, location, description].join(" ");

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

  const keywordMatches = findMatchingTerms(searchableText, profile.includeKeywords);
  if (keywordMatches.length > 0) {
    score += Math.min(14, keywordMatches.length * 7);
    reasons.push(`specialty signal "${keywordMatches.slice(0, 2).join('", "')}"`);
  }

  const excludedKeywordMatches = findMatchingTerms(searchableText, profile.excludeKeywords);
  const strongestExcludedKeyword = pickStrongestMatch(excludedKeywordMatches);
  if (strongestExcludedKeyword) {
    score -= 70;
    reasons.push(`blocked by exclude keyword "${strongestExcludedKeyword}"`);
  }

  const compensationFloor = parseCompensationFloor(job.salary_text || job.salaryText);
  if (compensationFloor !== null && compensationFloor >= profile.salaryFloor) {
    score += 8;
    reasons.push("salary floor met");
  } else if (compensationFloor !== null && compensationFloor < profile.salaryFloor) {
    score -= 10;
    reasons.push("salary floor missed");
  }

  const mentionsRemote = containsTerm(location, "remote") || containsTerm(description, "remote");
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
    evaluatedAt: new Date().toISOString()
  };
}

export function evaluateJobs(profile, jobs) {
  return jobs.map((job) => evaluateJob(profile, job));
}
