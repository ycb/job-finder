import {
  keywordTermsToQueryText,
  normalizeKeywordInput,
  parseKeywordTerms
} from "../search/keywords.js";
import { buildLevelsFyiSearchUrl } from "./levelsfyi-jobs.js";

const SUPPORTED_DATE_POSTED = new Set(["any", "1d", "3d", "1w", "2w", "1m"]);
const SUPPORTED_EXPERIENCE_LEVELS = new Set([
  "intern",
  "entry",
  "associate",
  "mid",
  "senior",
  "director",
  "executive"
]);

const LINKEDIN_EXPERIENCE_TO_F_E = new Map([
  ["intern", "1"],
  ["entry", "2"],
  ["associate", "3"],
  ["mid", "4"],
  ["senior", "4"],
  ["director", "5"],
  ["executive", "6"]
]);

const LINKEDIN_SALARY_BUCKETS = [
  { min: 40000, code: "1" },
  { min: 60000, code: "2" },
  { min: 80000, code: "3" },
  { min: 100000, code: "4" },
  { min: 120000, code: "5" },
  { min: 140000, code: "6" },
  { min: 160000, code: "7" },
  { min: 180000, code: "8" },
  { min: 200000, code: "9" }
];

const DATE_POSTED_TO_DAYS = new Map([
  ["1d", 1],
  ["3d", 3],
  ["1w", 7],
  ["2w", 14],
  ["1m", 30]
]);

const DATE_POSTED_TO_QDR = new Map([
  ["1d", "d"],
  ["3d", "w"],
  ["1w", "w"],
  ["2w", "m"],
  ["1m", "m"]
]);

function normalizeText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function normalizePositiveInt(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.round(parsed);
}

function dedupe(values) {
  return Array.from(new Set(values));
}

const CRITERIA_FIELDS = [
  "title",
  "keywords",
  "keywordMode",
  "hardIncludeTerms",
  "includeTerms",
  "excludeTerms",
  "location",
  "distanceMiles",
  "datePosted",
  "experienceLevel",
  "minSalary"
];

function normalizeCriteriaTermList(rawValue) {
  if (rawValue === undefined || rawValue === null) {
    return [];
  }

  const rawTerms = Array.isArray(rawValue)
    ? rawValue.map((item) => normalizeText(item).toLowerCase())
    : parseKeywordTerms(rawValue).map((item) => normalizeText(item).toLowerCase());

  return dedupe(rawTerms.filter(Boolean));
}

function normalizeKeywordMode(rawMode) {
  const normalized = normalizeText(rawMode).toLowerCase();
  return normalized === "or" ? "or" : "and";
}

function formatQueryTerm(term) {
  const normalized = normalizeText(term);
  if (!normalized) {
    return "";
  }

  return /\s/.test(normalized) ? `"${normalized}"` : normalized;
}

function emptyCriteriaAccountability() {
  return {
    appliedInUrl: [],
    appliedInUiBootstrap: [],
    appliedPostCapture: [],
    unsupported: []
  };
}

function createCriteriaAccountabilityTracker(criteria) {
  const providedFields = CRITERIA_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(criteria, field)
  );
  const providedFieldSet = new Set(providedFields);
  const bucketByField = new Map();

  function mark(field, bucket) {
    if (!providedFieldSet.has(field)) {
      return;
    }

    bucketByField.set(field, bucket);
  }

  function finalize() {
    const accountability = emptyCriteriaAccountability();

    for (const field of providedFields) {
      const bucket = bucketByField.get(field) || "unsupported";
      accountability[bucket].push(field);
    }

    accountability.appliedInUrl = dedupe(accountability.appliedInUrl);
    accountability.appliedInUiBootstrap = dedupe(
      accountability.appliedInUiBootstrap
    );
    accountability.appliedPostCapture = dedupe(
      accountability.appliedPostCapture
    );
    accountability.unsupported = dedupe(accountability.unsupported);

    return accountability;
  }

  return {
    markAppliedInUrl(field) {
      mark(field, "appliedInUrl");
    },
    markAppliedInUiBootstrap(field) {
      mark(field, "appliedInUiBootstrap");
    },
    markAppliedPostCapture(field) {
      mark(field, "appliedPostCapture");
    },
    markUnsupported(field) {
      mark(field, "unsupported");
    },
    finalize
  };
}

