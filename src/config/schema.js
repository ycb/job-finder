import { normalizeKeywordInput, parseKeywordTerms } from "../search/keywords.js";

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertOptionalObject(value, label, fallback = {}) {
  if (value === undefined || value === null) {
    return { ...fallback };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object when provided.`);
  }

  return value;
}

function assertString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value.trim();
}

function assertOptionalString(value, label, fallback = "") {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value !== "string") {
    throw new Error(`${label} must be a string when provided.`);
  }

  return value.trim();
}

function normalizeStringArray(value, label, fallback = []) {
  if (value === undefined) {
    return [...fallback];
  }

  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array of strings.`);
  }

  return value
    .map((item, index) => assertString(item, `${label}[${index}]`))
    .map((item) => item.toLowerCase());
}

function normalizeStringArrayPreserveCase(value, label, fallback = []) {
  if (value === undefined) {
    return [...fallback];
  }

  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array of strings.`);
  }

  return value.map((item, index) => assertString(item, `${label}[${index}]`));
}

function assertOptionalFiniteNumber(value, label, fallback = null) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number when provided.`);
  }

  return Number(value);
}

const SEARCH_CRITERIA_DATE_POSTED_VALUES = new Set(["any", "1d", "3d", "1w", "2w", "1m"]);
const SEARCH_CRITERIA_EXPERIENCE_VALUES = new Set([
  "intern",
  "entry",
  "associate",
  "mid",
  "senior",
  "director",
  "executive"
]);
const SEARCH_CRITERIA_KEYWORD_MODE_VALUES = new Set(["and", "or"]);
const SEARCH_CRITERIA_FIELD_NAMES = new Set([
  "title",
  "keywords",
  "keywordMode",
  "hardIncludeTerms",
  "hardIncludeMode",
  "hardExcludeTerms",
  "scoreKeywords",
  "scoreKeywordMode",
  "includeTerms",
  "excludeTerms",
  "location",
  "distanceMiles",
  "datePosted",
  "experienceLevel",
  "minSalary"
]);

function normalizeCriteriaTermList(value, label) {
  if (value === undefined || value === null) {
    return [];
  }

  let terms = [];
  if (typeof value === "string") {
    terms = parseKeywordTerms(value);
  } else if (Array.isArray(value)) {
    terms = value.map((item, index) => assertString(item, `${label}[${index}]`));
  } else {
    throw new Error(`${label} must be an array of strings or comma-separated string.`);
  }

  const deduped = [];
  for (const term of terms) {
    const normalized = term.toLowerCase();
    if (!deduped.includes(normalized)) {
      deduped.push(normalized);
    }
  }

  return deduped;
}

