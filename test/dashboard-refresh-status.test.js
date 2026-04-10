import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  getSourceRefreshDecision,
  writeSourceCapturePayload
} from "../src/sources/cache-policy.js";
import { recordRefreshEvent } from "../src/sources/refresh-state.js";
import {
  buildSourceRefreshMeta,
  recordBlockedAuthPreflightAttempt,
  resolveDashboardSourceRefreshMeta
} from "../src/review/server.js";

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

test("buildSourceRefreshMeta reports ready_live for fresh browser capture", () => {
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

    assert.equal(meta.statusLabel, "ready_live");
    assert.equal(meta.statusReason, "eligible");
    assert.equal(meta.servedFrom, "live");
    assert.equal(meta.nextEligibleAt, null);
    assert.equal(meta.lastLiveAt, null);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("buildSourceRefreshMeta treats Levels.fyi as browser capture when a live capture exists", () => {
  const { tempDir, capturePath, statePath } = createTempPaths();
  const source = {
    id: "levels-ai",
    name: "Levels.fyi",
    type: "levelsfyi_search",
    searchUrl: "https://www.levels.fyi/jobs?searchText=ai",
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

    assert.equal(meta.statusLabel, "ready_live");
    assert.equal(meta.statusReason, "eligible");
    assert.equal(meta.servedFrom, "live");
    assert.equal(meta.nextEligibleAt, null);
    assert.equal(meta.lastLiveAt, null);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("buildSourceRefreshMeta keeps challenge status visible even though live refresh remains enabled", () => {
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
    assert.equal(meta.servedFrom, "live");
    assert.equal(meta.cooldownUntil, "2026-03-06T13:00:00.000Z");
    assert.equal(meta.nextEligibleAt, null);
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

test("recordBlockedAuthPreflightAttempt persists auth-check failures into refresh state", () => {
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
    recordBlockedAuthPreflightAttempt(
      source,
      {
        status: "fail",
        reasonCode: "auth_check_failed",
        userMessage: "Auth check failed. Open source site, sign in, then retry.",
        technicalDetails: {
          error: "Chrome AppleScript timed out after 15000ms"
        }
      },
      {
        statePath,
        runMode: "manual",
        at: "2026-03-31T20:00:00.000Z"
      }
    );

    const meta = buildSourceRefreshMeta(source, {
      refreshProfile: "probe",
      refreshStatePath: statePath,
      nowMs: Date.parse("2026-03-31T20:00:10.000Z")
    });

    assert.equal(meta.lastAttemptOutcome, "transient_error");
    assert.equal(meta.lastAttemptError, "Chrome AppleScript timed out after 15000ms");
    assert.equal(meta.lastAttemptedAt, "2026-03-31T20:00:00.000Z");
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

test("getSourceRefreshDecision bypasses cooldown and cache in source QA mode", () => {
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
      capturedAt: "2026-03-30T10:00:00.000Z",
      pageUrl: source.searchUrl
    });
    recordRefreshEvent({
      statePath,
      sourceId: source.id,
      outcome: "challenge",
      at: "2026-03-30T11:00:00.000Z",
      cooldownMinutes: 180
    });

    const decision = getSourceRefreshDecision(source, {
      statePath,
      nowMs: Date.parse("2026-03-30T11:30:00.000Z"),
      env: { JOB_FINDER_SOURCE_QA_MODE: "1" }
    });

    assert.equal(decision.allowLive, true);
    assert.equal(decision.servedFrom, "live");
    assert.equal(decision.reason, "qa_live");
    assert.equal(decision.nextEligibleAt, null);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("resolveDashboardSourceRefreshMeta prefers latest live run status over stale cache state", () => {
  const refreshMeta = {
    refreshMode: "safe",
    servedFrom: "cache",
    statusReason: "cache_fresh",
    statusLabel: "cache_fresh",
    lastLiveAt: "2026-03-30T22:00:00.000Z",
    lastAttemptedAt: "2026-03-30T22:00:00.000Z",
    lastAttemptOutcome: "success",
    lastAttemptError: null,
    nextEligibleAt: null,
    cooldownUntil: null
  };
  const latestRunDelta = {
    servedFrom: "live",
    statusReason: "fetched_during_sync",
    statusLabel: "ready_live",
    capturedAt: "2026-03-30T23:36:34.427Z",
    recordedAt: "2026-03-30T23:37:47.270Z"
  };

  const resolved = resolveDashboardSourceRefreshMeta(refreshMeta, latestRunDelta);

  assert.equal(resolved.servedFrom, "live");
  assert.equal(resolved.statusReason, "fetched_during_sync");
  assert.equal(resolved.statusLabel, "ready_live");
  assert.equal(resolved.lastAttemptOutcome, "success");
  assert.equal(resolved.lastAttemptError, null);
  assert.equal(resolved.lastAttemptedAt, "2026-03-30T23:36:34.427Z");
});

test("resolveDashboardSourceRefreshMeta keeps later failed attempt status over older live run", () => {
  const refreshMeta = {
    refreshMode: "safe",
    servedFrom: "cache",
    statusReason: "challenge",
    statusLabel: "challenge",
    lastLiveAt: "2026-03-30T22:00:00.000Z",
    lastAttemptedAt: "2026-03-31T00:10:00.000Z",
    lastAttemptOutcome: "challenge",
    lastAttemptError: "verification required",
    nextEligibleAt: "2026-03-31T03:10:00.000Z",
    cooldownUntil: "2026-03-31T03:10:00.000Z"
  };
  const latestRunDelta = {
    servedFrom: "live",
    statusReason: "fetched_during_sync",
    statusLabel: "ready_live",
    capturedAt: "2026-03-30T23:36:34.427Z",
    recordedAt: "2026-03-30T23:37:47.270Z"
  };

  const resolved = resolveDashboardSourceRefreshMeta(refreshMeta, latestRunDelta);

  assert.equal(resolved.servedFrom, "cache");
  assert.equal(resolved.statusReason, "challenge");
  assert.equal(resolved.statusLabel, "challenge");
  assert.equal(resolved.lastAttemptOutcome, "challenge");
  assert.equal(resolved.lastAttemptError, "verification required");
});

test("renderDashboardPage includes run delta and refresh context status copy", async () => {
  const { renderDashboardPage } = await import("../src/review/server.js");
  const html = renderDashboardPage({});
  assert.equal(html.includes("run delta: new"), true);
  assert.equal(html.includes("refresh: "), true);
});