function parseLocationParts(rawLocation) {
  const normalized = normalizeText(rawLocation);
  if (!normalized) {
    return {
      city: "",
      state: "",
      country: ""
    };
  }

  const parts = normalized
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 1) {
    return {
      city: parts[0],
      state: "",
      country: ""
    };
  }

  if (parts.length === 2) {
    return {
      city: parts[0],
      state: parts[1],
      country: ""
    };
  }

  return {
    city: parts[0],
    state: parts[1],
    country: parts.slice(2).join(", ")
  };
}

function formatUsdAmount(value) {
  const amount = normalizePositiveInt(value);
  if (!amount) {
    return "";
  }

  return `$${amount.toLocaleString("en-US")}`;
}

function formatIndeedSalaryType(value) {
  const formatted = formatUsdAmount(value);
  return formatted ? `${formatted}+` : "";
}

function resolvePreferredLocation(criteriaLocation, existingLocation = "") {
  const requested = normalizeText(criteriaLocation);
  const existing = normalizeText(existingLocation);

  if (!requested) {
    return existing;
  }

  if (!existing || requested.includes(",")) {
    return requested;
  }

  const requestedLower = requested.toLowerCase();
  const existingLower = existing.toLowerCase();
  if (existingLower === requestedLower || existingLower.startsWith(`${requestedLower},`)) {
    return existing;
  }

  return requested;
}

function slugifyKeywords(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "+")
    .replace(/^\++|\++$/g, "");
}

function defaultUrlForSourceType(sourceType) {
  if (sourceType === "linkedin_capture_file") {
    return "https://www.linkedin.com/jobs/search/";
  }

  if (sourceType === "builtin_search") {
    return "https://www.builtinsf.com/jobs";
  }

  if (sourceType === "google_search" || sourceType === "ashby_search") {
    return "https://www.google.com/search";
  }

  if (sourceType === "wellfound_search") {
    return "https://wellfound.com/jobs";
  }

  if (sourceType === "indeed_search") {
    return "https://www.indeed.com/jobs";
  }

  if (sourceType === "ziprecruiter_search") {
    return "https://www.ziprecruiter.com/jobs-search";
  }

  if (sourceType === "levelsfyi_search") {
    return "https://www.levels.fyi/jobs";
  }

  if (sourceType === "yc_jobs") {
    return "https://www.workatastartup.com/jobs/l/product-manager";
  }

  if (sourceType === "remoteok_search") {
    return "https://remoteok.com/remote-jobs";
  }

  return "";
}

function toUrl(baseUrl, sourceType) {
  const fallback = defaultUrlForSourceType(sourceType);

  const candidate = normalizeText(baseUrl) || fallback;
  if (!candidate) {
    return null;
  }

  try {
    return new URL(candidate);
  } catch {
    try {
      return new URL(fallback);
    } catch {
      return null;
    }
  }
}

function applyGoogleTimeWindow(searchParams, datePosted, recencyWindow) {
  const desiredDate = normalizeText(datePosted).toLowerCase();
  const desiredRecency = normalizeText(recencyWindow).toLowerCase();

  if (desiredDate === "any" || desiredRecency === "any") {
    searchParams.delete("tbs");
    return;
  }

  const qdr = DATE_POSTED_TO_QDR.get(desiredDate);
  if (qdr) {
    searchParams.set("tbs", `qdr:${qdr}`);
    return;
  }

  if (desiredRecency === "1d") {
    searchParams.set("tbs", "qdr:d");
    return;
  }

  if (desiredRecency === "1w") {
    searchParams.set("tbs", "qdr:w");
    return;
  }

  if (desiredRecency === "1m") {
    searchParams.set("tbs", "qdr:m");
    return;
  }

  searchParams.delete("tbs");
}

