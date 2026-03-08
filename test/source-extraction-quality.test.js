import test from "node:test";
import assert from "node:assert/strict";

import { normalizeJobRecord } from "../src/jobs/normalize.js";

const source = {
  id: "quality-test",
  type: "indeed_search",
  searchUrl: "https://www.indeed.com/jobs?q=product+manager+ai"
};

test("metadata quality score drops when required fields are unknown", () => {
  const lowQuality = normalizeJobRecord(
    {
      title: "Product Manager",
      company: "Example Co",
      description: "Build products.",
      url: "https://www.indeed.com/viewjob?jk=abc123"
    },
    source
  );

  const highQuality = normalizeJobRecord(
    {
      title: "Product Manager",
      company: "Example Co",
      location: "San Francisco, CA",
      postedAt: "1 day ago",
      salaryText: "$180,000 - $220,000",
      employmentType: "full-time",
      description: "Build AI products.",
      url: "https://www.indeed.com/viewjob?jk=def456"
    },
    source
  );

  assert.ok(Array.isArray(lowQuality.missingRequiredFields));
  assert.ok(lowQuality.missingRequiredFields.length > 0);
  assert.ok(highQuality.missingRequiredFields.length < lowQuality.missingRequiredFields.length);
  assert.ok(highQuality.metadataQualityScore > lowQuality.metadataQualityScore);
});
