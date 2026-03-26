import test from "node:test";
import assert from "node:assert/strict";

import {
  computeSourceNoveltyBySourceId,
  defaultNoveltyBaselineSourceIds,
} from "../src/jobs/source-novelty.js";

test("defaultNoveltyBaselineSourceIds uses LinkedIn and Indeed sources", () => {
  const baseline = defaultNoveltyBaselineSourceIds([
    { id: "builtin", type: "builtin_search" },
    { id: "linkedin", type: "linkedin_capture_file" },
    { id: "indeed", type: "indeed_search" },
    { id: "levels", type: "levelsfyi_search" },
  ]);

  assert.deepEqual(baseline, ["linkedin", "indeed"]);
});

test("computeSourceNoveltyBySourceId measures uniqueness against the LinkedIn + Indeed baseline", () => {
  const metrics = computeSourceNoveltyBySourceId({
    sources: [
      { id: "linkedin", type: "linkedin_capture_file", captureJobCount: 5, importedCount: 3, droppedByDedupeCount: 1 },
      { id: "indeed", type: "indeed_search", captureJobCount: 4, importedCount: 2, droppedByDedupeCount: 0 },
      { id: "levels", type: "levelsfyi_search", captureJobCount: 3, importedCount: 3, droppedByDedupeCount: 0 },
      { id: "yc", type: "yc_jobs", captureJobCount: 2, importedCount: 2, droppedByDedupeCount: 0 },
    ],
    importedJobs: [
      { sourceId: "linkedin", normalizedHash: "hash-a" },
      { sourceId: "linkedin", normalizedHash: "hash-b" },
      { sourceId: "linkedin", normalizedHash: "hash-c" },
      { sourceId: "indeed", normalizedHash: "hash-b" },
      { sourceId: "indeed", normalizedHash: "hash-d" },
      { sourceId: "levels", normalizedHash: "hash-b" },
      { sourceId: "levels", normalizedHash: "hash-e" },
      { sourceId: "levels", normalizedHash: "hash-f" },
      { sourceId: "yc", normalizedHash: "hash-a" },
      { sourceId: "yc", normalizedHash: "hash-d" },
    ],
  });

  assert.deepEqual(metrics.levels.baselineSourceIds, ["linkedin", "indeed"]);
  assert.equal(metrics.levels.rawFound, 3);
  assert.equal(metrics.levels.importedAfterFilters, 3);
  assert.equal(metrics.levels.dedupedOut, 0);
  assert.equal(metrics.levels.uniqueImportedVsBaseline, 2);
  assert.equal(metrics.levels.noveltyRate, 0.667);
  assert.equal(metrics.levels.overlap.linkedin.duplicateCount, 1);
  assert.equal(metrics.levels.overlap.linkedin.duplicateRate, 0.333);
  assert.equal(metrics.levels.overlap.indeed.duplicateCount, 1);
  assert.equal(metrics.levels.overlap.indeed.duplicateRate, 0.333);

  assert.equal(metrics.yc.uniqueImportedVsBaseline, 0);
  assert.equal(metrics.yc.noveltyRate, 0);
  assert.equal(metrics.yc.overlap.linkedin.duplicateCount, 1);
  assert.equal(metrics.yc.overlap.indeed.duplicateCount, 1);
});

test("computeSourceNoveltyBySourceId tolerates sources with no imported jobs", () => {
  const metrics = computeSourceNoveltyBySourceId({
    sources: [
      { id: "linkedin", type: "linkedin_capture_file", captureJobCount: 5, importedCount: 3, droppedByDedupeCount: 1 },
      { id: "indeed", type: "indeed_search", captureJobCount: 4, importedCount: 2, droppedByDedupeCount: 0 },
      { id: "levels", type: "levelsfyi_search", captureJobCount: 0, importedCount: 0, droppedByDedupeCount: 0 },
    ],
    importedJobs: [
      { sourceId: "linkedin", normalizedHash: "hash-a" },
      { sourceId: "indeed", normalizedHash: "hash-b" },
    ],
  });

  assert.equal(metrics.levels.uniqueImportedVsBaseline, 0);
  assert.equal(metrics.levels.noveltyRate, null);
  assert.equal(metrics.levels.overlap.linkedin.duplicateRate, null);
  assert.equal(metrics.levels.overlap.indeed.duplicateRate, null);
});
