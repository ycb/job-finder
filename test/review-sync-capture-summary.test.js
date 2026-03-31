import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildCapturePayloadFromRawJobs } from "../src/review/server.js";

test("buildCapturePayloadFromRawJobs prefers the refreshed capture summary after collection", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-capture-summary-"));
  const capturePath = path.join(tempDir, "linkedin.json");
  const source = {
    id: "linkedin-live-capture",
    type: "linkedin_capture_file",
    capturePath
  };

  fs.writeFileSync(
    capturePath,
    JSON.stringify(
      {
        capturedAt: "2026-03-31T20:00:00.000Z",
        expectedCount: 57,
        pageUrl: "https://www.linkedin.com/jobs/search/?keywords=product+manager+ai",
        captureFunnel: {
          capturedRawCount: 34,
          postHardFilterCount: 22,
          postDedupeCount: 18,
          importedCount: 18
        },
        jobs: [{ title: "Product Manager" }]
      },
      null,
      2
    )
  );

  const payload = buildCapturePayloadFromRawJobs(
    source,
    {
      capturedAt: "2026-03-30T20:00:00.000Z",
      expectedCount: 11,
      pageUrl: "https://stale.example/jobs",
      payload: {
        captureFunnel: {
          capturedRawCount: 11,
          postHardFilterCount: 6,
          postDedupeCount: 5,
          importedCount: 5
        }
      }
    },
    [{ id: "job-1" }]
  );

  assert.equal(payload.capturedAt, "2026-03-31T20:00:00.000Z");
  assert.equal(payload.expectedCount, 57);
  assert.equal(
    payload.pageUrl,
    "https://www.linkedin.com/jobs/search/?keywords=product+manager+ai"
  );
  assert.deepEqual(payload.captureFunnel, {
    availableCount: null,
    capturedRawCount: 34,
    postHardFilterCount: 22,
    postDedupeCount: 18,
    importedCount: 18
  });
  assert.deepEqual(payload.jobs, [{ id: "job-1" }]);
});
