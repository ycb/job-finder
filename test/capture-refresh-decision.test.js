import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getSourceRefreshDecision, writeSourceCapturePayload } from "../src/sources/cache-policy.js";
import { recordRefreshEvent } from "../src/sources/refresh-state.js";

function createTempPaths() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-refresh-decision-"));
  return {
    tempDir,
    capturePath: path.join(tempDir, "capture.json"),
    statePath: path.join(tempDir, "refresh-state.json")
  };
}

function createGoogleSource(capturePath) {
  return {
    id: "google-ai-pm",
    name: "Google AI PM",
    type: "google_search",
    searchUrl: "https://www.google.com/search?q=ai+product+manager",
    capturePath
  };
}

test("decision ignores fresh capture and still allows live", () => {
  const { tempDir, capturePath, statePath } = createTempPaths();
  const source = createGoogleSource(capturePath);
  const nowIso = "2026-03-06T18:00:00.000Z";

  try {
    writeSourceCapturePayload(source, [{ title: "PM" }], {
      capturedAt: nowIso,
      pageUrl: source.searchUrl
    });

    const decision = getSourceRefreshDecision(source, {
      profile: "safe",
      statePath,
      nowMs: Date.parse(nowIso)
    });

    assert.equal(decision.servedFrom, "live");
    assert.equal(decision.allowLive, true);
    assert.equal(decision.reason, "eligible");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("decision allows live when cache is stale and policy is eligible", () => {
  const { tempDir, capturePath, statePath } = createTempPaths();
  const source = createGoogleSource(capturePath);
  const staleIso = "2026-03-05T00:00:00.000Z";
  const nowIso = "2026-03-06T18:00:00.000Z";

  try {
    writeSourceCapturePayload(source, [{ title: "PM" }], {
      capturedAt: staleIso,
      pageUrl: source.searchUrl
    });

    const decision = getSourceRefreshDecision(source, {
      profile: "safe",
      statePath,
      nowMs: Date.parse(nowIso)
    });

    assert.equal(decision.servedFrom, "live");
    assert.equal(decision.allowLive, true);
    assert.equal(decision.reason, "eligible");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("decision in mock profile no longer disables live refresh", () => {
  const { tempDir, capturePath, statePath } = createTempPaths();
  const source = createGoogleSource(capturePath);
  const staleIso = "2026-03-05T00:00:00.000Z";
  const nowIso = "2026-03-06T18:00:00.000Z";

  try {
    writeSourceCapturePayload(source, [{ title: "PM" }], {
      capturedAt: staleIso,
      pageUrl: source.searchUrl
    });

    const decision = getSourceRefreshDecision(source, {
      profile: "mock",
      statePath,
      nowMs: Date.parse(nowIso)
    });

    assert.equal(decision.servedFrom, "live");
    assert.equal(decision.allowLive, true);
    assert.equal(decision.reason, "eligible");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("probe profile still allows live and force refresh remains explicit", () => {
  const { tempDir, capturePath, statePath } = createTempPaths();
  const source = createGoogleSource(capturePath);
  const staleIso = "2026-03-05T00:00:00.000Z";
  const nowIso = "2026-03-06T18:00:00.000Z";

  try {
    writeSourceCapturePayload(source, [{ title: "PM" }], {
      capturedAt: staleIso,
      pageUrl: source.searchUrl
    });
    recordRefreshEvent({
      statePath,
      sourceId: source.id,
      outcome: "success",
      at: "2026-03-06T17:50:00.000Z"
    });

    const blocked = getSourceRefreshDecision(source, {
      profile: "probe",
      statePath,
      nowMs: Date.parse(nowIso)
    });
    assert.equal(blocked.servedFrom, "live");
    assert.equal(blocked.allowLive, true);
    assert.equal(blocked.reason, "eligible");

    const forced = getSourceRefreshDecision(source, {
      profile: "probe",
      forceRefresh: true,
      statePath,
      nowMs: Date.parse(nowIso)
    });
    assert.equal(forced.servedFrom, "live");
    assert.equal(forced.allowLive, true);
    assert.equal(forced.reason, "force_refresh");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
