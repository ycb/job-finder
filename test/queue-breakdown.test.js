import test from "node:test";
import assert from "node:assert/strict";

import {
  buildQueueBreakdown,
  filterActiveQueueJobs
} from "../src/jobs/active-queue.js";

function job(overrides = {}) {
  return { status: "new", hardFiltered: 0, bucket: "review_later", ...overrides };
}

test("breakdown buckets are mutually exclusive and sum to stored", () => {
  const jobs = [
    job({ status: "applied" }),
    job({ status: "applied", hardFiltered: 1 }), // user action outranks gate
    job({ status: "skip_for_now" }),
    job({ status: "rejected" }),
    job({ hardFiltered: 1 }),
    job({ bucket: "reject" }),
    job(),
    job({ status: "viewed", bucket: "high_signal" })
  ];

  const breakdown = buildQueueBreakdown(jobs);
  assert.equal(breakdown.stored, 8);
  assert.equal(breakdown.applied, 2);
  assert.equal(breakdown.skipped, 1);
  assert.equal(breakdown.rejectedByUser, 1);
  assert.equal(breakdown.hardFiltered, 1);

  const sum =
    breakdown.applied +
    breakdown.skipped +
    breakdown.rejectedByUser +
    breakdown.hardFiltered +
    breakdown.lowSignal +
    breakdown.active;
  assert.equal(sum, breakdown.stored);

  // Active always agrees with the real product gate.
  assert.equal(breakdown.active, filterActiveQueueJobs(jobs).length);
});

test("fully worked-through queue reports zero active with a complete account", () => {
  const jobs = [
    job({ status: "applied" }),
    job({ status: "applied" }),
    job({ status: "skip_for_now" }),
    job({ hardFiltered: 1 }),
    job({ hardFiltered: 1, status: "viewed" })
  ];

  const breakdown = buildQueueBreakdown(jobs);
  assert.equal(breakdown.active, 0);
  assert.equal(breakdown.applied, 2);
  assert.equal(breakdown.skipped, 1);
  assert.equal(breakdown.hardFiltered, 2);
  assert.equal(breakdown.stored, 5);
});

test("empty input yields an all-zero breakdown", () => {
  const breakdown = buildQueueBreakdown([]);
  assert.deepEqual(breakdown, {
    stored: 0,
    applied: 0,
    skipped: 0,
    rejectedByUser: 0,
    hardFiltered: 0,
    lowSignal: 0,
    active: 0
  });
});
