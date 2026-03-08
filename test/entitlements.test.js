import test from "node:test";
import assert from "node:assert/strict";

import { getEntitlementState } from "../src/monetization/entitlements.js";

test("getEntitlementState enforces free-plan remaining when flag enabled", () => {
  const today = new Date().toISOString().slice(0, 10);
  const state = getEntitlementState(
    {
      onboarding: { completed: true },
      monetization: {
        plan: "free",
        dailyViewLimit: 10,
        dailyViewCount: 3,
        dailyViewDate: today
      }
    },
    {
      JOB_FINDER_ENABLE_MONETIZATION_LIMITS: "1"
    }
  );

  assert.equal(state.plan, "free");
  assert.equal(state.viewsUsedToday, 3);
  assert.equal(state.remaining, 7);
  assert.equal(state.limitEnabled, true);
  assert.equal(state.onboardingCompleted, true);
});

test("getEntitlementState does not enforce limits when flag disabled", () => {
  const state = getEntitlementState(
    {
      monetization: {
        plan: "free",
        dailyViewLimit: 10,
        dailyViewCount: 9,
        dailyViewDate: "2099-01-01"
      }
    },
    {
      JOB_FINDER_ENABLE_MONETIZATION_LIMITS: "0"
    }
  );

  assert.equal(state.viewsUsedToday, 0);
  assert.equal(state.limitEnabled, false);
  assert.equal(state.remaining, null);
});
