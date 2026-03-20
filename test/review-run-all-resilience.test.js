import test from "node:test";
import assert from "node:assert/strict";

import * as reviewServer from "../src/review/server.js";

test("runAllCapturesWithOptions continues after a browser source fails and still syncs completed sources", async () => {
  const bridgeCalls = [];
  const refreshEvents = [];
  const syncCalls = [];

  const sources = {
    sources: [
      {
        id: "source-a",
        name: "Source A",
        type: "browser_alpha",
        enabled: true
      },
      {
        id: "source-b",
        name: "Source B",
        type: "browser_beta",
        enabled: true
      },
      {
        id: "source-c",
        name: "Source C",
        type: "source_fetch",
        enabled: true
      }
    ]
  };

  const result = await reviewServer.runAllCapturesWithOptions(
    {},
    {
      loadSourcesFn: () => sources,
      isBrowserCaptureSourceFn: (source) => source.type.startsWith("browser"),
      sourceWithCadenceCacheTtlFn: (source) => source,
      getSourceRefreshDecisionFn: (source) =>
        source.id === "source-a"
          ? { allowLive: true }
          : { allowLive: true, policy: { cooldownMinutes: 180 } },
      ensureBridgeFn: async (liveSources) => {
        bridgeCalls.push(liveSources.map((source) => source.id));
      },
      captureSourceFn: async (source, snapshotPath) => {
        if (source.id === "source-b") {
          throw new Error("page not found");
        }

        return {
          provider: "bridge",
          status: "completed",
          capturedAt: `${source.id}-captured`,
          snapshotPath
        };
      },
      runSyncAndScoreFn: () => {
        syncCalls.push("sync");
        return { collected: 2 };
      },
      recordRefreshEventFn: (payload) => {
        refreshEvents.push(payload);
      },
      classifyRefreshErrorOutcomeFn: () => "transient_error",
      buildSourceSnapshotPathFn: (source) => `/tmp/${source.id}.json`
    }
  );

  assert.deepEqual(bridgeCalls, [["source-a", "source-b"]]);
  assert.deepEqual(
    result.captures.map((capture) => ({
      sourceId: capture.sourceId,
      status: capture.status,
      provider: capture.provider,
      error: capture.error || null
    })),
    [
      { sourceId: "source-a", status: "completed", provider: "bridge", error: null },
      { sourceId: "source-b", status: "failed", provider: "bridge", error: "page not found" },
      { sourceId: "source-c", status: "completed", provider: "source_fetch", error: null }
    ]
  );
  assert.deepEqual(syncCalls, ["sync"]);
  assert.equal(result.sync.collected, 2);
  assert.equal(refreshEvents.length, 2);
  assert.deepEqual(
    refreshEvents.map((event) => ({
      sourceId: event.sourceId,
      outcome: event.outcome
    })),
    [
      { sourceId: "source-a", outcome: "success" },
      { sourceId: "source-b", outcome: "transient_error" }
    ]
  );
});