export function validateSearchCriteria(raw, label = "Search criteria") {
  const criteria = assertOptionalObject(raw, label, {});
  const normalizedCriteria = {};

  const title = assertOptionalString(criteria.title, `${label}.title`, "");
  if (title) {
    normalizedCriteria.title = title;
  }

  const keywords = assertOptionalString(criteria.keywords, `${label}.keywords`, "");
  if (keywords) {
    const normalizedKeywords = normalizeKeywordInput(keywords).canonical;
    if (normalizedKeywords) {
      normalizedCriteria.keywords = normalizedKeywords;
    }
  }

  const keywordMode = assertOptionalString(
    criteria.keywordMode,
    `${label}.keywordMode`,
    ""
  ).toLowerCase();
  if (keywordMode) {
    if (!SEARCH_CRITERIA_KEYWORD_MODE_VALUES.has(keywordMode)) {
      throw new Error(`${label}.keywordMode must be one of: and, or.`);
    }
    normalizedCriteria.keywordMode = keywordMode;
  }

  const hardIncludeMode = assertOptionalString(
    criteria.hardIncludeMode,
    `${label}.hardIncludeMode`,
    ""
  ).toLowerCase();
  if (hardIncludeMode) {
    if (!SEARCH_CRITERIA_KEYWORD_MODE_VALUES.has(hardIncludeMode)) {
      throw new Error(`${label}.hardIncludeMode must be one of: and, or.`);
    }
    normalizedCriteria.hardIncludeMode = hardIncludeMode;
  }

  const scoreKeywordMode = assertOptionalString(
    criteria.scoreKeywordMode,
    `${label}.scoreKeywordMode`,
    ""
  ).toLowerCase();
  if (scoreKeywordMode) {
    if (!SEARCH_CRITERIA_KEYWORD_MODE_VALUES.has(scoreKeywordMode)) {
      throw new Error(`${label}.scoreKeywordMode must be one of: and, or.`);
    }
    normalizedCriteria.scoreKeywordMode = scoreKeywordMode;
  }

  const hardIncludeTerms = normalizeCriteriaTermList(
    criteria.hardIncludeTerms,
    `${label}.hardIncludeTerms`
  );
  if (hardIncludeTerms.length > 0) {
    normalizedCriteria.hardIncludeTerms = hardIncludeTerms;
  }

  const hardExcludeTerms = normalizeCriteriaTermList(
    criteria.hardExcludeTerms,
    `${label}.hardExcludeTerms`
  );
  if (hardExcludeTerms.length > 0) {
    normalizedCriteria.hardExcludeTerms = hardExcludeTerms;
  }

  const scoreKeywords = normalizeCriteriaTermList(
    criteria.scoreKeywords,
    `${label}.scoreKeywords`
  );
  if (scoreKeywords.length > 0) {
    normalizedCriteria.scoreKeywords = scoreKeywords;
  }

  const includeTerms = normalizeCriteriaTermList(
    criteria.includeTerms,
    `${label}.includeTerms`
  );
  if (includeTerms.length > 0) {
    normalizedCriteria.includeTerms = includeTerms;
  }

  const excludeTerms = normalizeCriteriaTermList(
    criteria.excludeTerms,
    `${label}.excludeTerms`
  );
  if (excludeTerms.length > 0) {
    normalizedCriteria.excludeTerms = excludeTerms;
  }

  const location = assertOptionalString(criteria.location, `${label}.location`, "");
  if (location) {
    normalizedCriteria.location = location;
  }

  const minSalary = assertOptionalFiniteNumber(criteria.minSalary, `${label}.minSalary`, null);
  if (minSalary !== null) {
    if (minSalary <= 0) {
      throw new Error(`${label}.minSalary must be a positive number when provided.`);
    }
    normalizedCriteria.minSalary = Math.round(minSalary);
  }

  const distanceMiles = assertOptionalFiniteNumber(
    criteria.distanceMiles,
    `${label}.distanceMiles`,
    null
  );
  if (distanceMiles !== null) {
    if (distanceMiles <= 0) {
      throw new Error(`${label}.distanceMiles must be a positive number when provided.`);
    }
    normalizedCriteria.distanceMiles = Math.round(distanceMiles);
  }

  const datePosted = assertOptionalString(criteria.datePosted, `${label}.datePosted`, "").toLowerCase();
  if (datePosted) {
    if (!SEARCH_CRITERIA_DATE_POSTED_VALUES.has(datePosted)) {
      throw new Error(
        `${label}.datePosted must be one of: any, 1d, 3d, 1w, 2w, 1m.`
      );
    }
    normalizedCriteria.datePosted = datePosted;
  }

  const experienceLevel = assertOptionalString(
    criteria.experienceLevel,
    `${label}.experienceLevel`,
    ""
  ).toLowerCase();
  if (experienceLevel) {
    if (!SEARCH_CRITERIA_EXPERIENCE_VALUES.has(experienceLevel)) {
      throw new Error(
        `${label}.experienceLevel must be one of: intern, entry, associate, mid, senior, director, executive.`
      );
    }
    normalizedCriteria.experienceLevel = experienceLevel;
  }

  return normalizedCriteria;
}

