import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { writeSourceCapturePayload } from "../src/sources/cache-policy.js";
import { recordRefreshEvent } from "../src/sources/refresh-state.js";
import { buildSourceRefreshMeta } from "../src/review/server.js";

function createTempPaths() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-dashboard-refresh-"));
  return {
    tempDir,
    capturePath: path.join(tempDir, "capture.json"),
    statePath: path.join(tempDir, "refresh-state.json")
  };
}

test("buildSourceRefreshMeta returns direct_fetch status for non-browser sources", () => {
  const meta = buildSourceRefreshMeta({
    id: "builtin-ai",
    type: "builtin_search"
  });

  assert.equal(meta.refreshMode, "safe");
  assert.equal(meta.statusLabel, "direct_fetch");
  assert.equal(meta.statusReason, "fetched_during_sync");
  assert.equal(meta.servedFrom, "live");
});

test("buildSourceRefreshMeta reports cache_fresh for fresh browser capture", () => {
  const { tempDir, capturePath, statePath } = createTempPaths();
  const source = {
    id: "google-ai",
    name: "Google AI",
    type: "google_search",
    searchUrl: "https://www.google.com/search?q=ai+product+manager",
    capturePath,
    cacheTtlHours: 12
  };
  const nowIso = "2026-03-06T18:00:00.000Z";

  try {
    writeSourceCapturePayload(source, [{ title: "PM" }], {
      capturedAt: nowIso,
      pageUrl: source.searchUrl
    });

    const meta = buildSourceRefreshMeta(source, {
      refreshProfile: "safe",
      refreshStatePath: statePath,
      nowMs: Date.parse(nowIso)
    });

    assert.equal(meta.statusLabel, "cache_fresh");
    assert.equal(meta.statusReason, "cache_fresh");
    assert.equal(meta.servedFrom, "cache");
    assert.equal(meta.nextEligibleAt, null);
    assert.equal(meta.lastLiveAt, null);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("buildSourceRefreshMeta reports cooldown with next eligible time", () => {
  const { tempDir, capturePath, statePath } = createTempPaths();
  const source = {
    id: "google-ai",
    name: "Google AI",
    type: "google_search",
    searchUrl: "https://www.google.com/search?q=ai+product+manager",
    capturePath,
    cacheTtlHours: 12
  };

  try {
    writeSourceCapturePayload(source, [{ title: "PM" }], {
      capturedAt: "2026-03-05T00:00:00.000Z",
      pageUrl: source.searchUrl
    });
    recordRefreshEvent({
      statePath,
      sourceId: source.id,
      outcome: "challenge",
      at: "2026-03-06T10:00:00.000Z",
      cooldownMinutes: 180
    });

    const meta = buildSourceRefreshMeta(source, {
      refreshProfile: "safe",
      refreshStatePath: statePath,
      nowMs: Date.parse("2026-03-06T11:00:00.000Z")
    });

    assert.equal(meta.statusLabel, "challenge");
    assert.equal(meta.statusReason, "challenge");
    assert.equal(meta.servedFrom, "cache");
    assert.equal(meta.cooldownUntil, "2026-03-06T13:00:00.000Z");
    assert.equal(meta.nextEligibleAt, "2026-03-06T13:00:00.000Z");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("buildSourceRefreshMeta reports the latest challenge attempt as challenge", () => {
  const { tempDir, capturePath, statePath } = createTempPaths();
  const source = {
    id: "linkedin-live-capture",
    name: "LinkedIn",
    type: "linkedin_capture_file",
    searchUrl: "https://www.linkedin.com/jobs/search/?keywords=product%20manager",
    capturePath,
    cacheTtlHours: 12
  };

  try {
    writeSourceCapturePayload(source, [{ title: "PM" }], {
      capturedAt: "2026-03-19T23:07:10.146Z",
      pageUrl: source.searchUrl
    });
    recordRefreshEvent({
      statePath,
      sourceId: source.id,
      outcome: "challenge",
      at: "2026-03-20T21:47:39.202Z",
      error: "additional verification needed",
      cooldownMinutes: 180
    });

    const meta = buildSourceRefreshMeta(source, {
      refreshProfile: "safe",
      refreshStatePath: statePath,
      nowMs: Date.parse("2026-03-20T22:00:00.000Z")
    });

    assert.equal(meta.statusLabel, "challenge");
    assert.equal(meta.statusReason, "challenge");
    assert.equal(meta.lastAttemptOutcome, "challenge");
    assert.equal(meta.lastAttemptError, "additional verification needed");
    assert.equal(meta.lastAttemptedAt, "2026-03-20T21:47:39.202Z");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("buildSourceRefreshMeta reports a later transient error over an older success", () => {
  const { tempDir, capturePath, statePath } = createTempPaths();
  const source = {
    id: "indeed-ai-pm",
    name: "Indeed",
    type: "indeed_search",
    searchUrl: "https://www.indeed.com/jobs?q=product+manager",
    capturePath,
    cacheTtlHours: 12
  };

  try {
    writeSourceCapturePayload(source, [{ title: "PM" }], {
      capturedAt: "2026-03-19T23:09:31.558Z",
      pageUrl: source.searchUrl
    });
    recordRefreshEvent({
      statePath,
      sourceId: source.id,
      outcome: "success",
      at: "2026-03-19T23:09:31.558Z"
    });
    recordRefreshEvent({
      statePath,
      sourceId: source.id,
      outcome: "transient_error",
      at: "2026-03-20T21:49:58.598Z",
      error: "Cloudflare: additional verification needed"
    });

    const meta = buildSourceRefreshMeta(source, {
      refreshProfile: "safe",
      refreshStatePath: statePath,
      nowMs: Date.parse("2026-03-20T22:00:00.000Z")
    });

    assert.equal(meta.lastLiveAt, "2026-03-19T23:09:31.558Z");
    assert.equal(meta.lastAttemptedAt, "2026-03-20T21:49:58.598Z");
    assert.equal(meta.lastAttemptOutcome, "transient_error");
    assert.equal(meta.lastAttemptError, "Cloudflare: additional verification needed");
    assert.equal(meta.statusLabel, "attempt_failed");
    assert.equal(meta.statusReason, "attempt_failed");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("buildSourceRefreshMeta preserves live status for the current run capture", () => {
  const { tempDir, capturePath, statePath } = createTempPaths();
  const source = {
    id: "zip-ai-pm",
    name: "ZipRecruiter",
    type: "ziprecruiter_search",
    searchUrl: "https://www.ziprecruiter.com/jobs-search?search=product+manager",
    capturePath,
    cacheTtlHours: 12
  };

  try {
    const capturedAt = "2026-03-30T23:27:15.609Z";
    writeSourceCapturePayload(source, [{ title: "PM" }], {
      capturedAt,
      pageUrl: source.searchUrl
    });
    recordRefreshEvent({
      statePath,
      sourceId: source.id,
      outcome: "success",
      at: capturedAt
    });

    const meta = buildSourceRefreshMeta(source, {
      refreshProfile: "probe",
      refreshStatePath: statePath,
      nowMs: Date.parse("2026-03-30T23:27:18.655Z"),
      currentCapturedAt: capturedAt,
      recordedAt: "2026-03-30T23:27:18.655Z"
    });

    assert.equal(meta.servedFrom, "live");
    assert.equal(meta.statusLabel, "ready_live");
    assert.equal(meta.statusReason, "fetched_during_sync");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("renderDashboardPage includes run delta and refresh context status copy", async () => {
  const { renderDashboardPage } = await import("../src/review/server.js");
  const html = renderDashboardPage({});
  assert.equal(html.includes("run delta: new"), true);
  assert.equal(html.includes("refresh: "), true);
});
