import test from "node:test";
import assert from "node:assert/strict";

import {
  applySourceQaOverrides,
  isSourceQaModeEnabled
} from "../src/sources/qa-mode.js";

test("source QA mode is disabled by default", () => {
  assert.equal(isSourceQaModeEnabled({}), false);
  assert.deepEqual(applySourceQaOverrides({ refreshProfile: "safe" }, {}), {
    refreshProfile: "safe"
  });
});

test("source QA mode enables live-first overrides", () => {
  const env = { JOB_FINDER_SOURCE_QA_MODE: "1" };

  assert.equal(isSourceQaModeEnabled(env), true);
  assert.deepEqual(
    applySourceQaOverrides(
      {
        refreshProfile: "safe",
        forceRefresh: false,
        allowQuarantined: false,
        cacheTtlHours: 12
      },
      env
    ),
    {
      refreshProfile: "probe",
      forceRefresh: true,
      allowQuarantined: true,
      cacheTtlHours: 12
    }
  );
});
