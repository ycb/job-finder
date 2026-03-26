import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildLinkedInSearchUrl,
  computeImportedAverageScore,
  resolveReviewTarget
} from "../src/review/server.js";
import { loadSources } from "../src/config/load-config.js";
import { getSourceAggregationIds, listSourceLibraryDefinitions } from "../src/config/source-library.js";
import { buildSearchRows, presentSearchStatus } from "../src/review/web/src/features/searches/logic.js";

test("resolveReviewTarget keeps non-LinkedIn numeric external ids on their source URL", () => {
  const sourceById = new Map([
    ["builtin", { id: "builtin", type: "builtin_search" }]
  ]);

  const result = resolveReviewTarget(
    {
      sourceId: "builtin",
      source: "builtin_search",
      sourceUrl: "https://builtin.com/job/123",
      externalId: "123"
    },
    { sourceById }
  );

  assert.deepEqual(result, {
    url: "https://builtin.com/job/123",
    mode: "direct"
  });
});

test("resolveReviewTarget only synthesizes LinkedIn direct URLs for LinkedIn sources", () => {
  const sourceById = new Map([
    ["linkedin", { id: "linkedin", type: "linkedin_capture_file" }]
  ]);

  const result = resolveReviewTarget(
    {
      sourceId: "linkedin",
      source: "linkedin_capture_file",
      sourceUrl: "",
      externalId: "987654321",
      title: "Product Manager",
      company: "Example"
    },
    { sourceById }
  );

  assert.deepEqual(result, {
    url: "https://www.linkedin.com/jobs/view/987654321/",
    mode: "direct"
  });
});

test("resolveReviewTarget preserves direct LinkedIn job URLs with query params", () => {
  const sourceById = new Map([
    ["linkedin", { id: "linkedin", type: "linkedin_capture_file" }]
  ]);

  const result = resolveReviewTarget(
    {
      sourceId: "linkedin",
      source: "linkedin_capture_file",
      sourceUrl: "https://www.linkedin.com/jobs/view/987654321/?trackingId=abc123",
      externalId: "987654321"
    },
    { sourceById }
  );

  assert.deepEqual(result, {
    url: "https://www.linkedin.com/jobs/view/987654321/?trackingId=abc123",
    mode: "direct"
  });
});

test("resolveReviewTarget does not fabricate LinkedIn URLs for non-LinkedIn jobs with missing sourceUrl", () => {
  const sourceById = new Map([
    ["indeed", { id: "indeed", type: "indeed_search" }]
  ]);

  const result = resolveReviewTarget(
    {
      sourceId: "indeed",
      source: "indeed_search",
      sourceUrl: "",
      externalId: "12345",
      title: "Product Manager",
      company: "Example"
    },
    { sourceById }
  );

  assert.deepEqual(result, {
    url: null,
    mode: "unavailable"
  });
});

test("resolveReviewTarget falls back to LinkedIn search only for LinkedIn jobs without a direct URL", () => {
  const sourceById = new Map([
    ["linkedin", { id: "linkedin", type: "linkedin_capture_file" }]
  ]);
  const job = {
    sourceId: "linkedin",
    source: "linkedin_capture_file",
    sourceUrl: "",
    externalId: "",
    title: "Staff Product Manager",
    company: "Figma"
  };

  assert.deepEqual(resolveReviewTarget(job, { sourceById }), {
    url: buildLinkedInSearchUrl(job),
    mode: "search"
  });
});

test("computeImportedAverageScore only reports averages for currently imported hashes", () => {
  const scores = new Map([
    ["builtin::hash-a", 35],
    ["builtin::hash-b", 55]
  ]);

  assert.equal(computeImportedAverageScore("builtin", [], scores), null);
  assert.equal(computeImportedAverageScore("builtin", ["hash-a"], scores), 35);
  assert.equal(computeImportedAverageScore("builtin", ["hash-a", "hash-b"], scores), 45);
});