function normalizeSearchCriteria(rawCriteria) {
  if (!rawCriteria || typeof rawCriteria !== "object" || Array.isArray(rawCriteria)) {
    return {};
  }

  const normalized = {};

  const title = normalizeText(rawCriteria.title);
  if (title) {
    normalized.title = title;
  }

  const keywordMetadata = normalizeKeywordInput(rawCriteria.keywords);
  if (keywordMetadata.canonical) {
    normalized.keywords = keywordMetadata.canonical;
    normalized.keywordTerms = keywordMetadata.terms;
  }

  const keywordMode = normalizeText(rawCriteria.keywordMode).toLowerCase();
  if (keywordMode === "and" || keywordMode === "or") {
    normalized.keywordMode = keywordMode;
  }

  const includeTerms = normalizeCriteriaTermList(rawCriteria.includeTerms);
  if (includeTerms.length > 0) {
    normalized.includeTerms = includeTerms;
  }

  const hardIncludeTerms = normalizeCriteriaTermList(rawCriteria.hardIncludeTerms);
  if (hardIncludeTerms.length > 0) {
    normalized.hardIncludeTerms = hardIncludeTerms;
  }

  const excludeTerms = normalizeCriteriaTermList(rawCriteria.excludeTerms);
  if (excludeTerms.length > 0) {
    normalized.excludeTerms = excludeTerms;
  }

  const location = normalizeText(rawCriteria.location);
  if (location) {
    normalized.location = location;
  }

  const minSalary = normalizePositiveInt(rawCriteria.minSalary);
  if (minSalary) {
    normalized.minSalary = minSalary;
  }

  const distanceMiles = normalizePositiveInt(rawCriteria.distanceMiles);
  if (distanceMiles) {
    normalized.distanceMiles = distanceMiles;
  }

  const datePosted = normalizeText(rawCriteria.datePosted).toLowerCase();
  if (SUPPORTED_DATE_POSTED.has(datePosted)) {
    normalized.datePosted = datePosted;
  }

  const experienceLevel = normalizeText(rawCriteria.experienceLevel).toLowerCase();
  if (SUPPORTED_EXPERIENCE_LEVELS.has(experienceLevel)) {
    normalized.experienceLevel = experienceLevel;
  }

  return normalized;
}

function combineTitleAndKeywords(criteria) {
  const title = normalizeText(criteria?.title);
  const keywordMode = normalizeKeywordMode(criteria?.keywordMode);
  const keywordTerms = Array.isArray(criteria?.keywordTerms)
    ? criteria.keywordTerms.map((term) => normalizeText(term).toLowerCase()).filter(Boolean)
    : normalizeCriteriaTermList(criteria?.keywords);
  const hardIncludeTerms = normalizeCriteriaTermList(criteria?.hardIncludeTerms);
  const includeTerms = normalizeCriteriaTermList(criteria?.includeTerms);
  const positiveTerms = dedupe([
    ...keywordTerms,
    ...hardIncludeTerms,
    ...includeTerms
  ]).filter(Boolean);

  let positiveQuery = "";
  if (positiveTerms.length > 0) {
    if (keywordMode === "or" && positiveTerms.length > 1) {
      positiveQuery = `(${positiveTerms.map(formatQueryTerm).join(" OR ")})`;
    } else {
      positiveQuery = keywordTermsToQueryText(positiveTerms);
    }
  }

  return [title, positiveQuery].filter(Boolean).join(" ").trim();
}

function buildYcRoleRoute(criteria) {
  const title = normalizeText(criteria?.title).toLowerCase();
  if (!title) {
    return "/jobs";
  }

  if (/\b(product manager|head of product|director of product|vp product)\b/.test(title)) {
    return "/jobs/l/product-manager";
  }

  return "/jobs";
}

function toLinkedInSalaryBucket(minSalary) {
  const normalized = normalizePositiveInt(minSalary);
  if (!normalized) {
    return null;
  }

  for (const bucket of LINKEDIN_SALARY_BUCKETS) {
    if (normalized <= bucket.min) {
      return bucket.code;
    }
  }

  return LINKEDIN_SALARY_BUCKETS[LINKEDIN_SALARY_BUCKETS.length - 1].code;
}

export function toGoogleRecencyWindowFromDatePosted(datePosted) {
  const normalized = normalizeText(datePosted).toLowerCase();

  if (!normalized) {
    return null;
  }

  if (normalized === "any") {
    return "any";
  }

  if (normalized === "1d") {
    return "1d";
  }

  if (normalized === "3d" || normalized === "1w") {
    return "1w";
  }

  if (normalized === "2w" || normalized === "1m") {
    return "1m";
  }

  return null;
}

