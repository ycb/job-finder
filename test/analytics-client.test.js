import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createAnalyticsClient, readAnalyticsCounters } from "../src/analytics/client.js";

function createTempTelemetryPaths() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-analytics-"));
  return {
    tempDir,
    eventsPath: path.join(tempDir, "events.jsonl"),
    countersPath: path.join(tempDir, "counters.json")
  };
}

test("analytics client persists counters and event envelopes", async () => {
  const { tempDir, eventsPath, countersPath } = createTempTelemetryPaths();

  try {
    const client = createAnalyticsClient({
      channel: "terminal",
      distinctId: "machine:test",
      eventsPath,
      countersPath,
      posthogApiKey: ""
    });

    await client.track("jobs_synced", { total_collected: 3, total_upserted: 2 });
    await client.track("jobs_synced", { total_collected: 5, total_upserted: 4 });
    await client.track("source_added", { source_type: "indeed_search" });

    const counters = readAnalyticsCounters(countersPath);
    assert.equal(counters.totals.events, 3);
    assert.equal(counters.byEvent.jobs_synced, 2);
    assert.equal(counters.byEvent.source_added, 1);
    assert.equal(counters.byChannel.terminal, 3);

    const lines = fs
      .readFileSync(eventsPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    assert.equal(lines.length, 3);
    assert.equal(lines[0].channel, "terminal");
    assert.equal(lines[0].identityMode, "machine_hash");
    assert.equal(lines[0].event, "jobs_synced");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("analytics client maps canonical events to PostHog capture payload", async () => {
  const { tempDir, eventsPath, countersPath } = createTempTelemetryPaths();
  const requests = [];

  try {
    const client = createAnalyticsClient({
      channel: "dashboard",
      distinctId: "machine:test",
      eventsPath,
      countersPath,
      posthogApiKey: "phc_test",
      posthogHost: "https://example.posthog.local",
      fetchImpl: async (url, options) => {
        requests.push({
          url: String(url),
          options
        });
        return {
          ok: true,
          status: 200,
          text: async () => ""
        };
      }
    });

    await client.track("sync_score_completed", {
      collected: 10,
      evaluated: 9
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://example.posthog.local/capture/");
    const payload = JSON.parse(String(requests[0].options.body || "{}"));
    assert.equal(payload.event, "jf_sync_score_completed");
    assert.equal(payload.distinct_id, "machine:test");
    assert.equal(payload.properties.channel, "dashboard");
    assert.equal(payload.properties.identity_mode, "machine_hash");
    assert.equal(payload.properties.collected, 10);
    assert.equal(payload.properties.evaluated, 9);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
