import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ANALYTICS_CHANNELS,
  ANALYTICS_EVENT_REGISTRY,
  ANALYTICS_SCHEMA_VERSION,
  buildAnalyticsEvent,
  createAnalyticsEnvelope,
  recordAnalyticsEvent
} from "../src/analytics/events.js";

function createTempEventsPath() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-analytics-"));
  return {
    tempDir,
    eventsPath: path.join(tempDir, "analytics-events.json")
  };
}

function readQueuedCount(eventsPath) {
  const payload = JSON.parse(fs.readFileSync(eventsPath, "utf8"));
  return Array.isArray(payload.queued) ? payload.queued.length : 0;
}

test("createAnalyticsEnvelope includes channel and identity metadata", () => {
  const envelope = createAnalyticsEnvelope(
    "jobs_synced",
    {
      total_collected: 12
    },
    {
      channel: "codex",
      identityMode: "machine_hash",
      distinctId: "machine:abc123",
      occurredAt: "2026-03-08T00:00:00.000Z"
    }
  );

  assert.equal(envelope.schemaVersion, ANALYTICS_SCHEMA_VERSION);
  assert.equal(envelope.channel, "codex");
  assert.equal(envelope.identityMode, "machine_hash");
  assert.equal(envelope.distinctId, "machine:abc123");
  assert.equal(envelope.event, "jobs_synced");
  assert.equal(envelope.posthog.event, ANALYTICS_EVENT_REGISTRY.jobs_synced.posthogEvent);
  assert.equal(envelope.posthog.properties.channel, "codex");
  assert.equal(envelope.posthog.properties.identity_mode, "machine_hash");
  assert.equal(envelope.posthog.properties.schema_version, ANALYTICS_SCHEMA_VERSION);
});

test("analytics registry includes required channels and events", () => {
  assert.deepEqual(
    Array.from(ANALYTICS_CHANNELS).sort(),
    ["claude", "codex", "dashboard", "terminal"]
  );
  for (const eventName of [
    "pipeline_run_completed",
    "jobs_synced",
    "jobs_scored",
    "shortlist_generated",
    "source_added",
    "source_captured_live",
    "capture_quality_rejected",
    "job_status_changed",
    "sync_score_completed",
    "source_run_completed",
    "search_criteria_updated",
    "profile_source_changed"
  ]) {
    assert.equal(typeof ANALYTICS_EVENT_REGISTRY[eventName]?.posthogEvent, "string");
  }
});

test("createAnalyticsEnvelope rejects unknown events", () => {
  assert.throws(() =>
    createAnalyticsEnvelope("unknown_event", {}, {
      channel: "terminal",
      identityMode: "machine_hash",
      distinctId: "machine:test"
    })
  );
});

test("buildAnalyticsEvent creates expected envelope", () => {
  const event = buildAnalyticsEvent(
    "onboarding_completed",
    { selectedSourceCount: 4 },
    {
      installId: "install-123",
      channel: "codex",
      appVersion: "0.2.0",
      platform: "darwin"
    }
  );

  assert.equal(event.installId, "install-123");
  assert.equal(event.eventName, "onboarding_completed");
  assert.equal(event.channel, "codex");
  assert.equal(event.appVersion, "0.2.0");
  assert.equal(event.platform, "darwin");
  assert.deepEqual(event.properties, { selectedSourceCount: 4 });
  assert.equal(typeof event.timestamp, "string");
});

test("recordAnalyticsEvent writes local queue when enabled", async () => {
  const { tempDir, eventsPath } = createTempEventsPath();
  try {
    const event = buildAnalyticsEvent("doctor_run", { sourceCount: 6 }, { installId: "a1" });
    const result = await recordAnalyticsEvent(event, {
      eventsPath,
      analyticsEnabled: true,
      env: {
        JOB_FINDER_ENABLE_ANALYTICS: "1"
      }
    });

    assert.equal(result.queued, true);
    assert.equal(result.flushed, false);
    assert.equal(readQueuedCount(eventsPath), 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("recordAnalyticsEvent skips queue when analytics disabled", async () => {
  const { tempDir, eventsPath } = createTempEventsPath();
  try {
    const event = buildAnalyticsEvent("doctor_run", {}, { installId: "a1" });
    const result = await recordAnalyticsEvent(event, {
      eventsPath,
      analyticsEnabled: false,
      env: {
        JOB_FINDER_ENABLE_ANALYTICS: "1"
      }
    });

    assert.equal(result.queued, false);
    assert.equal(result.flushed, false);
    assert.equal(fs.existsSync(eventsPath), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
