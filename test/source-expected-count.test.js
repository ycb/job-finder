import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readSourceCaptureSummary, writeSourceCapturePayload } from "../src/sources/cache-policy.js";
import {
  parseIndeedExpectedCountText,
  writeIndeedCaptureFile
} from "../src/sources/indeed-jobs.js";
import { writeZipRecruiterCaptureFile } from "../src/sources/ziprecruiter-jobs.js";

function createTempCapturePath(prefix) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    tempDir,
    capturePath: path.join(tempDir, "capture.json")
  };
}

test("parseIndeedExpectedCountText parses narrow page-count headers", () => {
  assert.equal(parseIndeedExpectedCountText("Page 1 of 41 jobs"), 41);
  assert.equal(parseIndeedExpectedCountText("Showing 1-10 of 412 jobs"), 412);
});

test("parseIndeedExpectedCountText rejects broad marketing copy and salary noise", () => {
  assert.equal(parseIndeedExpectedCountText("Search 200,000 jobs available"), null);
  assert.equal(
    parseIndeedExpectedCountText("$200,000 a year Senior Product Manager jobs"),
    null
  );
});

test("writeIndeedCaptureFile preserves plausible expectedCount in capture payload", () => {
  const { tempDir, capturePath } = createTempCapturePath("job-finder-indeed-expected-");
  const source = {
    id: "indeed-ai",
    name: "Indeed AI",
    type: "indeed_search",
    searchUrl: "https://www.indeed.com/jobs?q=ai+product+manager",
    capturePath
  };

  try {
    const writeResult = writeIndeedCaptureFile(source, [{ title: "PM" }], {
      expectedCount: 412,
      pageUrl: source.searchUrl
    });

    const summary = readSourceCaptureSummary(source);
    assert.equal(summary.status, "ready");
    assert.equal(summary.expectedCount, 412);
    assert.equal(writeResult.expectedCount, 412);
    assert.equal(summary.payload?.expectedCount, 412);
    assert.equal(summary.payload?.captureFunnel?.availableCount, 412);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("writeZipRecruiterCaptureFile persists expectedCount in capture payload", () => {
  const { tempDir, capturePath } = createTempCapturePath("job-finder-zip-expected-");
  const source = {
    id: "zip-ai",
    name: "Zip AI",
    type: "ziprecruiter_search",
    searchUrl: "https://www.ziprecruiter.com/jobs-search?search=ai+product+manager",
    capturePath
  };

  try {
    writeZipRecruiterCaptureFile(source, [{ title: "PM" }], {
      expectedCount: 205,
      pageUrl: source.searchUrl
    });

    const summary = readSourceCaptureSummary(source);
    assert.equal(summary.status, "ready");
    assert.equal(summary.expectedCount, 205);
    assert.equal(summary.payload?.expectedCount, 205);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("writeSourceCapturePayload persists baseline capture funnel metadata", () => {
  const { tempDir, capturePath } = createTempCapturePath("job-finder-funnel-meta-");
  const source = {
    id: "builtin-ai",
    name: "Built In AI",
    type: "builtin_search",
    searchUrl: "https://www.builtinsf.com/jobs?search=ai",
    capturePath
  };

  try {
    writeSourceCapturePayload(source, [{ title: "PM 1" }, { title: "PM 2" }], {
      expectedCount: 88,
      pageUrl: source.searchUrl
    });

    const summary = readSourceCaptureSummary(source);
    assert.deepEqual(summary.payload?.captureFunnel, {
      availableCount: 88,
      capturedRawCount: 2,
      postHardFilterCount: null,
      postDedupeCount: null,
      importedCount: null
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("writeSourceCapturePayload persists capture telemetry", () => {
  const { tempDir, capturePath } = createTempCapturePath("job-finder-capture-telemetry-");
  const source = {
    id: "builtin-ai",
    name: "Built In AI",
    type: "builtin_search",
    searchUrl: "https://www.builtinsf.com/jobs?search=ai",
    capturePath
  };

  try {
    writeSourceCapturePayload(source, [{ title: "PM 1" }], {
      pageUrl: source.searchUrl,
      captureTelemetry: {
        sourceId: source.id,
        status: "live_success",
        initialUrl: source.searchUrl,
        visitedUrls: [source.searchUrl],
        finalUrl: source.searchUrl,
        stopReason: "completed"
      }
    });

    const summary = readSourceCaptureSummary(source);
    assert.deepEqual(summary.payload?.captureTelemetry, {
      sourceId: source.id,
      status: "live_success",
      initialUrl: source.searchUrl,
      visitedUrls: [source.searchUrl],
      finalUrl: source.searchUrl,
      stopReason: "completed"
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("readSourceCaptureSummary sanitizes implausible persisted expected counts", () => {
  const { tempDir, capturePath } = createTempCapturePath("job-finder-sanitize-expected-");
  const source = {
    id: "indeed-ai",
    name: "Indeed AI",
    type: "indeed_search",
    searchUrl: "https://www.indeed.com/jobs?q=ai+product+manager",
    capturePath
  };

  try {
    fs.writeFileSync(
      capturePath,
      JSON.stringify(
        {
          sourceId: source.id,
          sourceName: source.name,
          searchUrl: source.searchUrl,
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
      ),
      "utf8"
    );

    const summary = readSourceCaptureSummary(source);
    assert.equal(summary.expectedCount, null);
    assert.equal(summary.payload?.expectedCount, null);
    assert.equal(summary.payload?.captureFunnel?.availableCount, null);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
