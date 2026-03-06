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

const ZIP_EXPERIENCE_LEVELS = new Map([
  ["intern", "entry"],
  ["entry", "entry"],
  ["associate", "mid"],
  ["mid", "mid"],
  ["senior", "senior"],
  ["director", "senior"],
  ["executive", "senior"]
]);

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

  const keywords = normalizeText(rawCriteria.keywords);
  if (keywords) {
    normalized.keywords = keywords;
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
  const keywords = normalizeText(criteria?.keywords);
  return [title, keywords].filter(Boolean).join(" ").trim();
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
  const unsupported = [];
  const notes = [];
  const parsed = toUrl(options.baseUrl, sourceType);

  if (!parsed) {
    return {
      url: "",
      unsupported: [
        "title",
        "keywords",
        "location",
        "distanceMiles",
        "datePosted",
        "experienceLevel",
        "minSalary"
      ],
      notes: ["No valid base URL available for source type."]
    };
  }

  if (sourceType === "linkedin_capture_file") {
    const nextParams = new URLSearchParams();
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
    }

    if (criteria.location) {
      nextParams.delete("geoId");
      nextParams.set("location", criteria.location);
    }

    if (criteria.distanceMiles) {
      nextParams.set("distance", String(criteria.distanceMiles));
    }

    if (criteria.datePosted && criteria.datePosted !== "any") {
      const days = DATE_POSTED_TO_DAYS.get(criteria.datePosted);
      if (days) {
        nextParams.set("f_TPR", `r${days * 24 * 60 * 60}`);
      } else {
        unsupported.push("datePosted");
      }
    }

    if (criteria.experienceLevel) {
      const mapped = LINKEDIN_EXPERIENCE_TO_F_E.get(criteria.experienceLevel);
      if (mapped) {
        nextParams.set("f_E", mapped);
      } else {
        unsupported.push("experienceLevel");
      }
    }

    if (criteria.minSalary) {
      const bucket = toLinkedInSalaryBucket(criteria.minSalary);
      if (bucket) {
        nextParams.set("f_SB2", bucket);
      } else {
        unsupported.push("minSalary");
      }
    }

    parsed.search = nextParams.toString();
    parsed.hash = "";

    return {
      url: parsed.toString(),
      unsupported: dedupe(unsupported),
      notes
    };
  }

  if (sourceType === "builtin_search") {
    const nextParams = new URLSearchParams();
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
    }

    if (criteria.location) {
      const parts = parseLocationParts(criteria.location);
      if (parts.city) nextParams.set("city", parts.city);
      if (parts.state) nextParams.set("state", parts.state);
      if (parts.country) nextParams.set("country", parts.country);
    }

    if (criteria.datePosted && criteria.datePosted !== "any") {
      const days = DATE_POSTED_TO_DAYS.get(criteria.datePosted);
      if (days) {
        nextParams.set("daysSinceUpdated", String(days));
      } else {
        unsupported.push("datePosted");
      }
    }

    if (criteria.distanceMiles) {
      unsupported.push("distanceMiles");
    }

    if (criteria.minSalary) {
      unsupported.push("minSalary");
    }

    if (criteria.experienceLevel) {
      unsupported.push("experienceLevel");
    }

    parsed.search = nextParams.toString();
    parsed.hash = "";

    return {
      url: parsed.toString(),
      unsupported: dedupe(unsupported),
      notes
    };
  }

  if (sourceType === "wellfound_search") {
    if (criteria.title) unsupported.push("title");
    if (criteria.keywords) unsupported.push("keywords");
    if (criteria.location) unsupported.push("location");
    if (criteria.minSalary) unsupported.push("minSalary");
    if (criteria.distanceMiles) unsupported.push("distanceMiles");
    if (criteria.datePosted) unsupported.push("datePosted");
    if (criteria.experienceLevel) unsupported.push("experienceLevel");

    notes.push("Wellfound currently requires UI bootstrap; URL-only criteria are stubbed.");

    parsed.search = "";
    parsed.hash = "";

    return {
      url: parsed.toString(),
      unsupported: dedupe(unsupported),
      notes
    };
  }

  if (sourceType === "ashby_search" || sourceType === "google_search") {
    const nextParams = new URLSearchParams();
    const queryTerms = [];

    if (sourceType === "ashby_search") {
      queryTerms.push("site:ashbyhq.com");
    }

    if (criteria.title) {
      queryTerms.push(criteria.title);
    }

    if (criteria.keywords) {
      queryTerms.push(criteria.keywords);
    }

    if (criteria.location) {
      queryTerms.push(`"${criteria.location}"`);
    }

    if (criteria.minSalary && sourceType !== "ashby_search") {
      queryTerms.push(`${formatUsdAmount(criteria.minSalary)}+`);
    } else if (criteria.minSalary && sourceType === "ashby_search") {
      unsupported.push("minSalary");
    }

    if (criteria.experienceLevel) {
      queryTerms.push(criteria.experienceLevel);
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

    if (criteria.distanceMiles) {
      unsupported.push("distanceMiles");
    }

    parsed.search = nextParams.toString();
    parsed.hash = "";

    return {
      url: parsed.toString(),
      unsupported: dedupe(unsupported),
      notes
    };
  }

  if (sourceType === "indeed_search") {
    const nextParams = new URLSearchParams();
    const titleKeywords = combineTitleAndKeywords(criteria);

    if (titleKeywords) {
      nextParams.set("q", titleKeywords);
    } else {
      const existingQuery = normalizeText(parsed.searchParams.get("q"));
      if (existingQuery) {
        nextParams.set("q", existingQuery);
      }
    }

    if (criteria.location) {
      nextParams.set("l", criteria.location);
    } else {
      const existingLocation =
        normalizeText(parsed.searchParams.get("l")) ||
        normalizeText(parsed.searchParams.get("locString"));
      if (existingLocation) {
        nextParams.set("l", existingLocation);
      }
    }

    if (criteria.distanceMiles) {
      nextParams.set("radius", String(criteria.distanceMiles));
    } else {
      const existingRadius = normalizePositiveInt(parsed.searchParams.get("radius"));
      if (existingRadius) {
        nextParams.set("radius", String(existingRadius));
      }
    }

    if (criteria.minSalary) {
      nextParams.set("salaryType", formatUsdAmount(criteria.minSalary));
    } else {
      const existingSalary = normalizeText(parsed.searchParams.get("salaryType"));
      if (existingSalary) {
        nextParams.set("salaryType", existingSalary);
      }
    }

    if (criteria.datePosted && criteria.datePosted !== "any") {
      const days = DATE_POSTED_TO_DAYS.get(criteria.datePosted);
      if (days) {
        nextParams.set("fromage", String(days));
      } else {
        unsupported.push("datePosted");
      }
    }

    if (criteria.experienceLevel) {
      unsupported.push("experienceLevel");
    }

    parsed.search = nextParams.toString();
    parsed.hash = "";

    return {
      url: parsed.toString(),
      unsupported: dedupe(unsupported),
      notes
    };
  }

  if (sourceType === "ziprecruiter_search") {
    const nextParams = new URLSearchParams();
    const titleKeywords = combineTitleAndKeywords(criteria);

    if (titleKeywords) {
      nextParams.set("search", titleKeywords);
    } else {
      const existingQuery = normalizeText(parsed.searchParams.get("search"));
      if (existingQuery) {
        nextParams.set("search", existingQuery);
      }
    }

    if (criteria.location) {
      nextParams.set("location", criteria.location);
    } else {
      const existingLocation = normalizeText(parsed.searchParams.get("location"));
      if (existingLocation) {
        nextParams.set("location", existingLocation);
      }
    }

    if (criteria.distanceMiles) {
      nextParams.set("radius", String(criteria.distanceMiles));
    } else {
      const existingRadius = normalizePositiveInt(parsed.searchParams.get("radius"));
      if (existingRadius) {
        nextParams.set("radius", String(existingRadius));
      }
    }

    if (criteria.datePosted && criteria.datePosted !== "any") {
      const days = DATE_POSTED_TO_DAYS.get(criteria.datePosted);
      if (days) {
        nextParams.set("days", String(days));
      } else {
        unsupported.push("datePosted");
      }
    }

    if (criteria.minSalary) {
      nextParams.set("refine_by_salary", String(criteria.minSalary));
    }

    if (criteria.experienceLevel) {
      const mapped = ZIP_EXPERIENCE_LEVELS.get(criteria.experienceLevel);
      if (mapped) {
        nextParams.set("refine_by_experience_level", mapped);
      } else {
        unsupported.push("experienceLevel");
      }
    }

    nextParams.set("page", "1");
    parsed.search = nextParams.toString();
    parsed.hash = "";

    return {
      url: parsed.toString(),
      unsupported: dedupe(unsupported),
      notes
    };
  }

  if (sourceType === "remoteok_search") {
    const keywordSlug = slugifyKeywords(combineTitleAndKeywords(criteria));
    if (keywordSlug) {
      parsed.pathname = `/remote-${keywordSlug}-jobs`;
    }
    parsed.search = "";
    parsed.hash = "";

    if (criteria.location) unsupported.push("location");
    if (criteria.distanceMiles) unsupported.push("distanceMiles");
    if (criteria.minSalary) unsupported.push("minSalary");
    if (criteria.datePosted) unsupported.push("datePosted");
    if (criteria.experienceLevel) unsupported.push("experienceLevel");

    return {
      url: parsed.toString(),
      unsupported: dedupe(unsupported),
      notes
    };
  }

  notes.push(`No URL formatter available for source type "${sourceType}".`);
  return {
    url: parsed.toString(),
    unsupported: dedupe(unsupported),
    notes
  };
}
