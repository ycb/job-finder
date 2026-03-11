export function onboardingReadinessState(source, checksBySourceId = {}) {
  if (!source || source.enabled !== true) {
    return {
      key: "disabled",
      label: "Disabled",
      tone: "muted"
    };
  }

  if (!source.authRequired) {
    return {
      key: "ready",
      label: "Ready",
      tone: "ok"
    };
  }

  const check = checksBySourceId[source.id];
  const status = check && check.status ? String(check.status).toLowerCase() : "warn";

  if (status === "pass") {
    return {
      key: "ready",
      label: "Ready",
      tone: "ok"
    };
  }

  return {
    key: "not_authorized",
    label: "Issue detected",
    tone: "warn"
  };
}

export function groupOnboardingSources(sources, checksBySourceId = {}) {
  const list = Array.isArray(sources) ? sources.filter(Boolean) : [];
  const readinessBySourceId = Object.create(null);
  const enabled = [];
  const authRequired = [];
  const notEnabled = [];

  for (const source of list) {
    const readiness = onboardingReadinessState(source, checksBySourceId);
    readinessBySourceId[source.id] = readiness;

    if (readiness.key === "ready") {
      enabled.push(source);
      continue;
    }

    if (source.authRequired && source.enabled === true && readiness.key === "not_authorized") {
      authRequired.push(source);
      continue;
    }

    if (readiness.key === "disabled") {
      notEnabled.push(source);
    }
  }

  return {
    enabled,
    authRequired,
    notEnabled,
    readinessBySourceId
  };
}

export function getCheckButtonLabel({ isBusy, hasPriorFailedCheck }) {
  if (isBusy) {
    return "Checking...";
  }

  return hasPriorFailedCheck ? "Re-check" : "Check access";
}

export function buildConsentPayload({ legalAccepted, tosRiskAccepted }) {
  const legal = Boolean(legalAccepted);
  return {
    termsAccepted: legal,
    privacyAccepted: legal,
    rateLimitPolicyAccepted: true,
    tosRiskAccepted: Boolean(tosRiskAccepted)
  };
}