function validateCriteriaAccountabilityBucket(rawBucket, label) {
  if (rawBucket === undefined) {
    return [];
  }

  if (!Array.isArray(rawBucket)) {
    throw new Error(`${label} must be an array when provided.`);
  }

  const deduped = [];
  for (let index = 0; index < rawBucket.length; index += 1) {
    const field = assertString(rawBucket[index], `${label}[${index}]`);
    if (!SEARCH_CRITERIA_FIELD_NAMES.has(field)) {
      throw new Error(
        `${label}[${index}] must be one of: ${Array.from(SEARCH_CRITERIA_FIELD_NAMES).join(", ")}.`
      );
    }
    if (!deduped.includes(field)) {
      deduped.push(field);
    }
  }

  return deduped;
}

function validateSourceCriteriaAccountability(raw, label) {
  const accountability = assertOptionalObject(raw, label, {});
  const normalized = {
    appliedInUrl: validateCriteriaAccountabilityBucket(
      accountability.appliedInUrl,
      `${label}.appliedInUrl`
    ),
    appliedInUiBootstrap: validateCriteriaAccountabilityBucket(
      accountability.appliedInUiBootstrap,
      `${label}.appliedInUiBootstrap`
    ),
    appliedPostCapture: validateCriteriaAccountabilityBucket(
      accountability.appliedPostCapture,
      `${label}.appliedPostCapture`
    ),
    unsupported: validateCriteriaAccountabilityBucket(
      accountability.unsupported,
      `${label}.unsupported`
    )
  };

  const seen = new Set();
  for (const field of [
    ...normalized.appliedInUrl,
    ...normalized.appliedInUiBootstrap,
    ...normalized.appliedPostCapture,
    ...normalized.unsupported
  ]) {
    if (seen.has(field)) {
      throw new Error(
        `${label} cannot assign field "${field}" to multiple buckets.`
      );
    }
    seen.add(field);
  }

  return normalized;
}

function validateFormatterDiagnostics(raw, label) {
  const diagnostics = assertOptionalObject(raw, label, {});
  const unsupported = validateCriteriaAccountabilityBucket(
    diagnostics.unsupported,
    `${label}.unsupported`
  );

  let notes = [];
  if (diagnostics.notes !== undefined) {
    if (!Array.isArray(diagnostics.notes)) {
      throw new Error(`${label}.notes must be an array when provided.`);
    }
    notes = diagnostics.notes.map((note, index) =>
      assertString(note, `${label}.notes[${index}]`)
    );
  }

  return {
    unsupported,
    notes
  };
}

export function validateProfile(raw) {
  assertObject(raw, "Profile");

  const remotePreference = raw.remotePreference ?? "remote_friendly";
  const allowedRemotePreferences = new Set([
    "remote_only",
    "remote_friendly",
    "onsite_ok"
  ]);

  if (!allowedRemotePreferences.has(remotePreference)) {
    throw new Error(
      "Profile.remotePreference must be one of remote_only, remote_friendly, onsite_ok."
    );
  }

  const salaryFloor = raw.salaryFloor ?? 0;
  if (!Number.isFinite(salaryFloor) || salaryFloor < 0) {
    throw new Error("Profile.salaryFloor must be a non-negative number.");
  }

  const workTypePreferences = normalizeStringArray(
    raw.workTypePreferences,
    "Profile.workTypePreferences"
  );
  const preferredBusinessModels = normalizeStringArray(
    raw.preferredBusinessModels,
    "Profile.preferredBusinessModels"
  );
  const preferredCompanyMaturity = normalizeStringArray(
    raw.preferredCompanyMaturity,
    "Profile.preferredCompanyMaturity"
  );

  const rawDealBreakers = assertOptionalObject(
    raw.dealBreakers,
    "Profile.dealBreakers",
    {}
  );
  const dealBreakers = {
    salaryMinimum: assertOptionalFiniteNumber(
      rawDealBreakers.salaryMinimum,
      "Profile.dealBreakers.salaryMinimum",
      null
    ),
    workType: normalizeStringArray(
      rawDealBreakers.workType,
      "Profile.dealBreakers.workType"
    ),
    companyMaturity: normalizeStringArray(
      rawDealBreakers.companyMaturity,
      "Profile.dealBreakers.companyMaturity"
    )
  };

  return {
    candidateName: assertString(raw.candidateName, "Profile.candidateName"),
    resumePath: assertString(raw.resumePath, "Profile.resumePath"),
    targetTitles: normalizeStringArray(raw.targetTitles, "Profile.targetTitles"),
    targetLocations: normalizeStringArray(
      raw.targetLocations,
      "Profile.targetLocations"
    ),
    remotePreference,
    salaryFloor,
    seniorityLevels: normalizeStringArray(
      raw.seniorityLevels,
      "Profile.seniorityLevels"
    ),
    preferredIndustries: normalizeStringArray(
      raw.preferredIndustries,
      "Profile.preferredIndustries"
    ),
    targetCompanies: normalizeStringArray(
      raw.targetCompanies,
      "Profile.targetCompanies"
    ),
    includeKeywords: normalizeStringArray(
      raw.includeKeywords,
      "Profile.includeKeywords"
    ),
    excludeKeywords: normalizeStringArray(
      raw.excludeKeywords,
      "Profile.excludeKeywords"
    ),
    workTypePreferences,
    preferredBusinessModels,
    preferredCompanyMaturity,
    dealBreakers
  };
}

