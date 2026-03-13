import test from "node:test";
import assert from "node:assert/strict";

import {
  assertModeTitle,
  getFlowRunner
} from "../scripts/playwright-jobs-flow-smoke.js";

test("legacy title validation rejects the react shell title", () => {
  assert.throws(
    () => {
      assertModeTitle("legacy", "Job Finder Dashboard UI");
    },
    /Unexpected legacy page title/
  );
});

test("jobs smoke exposes runners for each supported mode", () => {
  assert.equal(typeof getFlowRunner("legacy"), "function");
  assert.equal(typeof getFlowRunner("react"), "function");
});
