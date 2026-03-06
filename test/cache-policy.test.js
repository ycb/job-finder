import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  getDefaultCacheTtlHours,
  getFreshCachedJobs,
  isSourceCaptureFresh,
  writeSourceCapturePayload
} from "../src/sources/cache-policy.js";

test("getDefaultCacheTtlHours uses shorter default for HTTP sources", () => {
  assert.equal(getDefaultCacheTtlHours("builtin_search"), 12);
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
    capturePath,
    cacheTtlHours: 12
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
    capturePath,
    cacheTtlHours: 24
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