export function validateGoals(raw) {
  assertObject(raw, "Goals");

  const rawDealBreakers = assertOptionalObject(raw.dealBreakers, "Goals.dealBreakers", {});

  return {
    candidateName: assertOptionalString(raw.candidateName, "Goals.candidateName", ""),
    resumePath: assertOptionalString(raw.resumePath, "Goals.resumePath", ""),
    targetTitles: normalizeStringArray(raw.targetTitles, "Goals.targetTitles"),
    minimumSalary: assertOptionalFiniteNumber(raw.minimumSalary, "Goals.minimumSalary", 0),
    companyMaturity: normalizeStringArray(raw.companyMaturity, "Goals.companyMaturity"),
    workType: normalizeStringArray(raw.workType, "Goals.workType"),
    industries: normalizeStringArray(raw.industries, "Goals.industries"),
    businessModels: normalizeStringArray(raw.businessModels, "Goals.businessModels"),
    preferredCities: normalizeStringArray(raw.preferredCities, "Goals.preferredCities"),
    openToRelocation:
      typeof raw.openToRelocation === "boolean" ? raw.openToRelocation : true,
    targetCompanies: normalizeStringArray(
      raw.targetCompanies,
      "Goals.targetCompanies"
    ),
    includeKeywords: normalizeStringArray(
      raw.includeKeywords,
      "Goals.includeKeywords"
    ),
    excludeKeywords: normalizeStringArray(
      raw.excludeKeywords,
      "Goals.excludeKeywords"
    ),
    seniorityLevels: normalizeStringArray(
      raw.seniorityLevels,
      "Goals.seniorityLevels"
    ),
    dealBreakers: {
      salaryMinimum: assertOptionalFiniteNumber(
        rawDealBreakers.salaryMinimum,
        "Goals.dealBreakers.salaryMinimum",
        null
      ),
      workType: normalizeStringArray(
        rawDealBreakers.workType,
        "Goals.dealBreakers.workType"
      ),
      companyMaturity: normalizeStringArray(
        rawDealBreakers.companyMaturity,
        "Goals.dealBreakers.companyMaturity"
      )
    }
  };
}

const PROFILE_PROVIDERS = new Set(["legacy_profile", "my_goals", "narrata"]);
const NARRATA_MODES = new Set(["file", "supabase"]);