export function buildSearchUrlForSourceType(sourceType, rawCriteria, options = {}) {
  const criteria = normalizeSearchCriteria(rawCriteria);
  const notes = [];
  const criteriaAccountability = createCriteriaAccountabilityTracker(criteria);
  if (criteria.excludeTerms) {
    criteriaAccountability.markAppliedPostCapture("excludeTerms");
  }
  const parsed = toUrl(options.baseUrl, sourceType);

  if (!parsed) {
    const finalized = criteriaAccountability.finalize();
    return {
      url: "",
      unsupported: finalized.unsupported,
      notes: ["No valid base URL available for source type."],
      criteriaAccountability: finalized
    };
  }

  if (sourceType === "linkedin_capture_file") {
    const nextParams = new URLSearchParams();
    if (criteria.keywordMode) criteriaAccountability.markAppliedInUrl("keywordMode");
    for (const [key, value] of parsed.searchParams.entries()) {
      if (
        key === "keywords" ||
        key === "geoId" ||
        key === "distance" ||
        key === "location" ||
        key === "origin" ||
        key === "refresh" ||
        key === "sortBy" ||
        key === "start" ||
        key.startsWith("f_")
      ) {
        nextParams.append(key, value);
      }
    }

    const titleKeywords = combineTitleAndKeywords(criteria);
    if (titleKeywords) {
      nextParams.set("keywords", titleKeywords);
      if (criteria.title) criteriaAccountability.markAppliedInUrl("title");
      if (criteria.keywords) criteriaAccountability.markAppliedInUrl("keywords");
      if (criteria.hardIncludeTerms) criteriaAccountability.markAppliedInUrl("hardIncludeTerms");
      if (criteria.includeTerms) criteriaAccountability.markAppliedInUrl("includeTerms");
      if (criteria.keywordMode) criteriaAccountability.markAppliedInUrl("keywordMode");
    }

    if (criteria.location) {
      nextParams.delete("geoId");
      nextParams.set(
        "location",
        resolvePreferredLocation(criteria.location, parsed.searchParams.get("location"))
      );
      criteriaAccountability.markAppliedInUrl("location");
    }

    if (criteria.distanceMiles) {
      nextParams.set("distance", String(criteria.distanceMiles));
      criteriaAccountability.markAppliedInUrl("distanceMiles");
    }

    if (criteria.datePosted) {
      if (criteria.datePosted === "any") {
        criteriaAccountability.markAppliedInUrl("datePosted");
      } else {
        const days = DATE_POSTED_TO_DAYS.get(criteria.datePosted);
        if (days) {
          nextParams.set("f_TPR", `r${days * 24 * 60 * 60}`);
          criteriaAccountability.markAppliedInUrl("datePosted");
        } else {
          criteriaAccountability.markUnsupported("datePosted");
        }
      }
    }

    if (criteria.experienceLevel) {
      const mapped = LINKEDIN_EXPERIENCE_TO_F_E.get(criteria.experienceLevel);
      if (mapped) {
        nextParams.set("f_E", mapped);
        criteriaAccountability.markAppliedInUrl("experienceLevel");
      } else {
        criteriaAccountability.markUnsupported("experienceLevel");
      }
    }

    if (criteria.minSalary) {
      const bucket = toLinkedInSalaryBucket(criteria.minSalary);
      if (bucket) {
        nextParams.set("f_SB2", bucket);
        criteriaAccountability.markAppliedInUrl("minSalary");
      } else {
        criteriaAccountability.markUnsupported("minSalary");
      }
    }

    parsed.search = nextParams.toString();
    parsed.hash = "";
    const finalized = criteriaAccountability.finalize();

    return {
      url: parsed.toString(),
      unsupported: finalized.unsupported,
      notes,
      criteriaAccountability: finalized
    };
  }

  if (sourceType === "builtin_search") {
    const nextParams = new URLSearchParams();
    if (criteria.keywordMode) criteriaAccountability.markAppliedInUrl("keywordMode");
    for (const [key, value] of parsed.searchParams.entries()) {
      if (
        key === "search" ||
        key === "daysSinceUpdated" ||
        key === "city" ||
        key === "state" ||
        key === "country" ||
        key === "allLocations"
      ) {
        nextParams.append(key, value);
      }
    }

    const titleKeywords = combineTitleAndKeywords(criteria);
    if (titleKeywords) {
      nextParams.set("search", titleKeywords);
      if (criteria.title) criteriaAccountability.markAppliedInUrl("title");
      if (criteria.keywords) criteriaAccountability.markAppliedInUrl("keywords");
      if (criteria.hardIncludeTerms) criteriaAccountability.markAppliedInUrl("hardIncludeTerms");
      if (criteria.includeTerms) criteriaAccountability.markAppliedInUrl("includeTerms");
      if (criteria.keywordMode) criteriaAccountability.markAppliedInUrl("keywordMode");
    }

    if (criteria.location) {
      const parts = parseLocationParts(criteria.location);
      if (parts.city) nextParams.set("city", parts.city);
      if (parts.state) nextParams.set("state", parts.state);
      if (parts.country) nextParams.set("country", parts.country);
      criteriaAccountability.markAppliedInUrl("location");
    }

    if (criteria.datePosted) {
      if (criteria.datePosted === "any") {
        criteriaAccountability.markAppliedInUrl("datePosted");
      } else {
        const days = DATE_POSTED_TO_DAYS.get(criteria.datePosted);
        if (days) {
          nextParams.set("daysSinceUpdated", String(days));
          criteriaAccountability.markAppliedInUrl("datePosted");
        } else {
          criteriaAccountability.markUnsupported("datePosted");
        }
      }
    }

    if (criteria.distanceMiles) {
      criteriaAccountability.markUnsupported("distanceMiles");
    }

    if (criteria.minSalary) {
      criteriaAccountability.markUnsupported("minSalary");
    }

    if (criteria.experienceLevel) {
      criteriaAccountability.markUnsupported("experienceLevel");
    }

    parsed.search = nextParams.toString();
    parsed.hash = "";
    const finalized = criteriaAccountability.finalize();

    return {
      url: parsed.toString(),
      unsupported: finalized.unsupported,
      notes,
      criteriaAccountability: finalized
    };
  }

  if (sourceType === "wellfound_search") {
    if (criteria.title) criteriaAccountability.markUnsupported("title");
    if (criteria.keywords) criteriaAccountability.markUnsupported("keywords");
    if (criteria.keywordMode) criteriaAccountability.markUnsupported("keywordMode");
    if (criteria.includeTerms) criteriaAccountability.markUnsupported("includeTerms");
    if (criteria.location) criteriaAccountability.markUnsupported("location");
    if (criteria.minSalary) criteriaAccountability.markUnsupported("minSalary");
    if (criteria.distanceMiles) criteriaAccountability.markUnsupported("distanceMiles");
    if (criteria.datePosted) criteriaAccountability.markUnsupported("datePosted");
    if (criteria.experienceLevel) {
      criteriaAccountability.markUnsupported("experienceLevel");
    }

    notes.push("Wellfound currently requires UI bootstrap; URL-only criteria are stubbed.");

    parsed.search = "";
    parsed.hash = "";
    const finalized = criteriaAccountability.finalize();

    return {
      url: parsed.toString(),
      unsupported: finalized.unsupported,
      notes,
      criteriaAccountability: finalized
    };
  }

  if (sourceType === "ashby_search" || sourceType === "google_search") {
    const nextParams = new URLSearchParams();
    const queryTerms = [];
    if (criteria.keywordMode) criteriaAccountability.markAppliedInUrl("keywordMode");

    if (sourceType === "ashby_search") {
      queryTerms.push("site:ashbyhq.com");
    }

    const titleKeywords = combineTitleAndKeywords(criteria);
    if (titleKeywords) {
      queryTerms.push(titleKeywords);
      if (criteria.title) criteriaAccountability.markAppliedInUrl("title");
      if (criteria.keywords) criteriaAccountability.markAppliedInUrl("keywords");
      if (criteria.includeTerms) criteriaAccountability.markAppliedInUrl("includeTerms");
      if (criteria.keywordMode) criteriaAccountability.markAppliedInUrl("keywordMode");
    }

    if (criteria.location) {
      queryTerms.push(`"${criteria.location}"`);
      criteriaAccountability.markAppliedInUrl("location");
    }

    if (criteria.minSalary && sourceType !== "ashby_search") {
      queryTerms.push(`${formatUsdAmount(criteria.minSalary)}+`);
      criteriaAccountability.markAppliedInUrl("minSalary");
    } else if (criteria.minSalary && sourceType === "ashby_search") {
      criteriaAccountability.markUnsupported("minSalary");
    }

    if (criteria.experienceLevel) {
      queryTerms.push(criteria.experienceLevel);
      criteriaAccountability.markAppliedInUrl("experienceLevel");
    }

    if (queryTerms.length === 0) {
      const existingQuery = normalizeText(parsed.searchParams.get("q"));
      if (existingQuery) {
        queryTerms.push(existingQuery);
      }
    }

    if (queryTerms.length > 0) {
      nextParams.set("q", queryTerms.join(" ").trim());
    }

    if (sourceType === "google_search") {
      nextParams.set("udm", "8");
    }

    applyGoogleTimeWindow(
      nextParams,
      criteria.datePosted,
      sourceType === "google_search" || sourceType === "ashby_search"
        ? options.recencyWindow
        : ""
    );
    if (criteria.datePosted) {
      criteriaAccountability.markAppliedInUrl("datePosted");
    }

    if (criteria.distanceMiles) {
      criteriaAccountability.markUnsupported("distanceMiles");
    }

    parsed.search = nextParams.toString();
    parsed.hash = "";
    const finalized = criteriaAccountability.finalize();

    return {
      url: parsed.toString(),
      unsupported: finalized.unsupported,
      notes,
      criteriaAccountability: finalized
    };
  }

  if (sourceType === "indeed_search") {
    const nextParams = new URLSearchParams();
    if (criteria.keywordMode) criteriaAccountability.markAppliedInUrl("keywordMode");
    const titleKeywords = combineTitleAndKeywords(criteria);

    if (titleKeywords) {
      nextParams.set("q", titleKeywords);
      if (criteria.title) criteriaAccountability.markAppliedInUrl("title");
      if (criteria.keywords) criteriaAccountability.markAppliedInUrl("keywords");
      if (criteria.hardIncludeTerms) {
        criteriaAccountability.markAppliedInUrl("hardIncludeTerms");
      }
      if (criteria.includeTerms) criteriaAccountability.markAppliedInUrl("includeTerms");
      if (criteria.keywordMode) criteriaAccountability.markAppliedInUrl("keywordMode");
    } else {
      const existingQuery = normalizeText(parsed.searchParams.get("q"));
      if (existingQuery) {
        nextParams.set("q", existingQuery);
      }
    }

    if (criteria.location) {
      nextParams.set(
        "l",
        resolvePreferredLocation(
          criteria.location,
          normalizeText(parsed.searchParams.get("l")) ||
            normalizeText(parsed.searchParams.get("locString"))
        )
      );
      criteriaAccountability.markAppliedInUrl("location");
    } else {
      const existingLocation =
        normalizeText(parsed.searchParams.get("l")) ||
        normalizeText(parsed.searchParams.get("locString"));
      if (existingLocation) {
        nextParams.set("l", existingLocation);
      }
    }

    if (criteria.distanceMiles) {
      nextParams.set("radius", String(Math.max(0, criteria.distanceMiles)));
      criteriaAccountability.markAppliedInUrl("distanceMiles");
    } else if (criteria.location) {
      nextParams.set("radius", "0");
    } else {
      const existingRadius = normalizePositiveInt(parsed.searchParams.get("radius"));
      if (existingRadius !== null) {
        nextParams.set("radius", String(existingRadius));
      }
    }

    if (criteria.minSalary) {
      const salaryType = formatIndeedSalaryType(criteria.minSalary);
      if (salaryType) {
        nextParams.set("salaryType", salaryType);
        criteriaAccountability.markAppliedInUrl("minSalary");
      }
    } else {
      const existingSalaryType = normalizeText(parsed.searchParams.get("salaryType"));
      if (existingSalaryType) {
        nextParams.set("salaryType", existingSalaryType);
      }
    }

    if (criteria.datePosted) {
      const fromageDays = DATE_POSTED_TO_DAYS.get(criteria.datePosted);
      if (fromageDays) {
        nextParams.set("fromage", String(fromageDays));
        criteriaAccountability.markAppliedInUrl("datePosted");
      } else {
        criteriaAccountability.markUnsupported("datePosted");
      }
    } else {
      const existingFromage = normalizePositiveInt(parsed.searchParams.get("fromage"));
      if (existingFromage) {
        nextParams.set("fromage", String(existingFromage));
      }
    }

    if (criteria.experienceLevel) {
      criteriaAccountability.markUnsupported("experienceLevel");
    }

    parsed.search = nextParams.toString();
    parsed.hash = "";
    const finalized = criteriaAccountability.finalize();

    return {
      url: parsed.toString(),
      unsupported: finalized.unsupported,
      notes,
      criteriaAccountability: finalized
    };
  }

  if (sourceType === "ziprecruiter_search") {
    const nextParams = new URLSearchParams();
    const titleKeywords = combineTitleAndKeywords(criteria);

    if (titleKeywords) {
      nextParams.set("search", titleKeywords);
      if (criteria.title) criteriaAccountability.markAppliedInUrl("title");
      if (criteria.keywords) criteriaAccountability.markAppliedInUrl("keywords");
      if (criteria.hardIncludeTerms) {
        criteriaAccountability.markAppliedInUrl("hardIncludeTerms");
      }
      if (criteria.includeTerms) criteriaAccountability.markAppliedInUrl("includeTerms");
      if (criteria.keywordMode) criteriaAccountability.markAppliedInUrl("keywordMode");
    } else {
      const existingQuery = normalizeText(parsed.searchParams.get("search"));
      if (existingQuery) {
        nextParams.set("search", existingQuery);
      }
    }

    if (criteria.location) {
      nextParams.set(
        "location",
        resolvePreferredLocation(criteria.location, parsed.searchParams.get("location"))
      );
      criteriaAccountability.markAppliedInUrl("location");
    } else {
      const existingLocation = normalizeText(parsed.searchParams.get("location"));
      if (existingLocation) {
        nextParams.set("location", existingLocation);
      }
    }

    if (criteria.distanceMiles) {
      criteriaAccountability.markAppliedPostCapture("distanceMiles");
    } else {
      const existingRadius = normalizePositiveInt(parsed.searchParams.get("radius"));
      if (existingRadius) {
        nextParams.set("radius", String(existingRadius));
      }
    }

    if (criteria.datePosted) {
      criteriaAccountability.markAppliedPostCapture("datePosted");
    } else {
      const existingDays = normalizePositiveInt(parsed.searchParams.get("days"));
      if (existingDays) {
        nextParams.set("days", String(existingDays));
      }
    }

    if (criteria.minSalary) {
      criteriaAccountability.markAppliedPostCapture("minSalary");
    } else {
      const existingSalary = normalizePositiveInt(parsed.searchParams.get("refine_by_salary"));
      if (existingSalary) {
        nextParams.set("refine_by_salary", String(existingSalary));
      }
    }

    if (criteria.experienceLevel) {
      criteriaAccountability.markAppliedPostCapture("experienceLevel");
    } else {
      const existingExperienceLevel = normalizeText(
        parsed.searchParams.get("refine_by_experience_level")
      );
      if (existingExperienceLevel) {
        nextParams.set("refine_by_experience_level", existingExperienceLevel);
      }
    }

    for (const passthroughKey of ["refine_by_employment", "refine_by_apply_type"]) {
      const existingValue = normalizeText(parsed.searchParams.get(passthroughKey));
      if (existingValue) {
        nextParams.set(passthroughKey, existingValue);
      }
    }

    nextParams.set("page", "1");
    parsed.search = nextParams.toString();
    parsed.hash = "";
    const finalized = criteriaAccountability.finalize();

    return {
      url: parsed.toString(),
      unsupported: finalized.unsupported,
      notes,
      criteriaAccountability: finalized
    };
  }

  if (sourceType === "levelsfyi_search") {
    const nextCriteria = {
      ...criteria
    };
    const searchText = combineTitleAndKeywords(criteria);

    if (searchText) {
      nextCriteria.keywords = searchText;
      if (criteria.title) criteriaAccountability.markAppliedInUrl("title");
      if (criteria.keywords) criteriaAccountability.markAppliedInUrl("keywords");
      if (criteria.hardIncludeTerms) {
        criteriaAccountability.markAppliedInUrl("hardIncludeTerms");
      }
      if (criteria.includeTerms) criteriaAccountability.markAppliedInUrl("includeTerms");
      if (criteria.keywordMode) criteriaAccountability.markAppliedInUrl("keywordMode");
    }

    if (criteria.location) {
      criteriaAccountability.markAppliedInUrl("location");
    }

    if (criteria.datePosted) {
      criteriaAccountability.markAppliedInUrl("datePosted");
    }

    if (criteria.minSalary) {
      criteriaAccountability.markAppliedInUrl("minSalary");
    }

    if (criteria.distanceMiles) {
      criteriaAccountability.markUnsupported("distanceMiles");
    }

    if (criteria.experienceLevel) {
      criteriaAccountability.markUnsupported("experienceLevel");
    }

    const finalized = criteriaAccountability.finalize();
    return {
      url: buildLevelsFyiSearchUrl(nextCriteria),
      unsupported: finalized.unsupported,
      notes,
      criteriaAccountability: finalized
    };
  }

  if (sourceType === "yc_jobs") {
    parsed.pathname = buildYcRoleRoute(criteria);
    parsed.search = "";
    parsed.hash = "";

    if (criteria.title) {
      criteriaAccountability.markAppliedInUrl("title");
    }

    const searchText = combineTitleAndKeywords(criteria);
    if (searchText) {
      parsed.searchParams.set("search", searchText);
      if (criteria.keywords) criteriaAccountability.markAppliedPostCapture("keywords");
      if (criteria.hardIncludeTerms) {
        criteriaAccountability.markAppliedPostCapture("hardIncludeTerms");
      }
      if (criteria.includeTerms) {
        criteriaAccountability.markAppliedPostCapture("includeTerms");
      }
      if (criteria.keywordMode) {
        criteriaAccountability.markAppliedPostCapture("keywordMode");
      }
    }

    if (criteria.location) {
      parsed.searchParams.set("location", criteria.location);
      criteriaAccountability.markAppliedPostCapture("location");
    }

    if (criteria.datePosted) {
      parsed.searchParams.set("datePosted", criteria.datePosted);
      criteriaAccountability.markAppliedPostCapture("datePosted");
    }

    if (criteria.minSalary) {
      parsed.searchParams.set("minSalary", String(criteria.minSalary));
      criteriaAccountability.markAppliedPostCapture("minSalary");
    }

    if (criteria.experienceLevel) {
      parsed.searchParams.set("experienceLevel", criteria.experienceLevel);
      criteriaAccountability.markAppliedPostCapture("experienceLevel");
    }

    if (criteria.distanceMiles) {
      criteriaAccountability.markUnsupported("distanceMiles");
    }

    const finalized = criteriaAccountability.finalize();
    return {
      url: parsed.toString(),
      unsupported: finalized.unsupported,
      notes,
      criteriaAccountability: finalized
    };
  }

  if (sourceType === "remoteok_search") {
    const keywordSlug = slugifyKeywords(
      combineTitleAndKeywords({
        ...criteria,
        keywordMode: "and",
        includeTerms: [],
        excludeTerms: []
      })
    );
    if (keywordSlug) {
      parsed.pathname = `/remote-${keywordSlug}-jobs`;
      if (criteria.title) criteriaAccountability.markAppliedInUrl("title");
      if (criteria.keywords) criteriaAccountability.markAppliedInUrl("keywords");
    }
    parsed.search = "";
    parsed.hash = "";

    if (criteria.location) criteriaAccountability.markUnsupported("location");
    if (criteria.keywordMode) criteriaAccountability.markUnsupported("keywordMode");
    if (criteria.includeTerms) criteriaAccountability.markUnsupported("includeTerms");
    if (criteria.distanceMiles) criteriaAccountability.markUnsupported("distanceMiles");
    if (criteria.minSalary) criteriaAccountability.markUnsupported("minSalary");
    if (criteria.datePosted) criteriaAccountability.markUnsupported("datePosted");
    if (criteria.experienceLevel) criteriaAccountability.markUnsupported("experienceLevel");
    const finalized = criteriaAccountability.finalize();

    return {
      url: parsed.toString(),
      unsupported: finalized.unsupported,
      notes,
      criteriaAccountability: finalized
    };
  }

  notes.push(`No URL formatter available for source type "${sourceType}".`);
  const finalized = criteriaAccountability.finalize();
  return {
    url: parsed.toString(),
    unsupported: finalized.unsupported,
    notes,
    criteriaAccountability: finalized
  };
}
