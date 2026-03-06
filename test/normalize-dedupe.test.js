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

test("indeed normalization keeps job-level identity via jk query parameter", () => {
  const source = {
    id: "indeed-main",
    type: "indeed_search",
    searchUrl: "https://www.indeed.com/jobs?q=product+manager"
  };

  const normalized = normalizeJobRecord(
    {
      title: "Senior Product Manager",
      company: "Example Co",
      location: "San Francisco, CA",
      description: "Role details",
      url: "https://www.indeed.com/rc/clk?jk=abc12345def67890&bb=tracking&vjs=3"
    },
    source
  );

  assert.equal(normalized.externalId, "abc12345def67890");
  assert.equal(
    normalized.sourceUrl,
    "https://www.indeed.com/viewjob?jk=abc12345def67890"
  );
});

test("google jobs-search normalization preserves per-job docid identity from hash", () => {
  const source = {
    id: "google-main",
    type: "google_search",
    searchUrl: "https://www.google.com/search?q=product+manager+ai&udm=8"
  };

  const normalized = normalizeJobRecord(
    {
      title: "Principal Product Manager, AI",
      company: "Example Co",
      location: "San Francisco, CA",
      description: "Role details",
      url: "https://www.google.com/search?q=product+manager+ai&udm=8#vhid=vt%3D20/docid%3Ddoc-abc123%3D%3D&vssid=jobs-detail-viewer"
    },
    source
  );

  assert.equal(normalized.externalId, "doc-abc123==");
  assert.equal(
    normalized.sourceUrl,
    "https://www.google.com/search?docid=doc-abc123%3D%3D"
  );
});
