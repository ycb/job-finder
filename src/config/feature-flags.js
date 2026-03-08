function parseFlag(rawValue, fallback = false) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return fallback;
  }

  const normalized = String(rawValue).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function isOnboardingWizardEnabled(env = process.env) {
  return parseFlag(env?.JOB_FINDER_ENABLE_ONBOARDING_WIZARD, true);
}

export function isAnalyticsEnabledByFlag(env = process.env) {
  return parseFlag(env?.JOB_FINDER_ENABLE_ANALYTICS, true);
}

export function isMonetizationLimitsEnabled(env = process.env) {
  return parseFlag(env?.JOB_FINDER_ENABLE_MONETIZATION_LIMITS, false);
}

