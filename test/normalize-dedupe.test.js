import test from "node:test";
import assert from "node:assert/strict";

import { normalizeJobRecord } from "../src/jobs/normalize.js";

test("linkedin normalization keeps dedupe stable across malformed and canonical variants", () => {
  const source = {
    id: "ai-pm",
    type: "linkedin_capture_file",
    searchUrl: "https://www.linkedin.com/jobs/search-results/?keywords=ai+pm"
  };

  const canonical = normalizeJobRecord(
    {
      title: "Staff Product Manager, AI Discovery",
      company: "Faire Wholesale, Inc.",
      location: "San Francisco, CA (Hybrid)",
      description: "Role details",
      url: "https://www.linkedin.com/jobs/view/1234567890/?trackingId=abc"
    },
    source
  );

  const malformed = normalizeJobRecord(
    {
      title: "Staff Product Manager, AI Discovery",
      company: "Staff Product Manager, AI Discovery",
      location: "Faire Wholesale, Inc.",
      description: "Role details",
      url: "https://www.linkedin.com/jobs/search-results/?keywords=Staff+Product+Manager%2C+AI+Discovery++Staff+Product+Manager%2C+AI+Discovery"
    },
    source
  );

  assert.equal(canonical.company, "Faire Wholesale, Inc.");
  assert.equal(malformed.company, "Faire Wholesale, Inc.");
  assert.equal(canonical.normalizedHash, malformed.normalizedHash);
});
