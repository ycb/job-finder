import test from "node:test";
import assert from "node:assert/strict";

import { normalizeRefreshProfile } from "../src/sources/cache-policy.js";

test("normalizeRefreshProfile defaults to safe when unset", () => {
  assert.equal(normalizeRefreshProfile(""), "safe");
  assert.equal(normalizeRefreshProfile(undefined), "safe");
});

test("normalizeRefreshProfile accepts safe/probe/mock", () => {
  assert.equal(normalizeRefreshProfile("safe"), "safe");
  assert.equal(normalizeRefreshProfile("probe"), "probe");
  assert.equal(normalizeRefreshProfile("mock"), "mock");
});

test("normalizeRefreshProfile strict mode rejects invalid values", () => {
  assert.throws(
    () => normalizeRefreshProfile("fast", { strict: true }),
    /Invalid refresh profile "fast"/
  );
});
