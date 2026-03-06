import test from "node:test";
import assert from "node:assert/strict";

import {
  computeNextEligibleAt,
  getRefreshPolicyForSource,
  getSourceRiskClass,
  isLiveRefreshAllowed
} from "../src/sources/refresh-policy.js";

test("getSourceRiskClass maps source types to expected risk classes", () => {
  assert.equal(getSourceRiskClass({ type: "linkedin_capture_file" }), "auth_high");
  assert.equal(getSourceRiskClass({ type: "wellfound_search" }), "auth_high");
  assert.equal(getSourceRiskClass({ type: "google_search" }), "public_challenge");
  assert.equal(getSourceRiskClass({ type: "ashby_search" }), "public_challenge");
  assert.equal(getSourceRiskClass({ type: "builtin_search" }), "public_standard");
  assert.equal(getSourceRiskClass({ type: "remoteok_search" }), "public_standard");
  assert.equal(getSourceRiskClass({ type: "unknown_type" }), "public_standard");
});

test("getRefreshPolicyForSource returns safe defaults by risk class", () => {
  const authPolicy = getRefreshPolicyForSource(
    { type: "linkedin_capture_file" },
    { profile: "safe" }
  );
  const googlePolicy = getRefreshPolicyForSource(
    { type: "google_search" },
    { profile: "safe" }
  );

  assert.equal(authPolicy.profile, "safe");
  assert.equal(authPolicy.liveEnabled, true);
  assert.equal(authPolicy.minIntervalMinutes, 720);
  assert.equal(authPolicy.dailyLiveCap, 4);
  assert.equal(authPolicy.cooldownMinutes, 720);

  assert.equal(googlePolicy.minIntervalMinutes, 180);
  assert.equal(googlePolicy.dailyLiveCap, 8);
  assert.equal(googlePolicy.cooldownMinutes, 720);
});

test("getRefreshPolicyForSource returns probe policy with shorter intervals and mock disables live", () => {
  const probePolicy = getRefreshPolicyForSource(
    { type: "google_search" },
    { profile: "probe" }
  );
  const mockPolicy = getRefreshPolicyForSource(
    { type: "google_search" },
    { profile: "mock" }
  );

  assert.equal(probePolicy.profile, "probe");
  assert.equal(probePolicy.minIntervalMinutes, 20);
  assert.equal(probePolicy.dailyLiveCap, 20);
  assert.equal(probePolicy.cooldownMinutes, 180);
  assert.equal(probePolicy.liveEnabled, true);

  assert.equal(mockPolicy.profile, "mock");
  assert.equal(mockPolicy.liveEnabled, false);
});

test("isLiveRefreshAllowed blocks when cooldown is active", () => {
  const now = "2026-03-06T17:00:00.000Z";
  const policy = getRefreshPolicyForSource(
    { type: "google_search" },
    { profile: "safe" }
  );

  const decision = isLiveRefreshAllowed({
    policy,
    now,
    cooldownUntil: "2026-03-06T18:00:00.000Z",
    lastLiveAt: "2026-03-06T14:00:00.000Z",
    liveEventsTodayCount: 1
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "cooldown");
  assert.equal(decision.nextEligibleAt, "2026-03-06T18:00:00.000Z");
});

test("isLiveRefreshAllowed blocks when min interval has not elapsed", () => {
  const now = "2026-03-06T17:00:00.000Z";
  const policy = getRefreshPolicyForSource(
    { type: "google_search" },
    { profile: "safe" }
  );

  const decision = isLiveRefreshAllowed({
    policy,
    now,
    cooldownUntil: null,
    lastLiveAt: "2026-03-06T16:00:00.000Z",
    liveEventsTodayCount: 1
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "min_interval");
  assert.equal(decision.nextEligibleAt, "2026-03-06T19:00:00.000Z");
});

test("isLiveRefreshAllowed blocks on daily cap and opens at next UTC day", () => {
  const now = "2026-03-06T23:10:00.000Z";
  const policy = getRefreshPolicyForSource(
    { type: "google_search" },
    { profile: "safe" }
  );

  const decision = isLiveRefreshAllowed({
    policy,
    now,
    cooldownUntil: null,
    lastLiveAt: "2026-03-06T20:00:00.000Z",
    liveEventsTodayCount: policy.dailyLiveCap
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "daily_cap");
  assert.equal(decision.nextEligibleAt, "2026-03-07T00:00:00.000Z");
});

test("isLiveRefreshAllowed allows refresh when all constraints pass", () => {
  const now = "2026-03-06T17:00:00.000Z";
  const policy = getRefreshPolicyForSource(
    { type: "google_search" },
    { profile: "safe" }
  );

  const decision = isLiveRefreshAllowed({
    policy,
    now,
    cooldownUntil: null,
    lastLiveAt: "2026-03-06T10:00:00.000Z",
    liveEventsTodayCount: 1
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, "eligible");
  assert.equal(decision.nextEligibleAt, null);
});

test("computeNextEligibleAt prioritizes cooldown over min interval", () => {
  const now = "2026-03-06T17:00:00.000Z";
  const policy = getRefreshPolicyForSource(
    { type: "google_search" },
    { profile: "safe" }
  );

  const nextEligibleAt = computeNextEligibleAt({
    policy,
    now,
    cooldownUntil: "2026-03-06T18:00:00.000Z",
    lastLiveAt: "2026-03-06T16:00:00.000Z",
    liveEventsTodayCount: 1
  });

  assert.equal(nextEligibleAt, "2026-03-06T18:00:00.000Z");
});
