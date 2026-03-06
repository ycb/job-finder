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

    assert.equal(meta.statusLabel, "cooldown");
    assert.equal(meta.statusReason, "cooldown");
    assert.equal(meta.servedFrom, "cache");
    assert.equal(meta.cooldownUntil, "2026-03-06T13:00:00.000Z");
    assert.equal(meta.nextEligibleAt, "2026-03-06T13:00:00.000Z");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
