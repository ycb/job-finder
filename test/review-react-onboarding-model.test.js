import test from "node:test";
import assert from "node:assert/strict";

import {
  buildConsentPayload,
  getCheckButtonLabel,
  groupOnboardingSources,
  onboardingReadinessState
} from "../src/review/web/src/lib/onboarding.js";

test("onboardingReadinessState classifies disabled, ready, and auth-required states", () => {
  const checksBySourceId = {
    linkedin: { status: "warn" },
    indeed: { status: "PASS" }
  };

  assert.deepEqual(onboardingReadinessState({ id: "google", enabled: false }, checksBySourceId), {
    key: "disabled",
    label: "Disabled",
    tone: "muted"
  });

  assert.deepEqual(
    onboardingReadinessState({ id: "builtin", enabled: true, authRequired: false }, checksBySourceId),
    {
      key: "ready",
      label: "Ready",
      tone: "ok"
    }
  );

  assert.deepEqual(
    onboardingReadinessState({ id: "indeed", enabled: true, authRequired: true }, checksBySourceId),
    {
      key: "ready",
      label: "Ready",
      tone: "ok"
    }
  );

  assert.deepEqual(
    onboardingReadinessState({ id: "linkedin", enabled: true, authRequired: true }, checksBySourceId),
    {
      key: "not_authorized",
      label: "Issue detected",
      tone: "warn"
    }
  );
});

test("groupOnboardingSources returns Enabled / Authentication Required / Not Enabled groups", () => {
  const checksBySourceId = {
    linkedin: { status: "warn" },
    indeed: { status: "pass" }
  };
  const sources = [
    { id: "linkedin", enabled: true, authRequired: true },
    { id: "indeed", enabled: true, authRequired: true },
    { id: "builtin", enabled: true, authRequired: false },
    { id: "google", enabled: false, authRequired: false }
  ];

  const grouped = groupOnboardingSources(sources, checksBySourceId);

  assert.deepEqual(
    grouped.enabled.map((source) => source.id),
    ["indeed", "builtin"]
  );
  assert.deepEqual(
    grouped.authRequired.map((source) => source.id),
    ["linkedin"]
  );
  assert.deepEqual(
    grouped.notEnabled.map((source) => source.id),
    ["google"]
  );
});

test("getCheckButtonLabel prefers checking state then re-check when a prior check failed", () => {
  assert.equal(getCheckButtonLabel({ isBusy: true, hasPriorFailedCheck: false }), "Checking...");
  assert.equal(getCheckButtonLabel({ isBusy: false, hasPriorFailedCheck: true }), "Re-check");
  assert.equal(getCheckButtonLabel({ isBusy: false, hasPriorFailedCheck: false }), "Check access");
});

test("buildConsentPayload maps legal + risk checkboxes to onboarding consent schema", () => {
  const payload = buildConsentPayload({ legalAccepted: true, tosRiskAccepted: true });
  assert.deepEqual(payload, {
    termsAccepted: true,
    privacyAccepted: true,
    rateLimitPolicyAccepted: true,
    tosRiskAccepted: true
  });
});
