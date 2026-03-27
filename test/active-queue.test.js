import test from "node:test";
import assert from "node:assert/strict";

import { filterActiveQueueJobs, isActiveQueueJob } from "../src/jobs/active-queue.js";

test("isActiveQueueJob excludes reject-bucket and hard-filtered rows from the active queue", () => {
  assert.equal(isActiveQueueJob({ status: "new", bucket: "high_signal", hardFiltered: 0 }), true);
  assert.equal(isActiveQueueJob({ status: "viewed", bucket: "review_later", hardFiltered: 0 }), true);
  assert.equal(isActiveQueueJob({ status: "new", bucket: "reject", hardFiltered: 0 }), false);
  assert.equal(isActiveQueueJob({ status: "viewed", bucket: "reject", hardFiltered: 1 }), false);
  assert.equal(isActiveQueueJob({ status: "applied", bucket: "high_signal", hardFiltered: 0 }), false);
});

test("filterActiveQueueJobs keeps only non-rejected active queue rows", () => {
  assert.deepEqual(
    filterActiveQueueJobs([
      { id: "keep-new", status: "new", bucket: "high_signal", hardFiltered: 0 },
      { id: "keep-viewed", status: "viewed", bucket: "review_later", hardFiltered: 0 },
      { id: "drop-reject", status: "new", bucket: "reject", hardFiltered: 0 },
      { id: "drop-hard", status: "new", bucket: "reject", hardFiltered: 1 },
      { id: "drop-applied", status: "applied", bucket: "high_signal", hardFiltered: 0 },
    ]).map((job) => job.id),
    ["keep-new", "keep-viewed"],
  );
});
