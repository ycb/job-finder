function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTerm(value) {
  return normalizeText(value).toLowerCase();
}

function uniqueTerms(values) {
  const seen = new Set();
  const output = [];

  for (const value of values) {
    const normalized = normalizeTerm(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
  }

  return output;
}

function parseSearchUrl(source) {
  try {
    return new URL(String(source?.searchUrl || "").trim());
  } catch {
    return null;
  }
}

function extractIntentStrings(source) {
  const values = [];
  const criteriaKeywords = normalizeText(source?.searchCriteria?.keywords || "");
  if (criteriaKeywords) {
    values.push(criteriaKeywords);
  }

  const parsedUrl = parseSearchUrl(source);
  if (parsedUrl) {
    const fromParams = [
      parsedUrl.searchParams.get("keywords"),
      parsedUrl.searchParams.get("q"),
      parsedUrl.searchParams.get("search")
    ];

    for (const value of fromParams) {
      const normalized = normalizeText(value);
      if (normalized) {
        values.push(normalized);
      }
    }
  }

  const sourceName = normalizeText(source?.name || "");
  if (sourceName) {
    values.push(sourceName);
  }

  return values;
}

function inferTermsFromIntent(intent) {
  const raw = normalizeText(intent).toLowerCase();
  if (!raw) {
    return [];
  }

  const terms = [];

  if (/\bproduct\s+manager\b/.test(raw) || /\bproduct\s+management\b/.test(raw)) {
    terms.push("product manager");
  } else if (/\bprogram\s+manager\b/.test(raw) || /\bprogram\s+management\b/.test(raw)) {
    terms.push("program manager");
  }

  if (
    /\b(ai|a\.i\.|genai|gen ai|ml|llm|machine learning|artificial intelligence)\b/.test(raw)
  ) {
    terms.push("ai");
  }

  return terms;
}

const SEARCH_FIELD_EXTRACTORS = {
  title: (job) => job?.title,
  summary: (job) => job?.summary,
  description: (job) => job?.description,
  company: (job) => job?.company,
  employmentType: (job) => job?.employmentType
};

const DEFAULT_SEARCH_FIELDS = ["title", "summary", "description"];

function normalizeSearchFields(fields) {
  if (!Array.isArray(fields) || fields.length === 0) {
    return DEFAULT_SEARCH_FIELDS;
  }

  const normalized = [];
  for (const field of fields) {
    if (typeof field !== "string") {
      continue;
    }
    const key = field.trim();
    if (!key || !(key in SEARCH_FIELD_EXTRACTORS) || normalized.includes(key)) {
      continue;
    }
    normalized.push(key);
  }

  return normalized.length ? normalized : DEFAULT_SEARCH_FIELDS;
}

function buildSearchableText(job, fields) {
  return normalizeText(
    fields
      .map((field) => SEARCH_FIELD_EXTRACTORS[field]?.(job))
      .filter((value) => typeof value === "string" && value.trim())
      .join(" ")
  ).toLowerCase();
}

function isAiLikeTerm(term) {
  return term === "ai" || term === "ml" || term === "llm" || term === "genai";
}

function termMatchesText(term, text) {
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

function normalizeHardFilterArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqueTerms(value);
}

function resolveSearchFieldsFromSource(source) {
  const hardFilterFields = source?.hardFilter?.fields;
  return normalizeSearchFields(hardFilterFields);
}

function isLikelyTitleTerm(term) {
  return /\b(manager|engineer|designer|analyst|scientist|developer|owner|director|head|lead|chief|vp)\b/.test(
    String(term || "")
  );
}

function splitTermsByTitleScope(terms) {
  const titleTerms = [];
  const contentTerms = [];

  for (const term of uniqueTerms(terms || [])) {
    if (isLikelyTitleTerm(term)) {
      titleTerms.push(term);
    } else {
      contentTerms.push(term);
    }
  }

  return { titleTerms, contentTerms };
}

function shouldEnforceContentTerms(job, source) {
  if (source?.hardFilter?.enforceContentOnSnippets === true) {
    return true;
  }

  const title = normalizeText(job?.title);
  const summary = normalizeText(job?.summary);
  const description = normalizeText(job?.description);
  const combined = normalizeText([title, summary, description].join(" "));
  const wordCount = combined ? combined.split(/\s+/).length : 0;

  return description.length >= 260 || summary.length >= 180 || wordCount >= 60;
}

export function resolveSourceRequiredTerms(source) {
  const explicitRequiredTerms = normalizeHardFilterArray(source?.requiredTerms);
  if (explicitRequiredTerms.length > 0) {
    return explicitRequiredTerms;
  }

  const hardFilterRequiredAll = normalizeHardFilterArray(source?.hardFilter?.requiredAll);
  if (hardFilterRequiredAll.length > 0) {
    return hardFilterRequiredAll;
  }

  const inferred = [];
  for (const intent of extractIntentStrings(source)) {
    inferred.push(...inferTermsFromIntent(intent));
  }

  return uniqueTerms(inferred);
}

export function jobMatchesRequiredTerms(job, terms, options = {}) {
  const requiredTerms = uniqueTerms(terms || []);
  if (requiredTerms.length === 0) {
    return true;
  }

  const fields = normalizeSearchFields(options.fields);
  const searchableText = buildSearchableText(job, fields);

  return requiredTerms.every((term) => termMatchesText(term, searchableText));
}

function jobMatchesAnyTerm(job, terms, options = {}) {
  const normalizedTerms = uniqueTerms(terms || []);
  if (normalizedTerms.length === 0) {
    return true;
  }

  const fields = normalizeSearchFields(options.fields);
  const searchableText = buildSearchableText(job, fields);
  return normalizedTerms.some((term) => termMatchesText(term, searchableText));
}

function jobMatchesNoExcludedTerms(job, terms, options = {}) {
  const normalizedTerms = uniqueTerms(terms || []);
  if (normalizedTerms.length === 0) {
    return true;
  }

  const fields = normalizeSearchFields(options.fields);
  const searchableText = buildSearchableText(job, fields);
  return normalizedTerms.every((term) => !termMatchesText(term, searchableText));
}

export function applySourceHardFilters(source, jobs) {
  const inputJobs = Array.isArray(jobs) ? jobs : [];
  const fields = resolveSearchFieldsFromSource(source);

  const requiredAll = resolveSourceRequiredTerms(source);
  const requiredAny = normalizeHardFilterArray(source?.hardFilter?.requiredAny);
  const excludeAny = normalizeHardFilterArray(source?.hardFilter?.excludeAny);
  const requiredAllSplit = splitTermsByTitleScope(requiredAll);
  const requiredAnySplit = splitTermsByTitleScope(requiredAny);

  const keptJobs = [];
  let droppedCount = 0;
  let deferredContentChecks = 0;

  for (const job of inputJobs) {
    const titleText = normalizeText(job?.title).toLowerCase();
    const searchText = buildSearchableText(job, fields);
    const enforceContentTerms = shouldEnforceContentTerms(job, source);

    const matchesTitleRequiredAll = requiredAllSplit.titleTerms.every((term) =>
      termMatchesText(term, titleText)
    );
    if (!matchesTitleRequiredAll) {
      droppedCount += 1;
      continue;
    }

    if (enforceContentTerms) {
      const matchesContentRequiredAll = requiredAllSplit.contentTerms.every((term) =>
        termMatchesText(term, searchText)
      );
      if (!matchesContentRequiredAll) {
        droppedCount += 1;
        continue;
      }
    } else if (requiredAllSplit.contentTerms.length > 0) {
      deferredContentChecks += 1;
    }

    const matchesTitleRequiredAny =
      requiredAnySplit.titleTerms.length === 0 ||
      requiredAnySplit.titleTerms.some((term) => termMatchesText(term, titleText));
    if (!matchesTitleRequiredAny) {
      droppedCount += 1;
      continue;
    }

    if (requiredAnySplit.contentTerms.length > 0 && enforceContentTerms) {
      const matchesContentRequiredAny = requiredAnySplit.contentTerms.some((term) =>
        termMatchesText(term, searchText)
      );
      if (!matchesContentRequiredAny) {
        droppedCount += 1;
        continue;
      }
    } else if (requiredAnySplit.contentTerms.length > 0 && !enforceContentTerms) {
      deferredContentChecks += 1;
    }

    const passesExclusion = excludeAny.every((term) => !termMatchesText(term, searchText));
    if (!passesExclusion) {
      droppedCount += 1;
      continue;
    }

    keptJobs.push(job);
  }

  return {
    jobs: keptJobs,
    droppedCount,
    requiredAll,
    requiredAny,
    excludeAny,
    fields,
    deferredContentChecks
  };
}
