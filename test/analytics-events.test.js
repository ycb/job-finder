import test from "node:test";
import assert from "node:assert/strict";

import {
  ANALYTICS_CHANNELS,
  ANALYTICS_EVENT_REGISTRY,
  ANALYTICS_SCHEMA_VERSION,
  createAnalyticsEnvelope
} from "../src/analytics/events.js";

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
