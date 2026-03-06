const PROFILE_SET = new Set(["safe", "probe", "mock"]);

const RISK_CLASS_BY_TYPE = new Map([
  ["linkedin_capture_file", "auth_high"],
  ["wellfound_search", "auth_high"],
  ["google_search", "public_challenge"],
  ["ashby_search", "public_challenge"],
  ["indeed_search", "public_standard"],
  ["ziprecruiter_search", "public_standard"],
  ["builtin_search", "public_standard"],
  ["remoteok_search", "public_standard"]
]);

const POLICY_TABLE = {
  safe: {
    auth_high: {
      minIntervalMinutes: 12 * 60,
      dailyLiveCap: 4,
      cooldownMinutes: 12 * 60
    },
    public_challenge: {
      minIntervalMinutes: 3 * 60,
      dailyLiveCap: 8,
      cooldownMinutes: 12 * 60
    },
    public_standard: {
      minIntervalMinutes: 60,
      dailyLiveCap: 12,
      cooldownMinutes: 4 * 60
    }
  },
  probe: {
    auth_high: {
      minIntervalMinutes: 90,
      dailyLiveCap: 10,
      cooldownMinutes: 4 * 60
    },
    public_challenge: {
      minIntervalMinutes: 20,
      dailyLiveCap: 20,
      cooldownMinutes: 3 * 60
    },
    public_standard: {
      minIntervalMinutes: 10,
      dailyLiveCap: 30,
      cooldownMinutes: 2 * 60
    }
  }
};

function normalizeProfile(rawProfile) {
  const normalized = String(rawProfile || "safe").trim().toLowerCase();
  return PROFILE_SET.has(normalized) ? normalized : "safe";
}

function parseTimestamp(rawValue) {
  const input = String(rawValue || "").trim();
  if (!input) {
    return null;
  }

  const parsed = Date.parse(input);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoAt(ms) {
  if (!Number.isFinite(ms)) {
    return null;
  }
  return new Date(ms).toISOString();
}

function nextUtcDayStartMs(nowMs) {
  const date = new Date(nowMs);
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + 1,
    0,
    0,
    0,
    0
  );
}

export function getSourceRiskClass(source) {
  const sourceType = String(source?.type || "").trim();
  return RISK_CLASS_BY_TYPE.get(sourceType) || "public_standard";
}

export function getRefreshPolicyForSource(source, options = {}) {
  const profile = normalizeProfile(options.profile);
  const riskClass = getSourceRiskClass(source);

  if (profile === "mock") {
    return {
      profile,
      riskClass,
      liveEnabled: false,
      minIntervalMinutes: Number.POSITIVE_INFINITY,
      dailyLiveCap: 0,
      cooldownMinutes: 0
    };
  }

  const fromProfile = POLICY_TABLE[profile] || POLICY_TABLE.safe;
  const defaults = fromProfile[riskClass] || fromProfile.public_standard;

  return {
    profile,
    riskClass,
    liveEnabled: true,
    minIntervalMinutes: defaults.minIntervalMinutes,
    dailyLiveCap: defaults.dailyLiveCap,
    cooldownMinutes: defaults.cooldownMinutes
  };
}

export function computeNextEligibleAt(state) {
  const policy = state?.policy;
  const nowMs = parseTimestamp(state?.now) ?? Date.now();

  if (!policy || policy.liveEnabled === false) {
    return null;
  }

  const cooldownUntilMs = parseTimestamp(state?.cooldownUntil);
  if (cooldownUntilMs !== null && cooldownUntilMs > nowMs) {
    return isoAt(cooldownUntilMs);
  }

  if (Number(state?.liveEventsTodayCount) >= Number(policy.dailyLiveCap || 0)) {
    return isoAt(nextUtcDayStartMs(nowMs));
  }

  const lastLiveAtMs = parseTimestamp(state?.lastLiveAt);
  const minIntervalMinutes = Number(policy.minIntervalMinutes);
  if (
    lastLiveAtMs !== null &&
    Number.isFinite(minIntervalMinutes) &&
    minIntervalMinutes > 0
  ) {
    const eligibleAtMs = lastLiveAtMs + minIntervalMinutes * 60 * 1000;
    if (eligibleAtMs > nowMs) {
      return isoAt(eligibleAtMs);
    }
  }

  return null;
}

export function isLiveRefreshAllowed(state) {
  const policy = state?.policy;
  const nowMs = parseTimestamp(state?.now) ?? Date.now();

  if (!policy || policy.liveEnabled === false) {
    return {
      allowed: false,
      reason: "mock_profile",
      nextEligibleAt: null
    };
  }

  const cooldownUntilMs = parseTimestamp(state?.cooldownUntil);
  if (cooldownUntilMs !== null && cooldownUntilMs > nowMs) {
    return {
      allowed: false,
      reason: "cooldown",
      nextEligibleAt: isoAt(cooldownUntilMs)
    };
  }

  const liveEventsTodayCount = Number(state?.liveEventsTodayCount || 0);
  if (liveEventsTodayCount >= Number(policy.dailyLiveCap || 0)) {
    return {
      allowed: false,
      reason: "daily_cap",
      nextEligibleAt: isoAt(nextUtcDayStartMs(nowMs))
    };
  }

  const lastLiveAtMs = parseTimestamp(state?.lastLiveAt);
  const minIntervalMinutes = Number(policy.minIntervalMinutes);
  if (
    lastLiveAtMs !== null &&
    Number.isFinite(minIntervalMinutes) &&
    minIntervalMinutes > 0
  ) {
    const eligibleAtMs = lastLiveAtMs + minIntervalMinutes * 60 * 1000;
    if (eligibleAtMs > nowMs) {
      return {
        allowed: false,
        reason: "min_interval",
        nextEligibleAt: isoAt(eligibleAtMs)
      };
    }
  }

  return {
    allowed: true,
    reason: "eligible",
    nextEligibleAt: null
  };
}
