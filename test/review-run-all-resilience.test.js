import test from "node:test";
import assert from "node:assert/strict";

import * as reviewServer from "../src/review/server.js";

test("run-all request handler executes capture without separate auth preflight", async () => {
  assert.equal(typeof reviewServer.handleRunAllSourcesRequest, "function");

  const preflightCalls = [];
  const captureCalls = [];

  const result = await reviewServer.handleRunAllSourcesRequest(
    {},
    {
      applySourceQaOverridesFn: (options) => options,
      runAuthPreflightForEnabledSourcesFn: async () => {
        preflightCalls.push("called");
        return [{ sourceId: "linkedin-live-capture" }];
      },
      runAllCapturesWithOptionsFn: async (options) => {
        captureCalls.push(options);
        return { captures: [], sync: { collected: 0 } };
      }
    }
  );

  assert.deepEqual(preflightCalls, []);
  assert.deepEqual(captureCalls, [{ forceRefresh: false }]);
  assert.deepEqual(result, { ok: true, captures: [], sync: { collected: 0 } });
});

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
      runSyncAndScoreFn: (options) => {
        syncCalls.push(options);
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
  assert.deepEqual(syncCalls, [{ sourceIds: ["source-a", "source-c"] }]);
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

test("runAllCapturesWithOptions always captures browser sources live (no cache gate)", async () => {
  const bridgeCalls = [];
  const syncCalls = [];

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
          },
          {
            id: "builtin-sf-ai-pm",
            name: "Built In",
            type: "builtin_search",
            enabled: true
          }
        ]
      }),
      isBrowserCaptureSourceFn: (source) => source.type.startsWith("browser"),
      ensureBridgeFn: async (liveSources) => {
        bridgeCalls.push(liveSources.map((s) => s.id));
      },
      captureSourceFn: async (source) => ({
        provider: "bridge",
        status: "completed",
        capturedAt: "2026-03-30T22:00:00.000Z",
        jobsImported: 9
      }),
      runSyncAndScoreFn: (options) => {
        syncCalls.push(options);
        return { collected: 1 };
      },
      recordRefreshEventFn: () => {},
      classifyRefreshErrorOutcomeFn: () => "transient_error",
      buildSourceSnapshotPathFn: () => "/tmp/zip.json"
    }
  );

  assert.deepEqual(bridgeCalls, [["zip-ai-pm"]]);
  assert.deepEqual(
    result.captures.map((capture) => ({
      sourceId: capture.sourceId,
      provider: capture.provider,
      status: capture.status
    })),
    [
      {
        sourceId: "zip-ai-pm",
        provider: "bridge",
        status: "completed"
      },
      {
        sourceId: "builtin-sf-ai-pm",
        provider: "source_fetch",
        status: "completed"
      }
    ]
  );
  assert.deepEqual(syncCalls, [{ sourceIds: ["zip-ai-pm", "builtin-sf-ai-pm"] }]);
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
