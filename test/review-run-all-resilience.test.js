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

test("runAllCapturesWithOptions forces live browser capture in source QA mode", async () => {
  const originalQaMode = process.env.JOB_FINDER_SOURCE_QA_MODE;
  process.env.JOB_FINDER_SOURCE_QA_MODE = "1";

  const decisionCalls = [];
  const captureCalls = [];

  try {
    const result = await reviewServer.runAllCapturesWithOptions(
      {},
      {
        loadSourcesFn: () => ({
          sources: [
            {
              id: "zip-ai-pm",
              name: "ZipRecruiter",
              type: "browser_zip",
              enabled: true
            }
          ]
        }),
        isBrowserCaptureSourceFn: () => true,
        sourceWithCadenceCacheTtlFn: (source) => source,
        getSourceRefreshDecisionFn: (_source, options) => {
          decisionCalls.push(options);
          return {
            allowLive: options.forceRefresh === true && options.profile === "probe",
            reason: options.forceRefresh === true ? "force_refresh" : "cache_fresh",
            cacheSummary: { jobCount: 9 }
          };
        },
        ensureBridgeFn: async () => {},
        captureSourceFn: async (source) => {
          captureCalls.push(source.id);
          return {
            provider: "bridge",
            status: "completed",
            capturedAt: "2026-03-30T22:00:00.000Z"
          };
        },
        runSyncAndScoreFn: () => ({ collected: 1 }),
        recordRefreshEventFn: () => {},
        classifyRefreshErrorOutcomeFn: () => "transient_error",
        buildSourceSnapshotPathFn: () => "/tmp/zip.json"
      }
    );

    assert.equal(captureCalls.length, 1);
    assert.equal(result.captures[0].provider, "bridge");
    assert.equal(result.captures[0].cached, undefined);
    assert.ok(decisionCalls.every((call) => call.forceRefresh === true));
    assert.ok(decisionCalls.every((call) => call.profile === "probe"));
  } finally {
    if (originalQaMode === undefined) {
      delete process.env.JOB_FINDER_SOURCE_QA_MODE;
    } else {
      process.env.JOB_FINDER_SOURCE_QA_MODE = originalQaMode;
    }
  }
});
