function normalizeFlag(value) {
  return String(value || "").trim().toLowerCase();
}

export function isSourceQaModeEnabled(env = process.env) {
  const value = normalizeFlag(env.JOB_FINDER_SOURCE_QA_MODE);
  return value === "1" || value === "true" || value === "yes";
}

export function applySourceQaOverrides(options = {}, env = process.env) {
  if (!isSourceQaModeEnabled(env)) {
    return { ...options };
  }

  return {
    ...options,
    refreshProfile: "probe",
    forceRefresh: true,
    allowQuarantined: true
  };
}