export function validateProfileSource(raw) {
  assertObject(raw, "Profile source config");

  const provider = assertString(raw.provider, "Profile source config.provider");
  if (!PROFILE_PROVIDERS.has(provider)) {
    throw new Error(
      "Profile source config.provider must be one of legacy_profile, my_goals, narrata."
    );
  }

  const legacyProfilePath = assertOptionalString(
    raw.legacyProfilePath,
    "Profile source config.legacyProfilePath",
    "config/profile.json"
  );
  const goalsPath = assertOptionalString(
    raw.goalsPath,
    "Profile source config.goalsPath",
    "config/my-goals.json"
  );
  const narrataRaw = assertOptionalObject(raw.narrata, "Profile source config.narrata", {});
  const narrataMode = assertOptionalString(
    narrataRaw.mode,
    "Profile source config.narrata.mode",
    "file"
  );

  if (!NARRATA_MODES.has(narrataMode)) {
    throw new Error("Profile source config.narrata.mode must be one of file, supabase.");
  }

  return {
    provider,
    legacyProfilePath,
    goalsPath,
    narrata: {
      mode: narrataMode,
      goalsPath: assertOptionalString(
        narrataRaw.goalsPath,
        "Profile source config.narrata.goalsPath",
        goalsPath
      ),
      supabaseUrl: assertOptionalString(
        narrataRaw.supabaseUrl,
        "Profile source config.narrata.supabaseUrl",
        ""
      ),
      userId: assertOptionalString(
        narrataRaw.userId,
        "Profile source config.narrata.userId",
        ""
      ),
      serviceRoleEnv: assertOptionalString(
        narrataRaw.serviceRoleEnv,
        "Profile source config.narrata.serviceRoleEnv",
        "NARRATA_SUPABASE_SERVICE_ROLE_KEY"
      )
    }
  };
}

