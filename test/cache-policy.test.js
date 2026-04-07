import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  getDefaultCacheTtlHours,
  getFreshCachedJobs,
  isSourceCaptureFresh,
  readSourceCaptureSummary,
  sanitizeExpectedCount,
  writeSourceCapturePayload
} from "../src/sources/cache-policy.js";

test("getDefaultCacheTtlHours uses shorter default for HTTP sources", () => {
  assert.equal(getDefaultCacheTtlHours("builtin_search"), 12);
  assert.equal(getDefaultCacheTtlHours("yc_jobs"), 12);
  assert.equal(getDefaultCacheTtlHours("levelsfyi_search"), 12);
  assert.equal(getDefaultCacheTtlHours("linkedin_capture_file"), 24);
});

test("isSourceCaptureFresh returns true for fresh capture payload", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-cache-policy-"));
  const capturePath = path.join(tempDir, "capture.json");
  const nowIso = new Date().toISOString();

  const source = {
    id: "builtin-sf-ai-pm",
    name: "Built In SF",
    type: "builtin_search",
    searchUrl: "https://www.builtinsf.com/jobs/product-management?search=AI",
    capturePath
  };

  try {
    writeSourceCapturePayload(source, [{ title: "PM AI" }], {
      capturedAt: nowIso,
      pageUrl: source.searchUrl
    });

    assert.equal(isSourceCaptureFresh(source), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("getFreshCachedJobs returns null for stale capture payload", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-cache-policy-"));
  const capturePath = path.join(tempDir, "capture.json");
  const staleIso = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();

  const source = {
    id: "wf-ai",
    name: "Wellfound AI",
    type: "wellfound_search",
    searchUrl: "https://wellfound.com/jobs",
    capturePath
  };

  try {
    writeSourceCapturePayload(source, [{ title: "Stale Job" }], {
      capturedAt: staleIso,
      pageUrl: source.searchUrl
    });

    const cached = getFreshCachedJobs(source);
    assert.equal(cached, null);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("sanitizeExpectedCount preserves plausible expected counts", () => {
  assert.equal(
    sanitizeExpectedCount({ type: "linkedin_capture_file" }, 33, 19),
    33
  );
  assert.equal(
    sanitizeExpectedCount({ type: "builtin_search" }, 5000, 25),
    5000
  );
});

test("sanitizeExpectedCount rejects absurd or inconsistent denominators", () => {
  assert.equal(
    sanitizeExpectedCount({ type: "indeed_search" }, 200000, 41),
    null
  );
  assert.equal(
    sanitizeExpectedCount({ type: "builtin_search" }, 5, 25),
    null
  );
  assert.equal(
    sanitizeExpectedCount({ type: "google_search" }, 250000, 10),
    null
  );
});

test("readSourceCaptureSummary nulls corrupt expected counts from capture files", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-cache-policy-"));
  const capturePath = path.join(tempDir, "capture.json");
  const source = {
    id: "indeed-ai-pm",
    name: "Indeed",
    type: "indeed_search",
    searchUrl: "https://www.indeed.com/jobs?q=Product+manager",
    capturePath
  };

  try {
    fs.writeFileSync(
      capturePath,
      `${JSON.stringify(
        {
          sourceId: source.id,
          sourceName: source.name,
          capturedAt: new Date().toISOString(),
          expectedCount: 200000,
          jobs: Array.from({ length: 41 }, (_, index) => ({ title: `Job ${index + 1}` })),
          captureFunnel: {
            availableCount: 200000,
            capturedRawCount: 41
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const summary = readSourceCaptureSummary(source);
    assert.equal(summary.expectedCount, null);
    assert.equal(summary.payload.expectedCount, null);
    assert.equal(summary.payload.captureFunnel.availableCount, null);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("writeSourceCapturePayload suppresses bogus Indeed expected counts end-to-end", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-cache-policy-"));
  const capturePath = path.join(tempDir, "capture.json");
  const source = {
    id: "indeed-ai-pm",
    name: "Indeed",
    type: "indeed_search",
    searchUrl: "https://www.indeed.com/jobs?q=Product+manager",
    capturePath
  };
  const jobs = Array.from({ length: 21 }, (_, index) => ({ title: `Job ${index + 1}` }));

  try {
    writeSourceCapturePayload(source, jobs, {
      expectedCount: 200000,
      captureFunnel: {
        availableCount: 200000,
        capturedRawCount: 21
      }
    });

    const summary = readSourceCaptureSummary(source);
    assert.equal(summary.expectedCount, null);
    assert.equal(summary.payload.expectedCount, null);
    assert.equal(summary.payload.captureFunnel.availableCount, null);
    assert.equal(summary.payload.captureFunnel.capturedRawCount, 21);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
