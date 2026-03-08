import test from "node:test";
import assert from "node:assert/strict";

import { normalizeJobRecord } from "../src/jobs/normalize.js";

test("normalizeJobRecord emits structured metadata with required placeholders", () => {
  const source = {
    id: "google-ai",
    type: "google_search",
    searchUrl: "https://www.google.com/search?q=ai+product+manager&udm=8"
  };

  const normalized = normalizeJobRecord(
    {
      title: "Principal Product Manager, AI",
      company: "Example Co",
      description: "Lead AI product strategy across distributed systems.",
      url: "https://careers.example.com/jobs/12345"
    },
    source
  );

  assert.equal(normalized.location, "unknown");
  assert.equal(normalized.salaryText, "unknown");
  assert.equal(normalized.employmentType, "unknown");
  assert.ok(normalized.structuredMeta);
  assert.equal(normalized.structuredMeta.location, "unknown");
  assert.equal(normalized.structuredMeta.salary.rawText, "unknown");
  assert.equal(normalized.structuredMeta.employmentType, "unknown");
  assert.ok(Array.isArray(normalized.missingRequiredFields));
  assert.ok(normalized.missingRequiredFields.includes("location"));
  assert.ok(normalized.missingRequiredFields.includes("salary"));
  assert.ok(Number.isFinite(normalized.metadataQualityScore));
});

test("normalizeJobRecord freshness and salary metadata include parsed hints", () => {
  const source = {
    id: "zip-ai",
    type: "ziprecruiter_search",
    searchUrl: "https://www.ziprecruiter.com/jobs-search?search=ai+product+manager"
  };

  const normalized = normalizeJobRecord(
    {
      title: "Senior Product Manager",
      company: "Example Co",
      location: "San Francisco, CA",
      postedAt: "3 days ago",
      salaryText: "$210,000 - $260,000",
      employmentType: "full-time",
      description: "Own roadmap and AI/ML platform strategy.",
      url: "https://www.ziprecruiter.com/job/senior-product-manager-123"
    },
    source
  );

  assert.equal(normalized.structuredMeta.salary.minAnnualUsd, 210000);
  assert.equal(normalized.structuredMeta.salary.maxAnnualUsd, 260000);
  assert.equal(normalized.structuredMeta.freshness.rawText, "3 days ago");
  assert.ok(Number.isFinite(Number(normalized.structuredMeta.freshness.relativeDays)));
  assert.ok(normalized.metadataQualityScore >= 60);
});
