function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string.`);
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
    )
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
        "builtin_search"
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

      if (type === "builtin_search") {
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

      return normalizedSource;
    })
  };
}
