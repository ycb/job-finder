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

test("indeed normalization does not treat salary pages with fromjk as jobs", () => {
  const source = {
    id: "indeed-main",
    type: "indeed_search",
    searchUrl: "https://www.indeed.com/jobs?q=product+manager"
  };

  const normalized = normalizeJobRecord(
    {
      title: "Principal Product Manager salaries in San Francisco, CA",
      company: "Unknown company",
      location: "San Francisco, CA",
      description: "Salary Search page",
      url: "https://www.indeed.com/career/principal-product-manager/salaries/San-Francisco--CA?campaignid=serp-more&fromjk=abc12345def67890&from=serp-more"
    },
    source
  );

  assert.equal(normalized.externalId, null);
  assert.equal(
    normalized.sourceUrl,
    "https://www.indeed.com/career/principal-product-manager/salaries/San-Francisco--CA"
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

test("levelsfyi normalization preserves per-job identity via jobId query parameter", () => {
  const source = {
    id: "levelsfyi-ai-pm",
    type: "levelsfyi_search",
    searchUrl: "https://www.levels.fyi/jobs/title/product-manager/location/san-francisco-usa"
  };

  const normalized = normalizeJobRecord(
    {
      title: "Staff Product Manager, Applied AI",
      company: "Plaid",
      location: "San Francisco, CA",
      description: "Role details",
      externalId: "143429004190196422",
      url: "https://www.levels.fyi/jobs?jobId=143429004190196422"
    },
    source
  );

  assert.equal(normalized.externalId, "143429004190196422");
  assert.equal(
    normalized.sourceUrl,
    "https://www.levels.fyi/jobs?jobId=143429004190196422"
  );
});

test("yc normalization preserves job-level identity via job page url", () => {
  const source = {
    id: "yc-product-jobs",
    type: "yc_jobs",
    searchUrl: "https://www.workatastartup.com/jobs/l/product-manager"
  };

  const normalized = normalizeJobRecord(
    {
      title: "Founding Product Manager",
      company: "Metriport",
      location: "San Francisco, CA",
      description: "Role details",
      externalId: "101",
      url: "https://www.workatastartup.com/jobs/101"
    },
    source
  );

  assert.equal(normalized.externalId, "101");
  assert.equal(
    normalized.sourceUrl,
    "https://www.workatastartup.com/jobs/101"
  );
});