test("buildSearchRows preserves unknown expected counts instead of coercing them to zero", () => {
  const rows = buildSearchRows([
    {
      id: "builtin",
      name: "Built In",
      type: "builtin_search",
      searchUrl: "https://builtin.example",
      enabled: true,
      authRequired: false,
      captureExpectedCount: null,
      importedCount: 0
    },
    {
      id: "google",
      name: "Google",
      type: "google_search",
      searchUrl: "https://google.example",
      enabled: true,
      authRequired: false,
      captureExpectedCount: 0,
      importedCount: 0
    }
  ]);

  assert.equal(rows[0].hasUnknownExpectedCount, true);
  assert.equal(rows[0].expectedFoundCount, null);
  assert.equal(rows[1].hasUnknownExpectedCount, true);
  assert.equal(rows[1].expectedFoundCount, null);
});

test("buildSearchRows surfaces the latest attempt separately from the last success", () => {
  const rows = buildSearchRows([
    {
      id: "indeed-ai-pm",
      name: "Indeed",
      type: "indeed_search",
      searchUrl: "https://www.indeed.com/jobs?q=product+manager",
      enabled: true,
      authRequired: false,
      captureStatus: "ready",
      capturedAt: "2026-03-19T23:09:31.558Z",
      lastAttemptedAt: "2026-03-20T21:49:58.598Z",
      lastAttemptOutcome: "challenge",
      lastAttemptError: "additional verification needed",
      captureExpectedCount: 21,
      importedCount: 21
    }
  ]);

  const row = rows[0];
  assert.equal(row.capturedAt, "2026-03-20T21:49:58.598Z");
  assert.equal(row.lastSuccessfulAt, "2026-03-19T23:09:31.558Z");
  assert.equal(row.lastAttemptedAt, "2026-03-20T21:49:58.598Z");
  assert.equal(row.lastAttemptOutcome, "challenge");
  assert.equal(row.lastAttemptError, "additional verification needed");

  const status = presentSearchStatus(row);
  assert.equal(status.label, "challenge");
  assert.equal(status.tone, "warn");
  assert.equal(status.statusDetail.includes("Additional verification needed"), true);
});

test("source library preserves legacy aggregation ids for MVP source continuity", () => {
  const byId = new Map(listSourceLibraryDefinitions().map((source) => [source.id, source]));

  assert.deepEqual(getSourceAggregationIds(byId.get("linkedin-live-capture")), [
    "linkedin-live-capture",
    "linkedin-main",
    "growth-pm",
    "founding-pm",
    "ai-pm",
    "pm-remote-linkedin",
  ]);
  assert.deepEqual(getSourceAggregationIds(byId.get("builtin-sf-ai-pm")), [
    "builtin-sf-ai-pm",
    "builtin-main",
  ]);
  assert.deepEqual(getSourceAggregationIds(byId.get("indeed-ai-pm")), [
    "indeed-ai-pm",
    "indeed-main",
    "indeed-ai-pm-sf",
  ]);
  assert.deepEqual(getSourceAggregationIds(byId.get("zip-ai-pm")), [
    "zip-ai-pm",
    "ziprecruiter-main",
    "ziprecruiter-ai-pm-sf",
  ]);
});

test("loadSources preserves legacy aggregation ids for library-map MVP sources", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-sources-"));
  const sourcesPath = path.join(tempDir, "sources.json");
  fs.writeFileSync(
    sourcesPath,
    JSON.stringify({
      sources: {
        "linkedin-live-capture": true,
        "builtin-sf-ai-pm": true,
        "indeed-ai-pm": true,
        "zip-ai-pm": true,
        "yc-product-jobs": true,
        "levelsfyi-ai-pm": true
      }
    }),
    "utf8"
  );

  const { sources } = loadSources(sourcesPath);
  const byId = new Map(sources.map((source) => [source.id, source]));

  assert.deepEqual(getSourceAggregationIds(byId.get("linkedin-live-capture")), [
    "linkedin-live-capture",
    "linkedin-main",
    "growth-pm",
    "founding-pm",
    "ai-pm",
    "pm-remote-linkedin",
  ]);
  assert.deepEqual(getSourceAggregationIds(byId.get("builtin-sf-ai-pm")), [
    "builtin-sf-ai-pm",
    "builtin-main",
  ]);
});