export function validateSources(raw) {
  assertObject(raw, "Sources");

  if (!Array.isArray(raw.sources) || raw.sources.length === 0) {
    throw new Error("Sources.sources must be a non-empty array.");
  }

  return {
    sources: raw.sources.map((source, index) => {
      assertObject(source, `Sources.sources[${index}]`);

      const type = assertString(source.type, `Sources.sources[${index}].type`);
      const allowedTypes = new Set([
        "mock_linkedin_saved_search",
        "linkedin_capture_file",
        "builtin_search",
        "google_search",
        "wellfound_search",
        "ashby_search",
        "indeed_search",
        "ziprecruiter_search",
        "yc_jobs",
        "levelsfyi_search",
        "remoteok_search"
      ]);
      if (!allowedTypes.has(type)) {
        throw new Error(
          `Sources.sources[${index}].type must be one of: ${[...allowedTypes].join(", ")}.`
        );
      }

      const normalizedSource = {
        id: assertString(source.id, `Sources.sources[${index}].id`),
        name: assertString(source.name, `Sources.sources[${index}].name`),
        type,
        enabled: source.enabled !== false,
        searchUrl: assertString(
          source.searchUrl,
          `Sources.sources[${index}].searchUrl`
        )
      };

      if (source.legacySourceIds !== undefined) {
        normalizedSource.legacySourceIds = normalizeStringArrayPreserveCase(
          source.legacySourceIds,
          `Sources.sources[${index}].legacySourceIds`
        );
      }

      if (source.searchCriteria !== undefined) {
        normalizedSource.searchCriteria = validateSearchCriteria(
          source.searchCriteria,
          `Sources.sources[${index}].searchCriteria`
        );
      }

      if (source.criteriaAccountability !== undefined) {
        normalizedSource.criteriaAccountability = validateSourceCriteriaAccountability(
          source.criteriaAccountability,
          `Sources.sources[${index}].criteriaAccountability`
        );
      }

      if (source.formatterDiagnostics !== undefined) {
        normalizedSource.formatterDiagnostics = validateFormatterDiagnostics(
          source.formatterDiagnostics,
          `Sources.sources[${index}].formatterDiagnostics`
        );
      }

      if (source.requiredTerms !== undefined) {
        if (!Array.isArray(source.requiredTerms)) {
          throw new Error(
            `Sources.sources[${index}].requiredTerms must be an array when provided.`
          );
        }

        normalizedSource.requiredTerms = source.requiredTerms.map((term, termIndex) =>
          assertString(
            term,
            `Sources.sources[${index}].requiredTerms[${termIndex}]`
          )
        );
      }

      if (source.hardFilter !== undefined) {
        const hardFilter = assertOptionalObject(
          source.hardFilter,
          `Sources.sources[${index}].hardFilter`,
          {}
        );
        const normalizedHardFilter = {};

        if (hardFilter.requiredAll !== undefined) {
          if (!Array.isArray(hardFilter.requiredAll)) {
            throw new Error(
              `Sources.sources[${index}].hardFilter.requiredAll must be an array when provided.`
            );
          }
          normalizedHardFilter.requiredAll = hardFilter.requiredAll.map((term, termIndex) =>
            assertString(
              term,
              `Sources.sources[${index}].hardFilter.requiredAll[${termIndex}]`
            )
          );
        }

        if (hardFilter.requiredAny !== undefined) {
          if (!Array.isArray(hardFilter.requiredAny)) {
            throw new Error(
              `Sources.sources[${index}].hardFilter.requiredAny must be an array when provided.`
            );
          }
          normalizedHardFilter.requiredAny = hardFilter.requiredAny.map((term, termIndex) =>
            assertString(
              term,
              `Sources.sources[${index}].hardFilter.requiredAny[${termIndex}]`
            )
          );
        }

        if (hardFilter.excludeAny !== undefined) {
          if (!Array.isArray(hardFilter.excludeAny)) {
            throw new Error(
              `Sources.sources[${index}].hardFilter.excludeAny must be an array when provided.`
            );
          }
          normalizedHardFilter.excludeAny = hardFilter.excludeAny.map((term, termIndex) =>
            assertString(
              term,
              `Sources.sources[${index}].hardFilter.excludeAny[${termIndex}]`
            )
          );
        }

        if (hardFilter.fields !== undefined) {
          if (!Array.isArray(hardFilter.fields)) {
            throw new Error(
              `Sources.sources[${index}].hardFilter.fields must be an array when provided.`
            );
          }
          normalizedHardFilter.fields = hardFilter.fields.map((field, fieldIndex) =>
            assertString(
              field,
              `Sources.sources[${index}].hardFilter.fields[${fieldIndex}]`
            )
          );
        }

        if (hardFilter.enforceContentOnSnippets !== undefined) {
          if (typeof hardFilter.enforceContentOnSnippets !== "boolean") {
            throw new Error(
              `Sources.sources[${index}].hardFilter.enforceContentOnSnippets must be a boolean when provided.`
            );
          }
          normalizedHardFilter.enforceContentOnSnippets =
            hardFilter.enforceContentOnSnippets;
        }

        if (Object.keys(normalizedHardFilter).length > 0) {
          normalizedSource.hardFilter = normalizedHardFilter;
        }
      }

      if (source.cacheTtlHours !== undefined) {
        const parsed = Number(source.cacheTtlHours);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new Error(
            `Sources.sources[${index}].cacheTtlHours must be a positive number when provided.`
          );
        }
        normalizedSource.cacheTtlHours = parsed;
      }

      if (type === "mock_linkedin_saved_search") {
        normalizedSource.mockResultsPath = assertString(
          source.mockResultsPath,
          `Sources.sources[${index}].mockResultsPath`
        );
      }

      if (type === "linkedin_capture_file") {
        normalizedSource.capturePath = assertString(
          source.capturePath,
          `Sources.sources[${index}].capturePath`
        );
      }

      if (
        (type === "builtin_search" ||
          type === "google_search" ||
          type === "wellfound_search" ||
          type === "ashby_search" ||
          type === "indeed_search" ||
          type === "ziprecruiter_search" ||
          type === "yc_jobs" ||
          type === "levelsfyi_search" ||
          type === "remoteok_search") &&
        source.capturePath !== undefined
      ) {
        normalizedSource.capturePath = assertString(
          source.capturePath,
          `Sources.sources[${index}].capturePath`
        );
      }

      if (
        type === "builtin_search" ||
        type === "google_search" ||
        type === "wellfound_search" ||
        type === "ashby_search" ||
        type === "indeed_search" ||
        type === "ziprecruiter_search" ||
        type === "yc_jobs" ||
        type === "levelsfyi_search" ||
        type === "remoteok_search"
      ) {
        if (source.maxJobs !== undefined) {
          if (!Number.isInteger(source.maxJobs) || source.maxJobs <= 0) {
            throw new Error(
              `Sources.sources[${index}].maxJobs must be a positive integer when provided.`
            );
          }

          normalizedSource.maxJobs = source.maxJobs;
        }

        if (source.requestTimeoutMs !== undefined) {
          if (
            !Number.isFinite(source.requestTimeoutMs) ||
            source.requestTimeoutMs < 1_000
          ) {
            throw new Error(
              `Sources.sources[${index}].requestTimeoutMs must be at least 1000 when provided.`
            );
          }

          normalizedSource.requestTimeoutMs = Math.round(source.requestTimeoutMs);
        }

      }

      if (
        type === "linkedin_capture_file" ||
        type === "builtin_search" ||
        type === "google_search" ||
        type === "wellfound_search" ||
        type === "ashby_search" ||
        type === "indeed_search" ||
        type === "ziprecruiter_search" ||
        type === "yc_jobs" ||
        type === "levelsfyi_search" ||
        type === "remoteok_search"
      ) {
        if (source.maxPages !== undefined) {
          if (!Number.isInteger(source.maxPages) || source.maxPages <= 0) {
            throw new Error(
              `Sources.sources[${index}].maxPages must be a positive integer when provided.`
            );
          }

          normalizedSource.maxPages = source.maxPages;
        }
      }

      if (
        type === "linkedin_capture_file" ||
        type === "google_search" ||
        type === "wellfound_search" ||
        type === "ashby_search" ||
        type === "indeed_search" ||
        type === "ziprecruiter_search" ||
        type === "remoteok_search"
      ) {
        if (source.maxScrollSteps !== undefined) {
          if (!Number.isInteger(source.maxScrollSteps) || source.maxScrollSteps <= 0) {
            throw new Error(
              `Sources.sources[${index}].maxScrollSteps must be a positive integer when provided.`
            );
          }

          normalizedSource.maxScrollSteps = source.maxScrollSteps;
        }

        if (source.maxIdleScrollSteps !== undefined) {
          if (
            !Number.isInteger(source.maxIdleScrollSteps) ||
            source.maxIdleScrollSteps <= 0
          ) {
            throw new Error(
              `Sources.sources[${index}].maxIdleScrollSteps must be a positive integer when provided.`
            );
          }

          normalizedSource.maxIdleScrollSteps = source.maxIdleScrollSteps;
        }
      }

      if (type === "ashby_search" && source.maxBoards !== undefined) {
        if (!Number.isInteger(source.maxBoards) || source.maxBoards <= 0) {
          throw new Error(
            `Sources.sources[${index}].maxBoards must be a positive integer when provided.`
          );
        }

        normalizedSource.maxBoards = source.maxBoards;
      }

      if (type === "ashby_search" || type === "google_search") {
        const recencyRaw =
          source.recencyWindow === undefined || source.recencyWindow === null
            ? ""
            : assertString(
                source.recencyWindow,
                `Sources.sources[${index}].recencyWindow`
              ).toLowerCase();

        if (recencyRaw && !new Set(["any", "1d", "1w", "1m"]).has(recencyRaw)) {
          throw new Error(
            `Sources.sources[${index}].recencyWindow must be one of: any, 1d, 1w, 1m.`
          );
        }

        normalizedSource.recencyWindow = recencyRaw || (type === "google_search" ? "1w" : "1m");
      }

      return normalizedSource;
    })
  };
}
