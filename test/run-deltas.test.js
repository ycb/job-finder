import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { openDatabase } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrations.js";
import { classifyRunDeltas } from "../src/jobs/run-deltas.js";
import {
  countActiveJobsByIds,
  CURRENT_SOURCE_RUN_SEMANTICS_VERSION,
  countSourceJobsInBatch,
  finalizeSourceRunDeltasForBatch,
  getLatestImportedRunId,
  listSourceRunTotals,
  listLatestSourceRunDeltas,
  recordSourceRunDeltas,
  upsertJobs
} from "../src/jobs/repository.js";
import { buildSourceRunSemanticMetrics } from "../src/jobs/run-deltas.js";

function createTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-run-deltas-"));
  const dbPath = path.join(dir, "jobs.db");
  const { db } = openDatabase(dbPath);
  runMigrations(db);
  return { db, dir };
}

function cleanupTempDb(db, dir) {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

test("classifyRunDeltas returns new/updated/unchanged counters from incoming jobs", () => {
  const existingRows = [
    {
      id: "job-1",
      source_id: "source-1",
      source_url: "https://example.com/role-1",
      external_id: "1",
      title: "Senior PM",
      company: "Example",
      location: "San Francisco, CA",
      posted_at: "2026-03-08T00:00:00.000Z",
      employment_type: "full-time",
      easy_apply: 0,
      salary_text: "$200k",
      description: "Role one",
      normalized_hash: "hash-1",
      structured_meta: null,
      metadata_quality_score: 90,
      missing_required_fields: null
    },
    {
      id: "job-2",
      source_id: "source-1",
      source_url: "https://example.com/role-2",
      external_id: "2",
      title: "Principal PM",
      company: "Example",
      location: "Remote",
      posted_at: "2026-03-08T00:00:00.000Z",
      employment_type: "full-time",
      easy_apply: 1,
      salary_text: null,
      description: "Role two",
      normalized_hash: "hash-2",
      structured_meta: null,
      metadata_quality_score: null,
      missing_required_fields: null
    }
  ];

  const incomingJobs = [
    {
      id: "job-1",
      sourceId: "source-1",
      sourceUrl: "https://example.com/role-1",
      externalId: "1",
      title: "Senior PM",
      company: "Example",
      location: "San Francisco, CA",
      postedAt: "2026-03-08T00:00:00.000Z",
      employmentType: "full-time",
      easyApply: false,
      salaryText: "$200k",
      description: "Role one",
      normalizedHash: "hash-1",
      structuredMeta: null,
      metadataQualityScore: 90,
      missingRequiredFields: null
    },
    {
      id: "job-2",
      sourceId: "source-1",
      sourceUrl: "https://example.com/role-2",
      externalId: "2",
      title: "Principal PM (AI)",
      company: "Example",
      location: "Remote",
      postedAt: "2026-03-08T00:00:00.000Z",
      employmentType: "full-time",
      easyApply: true,
      salaryText: "$240k",
      description: "Role two updated",
      normalizedHash: "hash-2",
      structuredMeta: null,
      metadataQualityScore: 95,
      missingRequiredFields: []
    },
    {
      id: "job-3",
      sourceId: "source-1",
      sourceUrl: "https://example.com/role-3",
      externalId: "3",
      title: "Director PM",
      company: "Example",
      location: "Remote",
      postedAt: "2026-03-08T00:00:00.000Z",
      employmentType: "full-time",
      easyApply: false,
      salaryText: null,
      description: "Role three",
      normalizedHash: "hash-3",
      structuredMeta: null,
      metadataQualityScore: null,
      missingRequiredFields: null
    }
  ];

  const deltas = classifyRunDeltas({ existingRows, incomingJobs });
  assert.equal(deltas.newCount, 1);
  assert.equal(deltas.updatedCount, 1);
  assert.equal(deltas.unchangedCount, 1);
});

test("recordSourceRunDeltas persists rows and listLatestSourceRunDeltas returns latest by source", () => {
  const { db, dir } = createTempDb();

  try {
    recordSourceRunDeltas(db, [
      {
        runId: "run-1",
        sourceId: "source-a",
        foundCount: 20,
        filteredCount: 5,
        dedupedCount: 2,
        rawFoundCount: 20,
        hardFilteredCount: 5,
        duplicateCollapsedCount: 2,
        importedKeptCount: 13,
        newCount: 4,
        updatedCount: 1,
        unchangedCount: 8,
        importedCount: 13,
        refreshMode: "safe",
        servedFrom: "cache",
        statusReason: "cache_fresh",
        statusLabel: "cache_fresh",
        capturedAt: "2026-03-09T06:00:00.000Z",
        recordedAt: "2026-03-09T06:00:10.000Z"
      },
      {
        runId: "run-1",
        sourceId: "source-b",
        foundCount: 8,
        filteredCount: 2,
        dedupedCount: 1,
        rawFoundCount: 8,
        hardFilteredCount: 2,
        duplicateCollapsedCount: 1,
        importedKeptCount: 5,
        newCount: 2,
        updatedCount: 0,
        unchangedCount: 3,
        importedCount: 5,
        refreshMode: "safe",
        servedFrom: "live",
        statusReason: "eligible",
        statusLabel: "ready_live",
        capturedAt: "2026-03-09T06:00:00.000Z",
        recordedAt: "2026-03-09T06:00:10.000Z"
      }
    ]);

    recordSourceRunDeltas(db, [
      {
        runId: "run-2",
        sourceId: "source-a",
        foundCount: 18,
        filteredCount: 4,
        dedupedCount: 2,
        rawFoundCount: 18,
        hardFilteredCount: 4,
        duplicateCollapsedCount: 2,
        importedKeptCount: 12,
        newCount: 1,
        updatedCount: 2,
        unchangedCount: 9,
        importedCount: 12,
        refreshMode: "safe",
        servedFrom: "cache",
        statusReason: "cooldown",
        statusLabel: "cooldown",
        capturedAt: "2026-03-09T07:00:00.000Z",
        recordedAt: "2026-03-09T07:00:10.000Z"
      }
    ]);

    const latest = listLatestSourceRunDeltas(db).map((row) => ({ ...row }));
    assert.deepEqual(latest, [
      {
        runId: "run-2",
        sourceId: "source-a",
        semanticsVersion: CURRENT_SOURCE_RUN_SEMANTICS_VERSION,
        foundCount: 18,
        filteredCount: 4,
        dedupedCount: 2,
        rawFoundCount: 18,
        hardFilteredCount: 4,
        duplicateCollapsedCount: 2,
        importedKeptCount: 12,
        newCount: 1,
        updatedCount: 2,
        unchangedCount: 9,
        importedCount: 12,
        refreshMode: "safe",
        servedFrom: "cache",
        statusReason: "cooldown",
        statusLabel: "cooldown",
        capturedAt: "2026-03-09T07:00:00.000Z",
        recordedAt: "2026-03-09T07:00:10.000Z"
      },
      {
        runId: "run-1",
        sourceId: "source-b",
        semanticsVersion: CURRENT_SOURCE_RUN_SEMANTICS_VERSION,
        foundCount: 8,
        filteredCount: 2,
        dedupedCount: 1,
        rawFoundCount: 8,
        hardFilteredCount: 2,
        duplicateCollapsedCount: 1,
        importedKeptCount: 5,
        newCount: 2,
        updatedCount: 0,
        unchangedCount: 3,
        importedCount: 5,
        refreshMode: "safe",
        servedFrom: "live",
        statusReason: "eligible",
        statusLabel: "ready_live",
        capturedAt: "2026-03-09T06:00:00.000Z",
        recordedAt: "2026-03-09T06:00:10.000Z"
      }
    ]);
  } finally {
    cleanupTempDb(db, dir);
  }
});

test("listLatestSourceRunDeltas prefers a live row over a later cache replay for the same capture", () => {
  const { db, dir } = createTempDb();

  try {
    recordSourceRunDeltas(db, [
      {
        runId: "run-live",
        sourceId: "source-a",
        foundCount: 18,
        filteredCount: 4,
        dedupedCount: 0,
        rawFoundCount: 18,
        hardFilteredCount: 4,
        duplicateCollapsedCount: 0,
        importedKeptCount: 14,
        newCount: 3,
        updatedCount: 1,
        unchangedCount: 10,
        importedCount: 14,
        refreshMode: "safe",
        servedFrom: "live",
        statusReason: "fetched_during_sync",
        statusLabel: "ready_live",
        capturedAt: "2026-03-31T10:00:00.000Z",
        recordedAt: "2026-03-31T10:00:10.000Z"
      },
      {
        runId: "run-cache",
        sourceId: "source-a",
        foundCount: 18,
        filteredCount: 4,
        dedupedCount: 0,
        rawFoundCount: 18,
        hardFilteredCount: 4,
        duplicateCollapsedCount: 0,
        importedKeptCount: 14,
        newCount: 0,
        updatedCount: 0,
        unchangedCount: 14,
        importedCount: 14,
        refreshMode: "safe",
        servedFrom: "cache",
        statusReason: "cache_fresh",
        statusLabel: "cache_fresh",
        capturedAt: "2026-03-31T10:00:00.000Z",
        recordedAt: "2026-03-31T10:05:00.000Z"
      }
    ]);

    const latest = listLatestSourceRunDeltas(db).map((row) => ({ ...row }));
    assert.equal(latest.length, 1);
    assert.equal(latest[0].runId, "run-live");
    assert.equal(latest[0].servedFrom, "live");
    assert.equal(latest[0].statusReason, "fetched_during_sync");
  } finally {
    cleanupTempDb(db, dir);
  }
});

test("buildSourceRunSemanticMetrics does not count reject-bucket jobs as filtered without hardFiltered", () => {
  const normalizedJobs = [
    { id: "job-1", normalizedHash: "hash-1" },
    { id: "job-2", normalizedHash: "hash-2" },
    { id: "job-3", normalizedHash: "hash-3" }
  ];
  const evaluations = [
    { jobId: "job-1", bucket: "reject", hardFiltered: false },
    { jobId: "job-2", bucket: "review_later", hardFiltered: false },
    { jobId: "job-3", bucket: "high_signal", hardFiltered: false }
  ];

  const metrics = buildSourceRunSemanticMetrics({
    normalizedJobs,
    evaluations,
    knownDuplicateHashes: new Set()
  });

  assert.equal(metrics.rawFoundCount, 3);
  assert.equal(metrics.hardFilteredCount, 0);
  assert.equal(metrics.duplicateCollapsedCount, 0);
  assert.equal(metrics.importedKeptCount, 3);
});

test("buildSourceRunSemanticMetrics treats reject-bucket rows as imported unless hardFiltered or duplicated", () => {
  const normalizedJobs = [
    { id: "job-1", normalizedHash: "shared-hash" },
    { id: "job-2", normalizedHash: "shared-hash" },
    { id: "job-3", normalizedHash: "hash-3" }
  ];
  const evaluations = [
    { jobId: "job-1", bucket: "reject", hardFiltered: false },
    { jobId: "job-2", bucket: "review_later", hardFiltered: false },
    { jobId: "job-3", bucket: "review_later", hardFiltered: false }
  ];

  const metrics = buildSourceRunSemanticMetrics({
    normalizedJobs,
    evaluations,
    knownDuplicateHashes: new Set()
  });

  assert.equal(metrics.rawFoundCount, 3);
  assert.equal(metrics.hardFilteredCount, 0);
  assert.equal(metrics.duplicateCollapsedCount, 1);
  assert.equal(metrics.importedKeptCount, 2);
});

test("listSourceRunTotals returns cumulative persisted source funnel metrics", () => {
  const { db, dir } = createTempDb();

  try {
    recordSourceRunDeltas(db, [
      {
        runId: "run-1",
        sourceId: "source-a",
        foundCount: 20,
        filteredCount: 5,
        dedupedCount: 2,
        rawFoundCount: 20,
        hardFilteredCount: 5,
        duplicateCollapsedCount: 2,
        importedKeptCount: 13,
        newCount: 4,
        updatedCount: 1,
        unchangedCount: 8,
        importedCount: 13,
        recordedAt: "2026-03-09T06:00:10.000Z"
      },
      {
        runId: "run-2",
        sourceId: "source-a",
        foundCount: 18,
        filteredCount: 4,
        dedupedCount: 2,
        rawFoundCount: 18,
        hardFilteredCount: 4,
        duplicateCollapsedCount: 2,
        importedKeptCount: 12,
        newCount: 1,
        updatedCount: 2,
        unchangedCount: 9,
        importedCount: 12,
        recordedAt: "2026-03-09T07:00:10.000Z"
      }
    ]);

    assert.deepEqual(listSourceRunTotals(db).map((row) => ({ ...row })), [
      {
        sourceId: "source-a",
        importedCount: 25,
        foundCount: 38,
        filteredCount: 9,
        dedupedCount: 4,
        rawFoundCount: 38,
        hardFilteredCount: 9,
        duplicateCollapsedCount: 4,
        importedKeptCount: 25,
        foundSamples: 2,
        filteredSamples: 2,
        dedupedSamples: 2,
        rawFoundSamples: 2,
        hardFilteredSamples: 2,
        duplicateCollapsedSamples: 2,
        importedKeptSamples: 2
      }
    ]);
  } finally {
    cleanupTempDb(db, dir);
  }
});

test("listSourceRunTotals dedupes repeated source runs with the same captured_at", () => {
  const { db, dir } = createTempDb();

  try {
    recordSourceRunDeltas(db, [
      {
        runId: "run-1",
        sourceId: "source-a",
        foundCount: 20,
        filteredCount: 5,
        dedupedCount: 2,
        rawFoundCount: 20,
        hardFilteredCount: 5,
        duplicateCollapsedCount: 2,
        importedKeptCount: 13,
        newCount: 4,
        updatedCount: 1,
        unchangedCount: 8,
        importedCount: 13,
        capturedAt: "2026-03-27T20:45:37.502Z",
        recordedAt: "2026-03-27T20:45:38.000Z"
      },
      {
        runId: "run-2",
        sourceId: "source-a",
        foundCount: 20,
        filteredCount: 5,
        dedupedCount: 2,
        rawFoundCount: 20,
        hardFilteredCount: 5,
        duplicateCollapsedCount: 2,
        importedKeptCount: 13,
        newCount: 4,
        updatedCount: 1,
        unchangedCount: 8,
        importedCount: 13,
        capturedAt: "2026-03-27T20:45:37.502Z",
        recordedAt: "2026-03-27T20:50:38.000Z"
      }
    ]);

    const totals = listSourceRunTotals(db).map((row) => ({ ...row }));
    assert.deepEqual(totals, [
      {
        sourceId: "source-a",
        importedCount: 13,
        foundCount: 20,
        filteredCount: 5,
        dedupedCount: 2,
        rawFoundCount: 20,
        hardFilteredCount: 5,
        duplicateCollapsedCount: 2,
        importedKeptCount: 13,
        foundSamples: 1,
        filteredSamples: 1,
        dedupedSamples: 1,
        rawFoundSamples: 1,
        hardFilteredSamples: 1,
        duplicateCollapsedSamples: 1,
        importedKeptSamples: 1
      }
    ]);
  } finally {
    cleanupTempDb(db, dir);
  }
});

test("listSourceRunTotals prefers a live row over a cache replay for the same capture", () => {
  const { db, dir } = createTempDb();

  try {
    recordSourceRunDeltas(db, [
      {
        runId: "run-live",
        sourceId: "source-a",
        foundCount: 18,
        filteredCount: 4,
        dedupedCount: 0,
        rawFoundCount: 18,
        hardFilteredCount: 4,
        duplicateCollapsedCount: 0,
        importedKeptCount: 14,
        newCount: 3,
        updatedCount: 1,
        unchangedCount: 10,
        importedCount: 14,
        refreshMode: "safe",
        servedFrom: "live",
        statusReason: "fetched_during_sync",
        statusLabel: "ready_live",
        capturedAt: "2026-03-31T10:00:00.000Z",
        recordedAt: "2026-03-31T10:00:10.000Z"
      },
      {
        runId: "run-cache",
        sourceId: "source-a",
        foundCount: 18,
        filteredCount: 4,
        dedupedCount: 0,
        rawFoundCount: 18,
        hardFilteredCount: 4,
        duplicateCollapsedCount: 0,
        importedKeptCount: 14,
        newCount: 0,
        updatedCount: 0,
        unchangedCount: 14,
        importedCount: 14,
        refreshMode: "safe",
        servedFrom: "cache",
        statusReason: "cache_fresh",
        statusLabel: "cache_fresh",
        capturedAt: "2026-03-31T10:00:00.000Z",
        recordedAt: "2026-03-31T10:05:00.000Z"
      }
    ]);

    const totals = listSourceRunTotals(db).map((row) => ({ ...row }));
    assert.deepEqual(totals, [
      {
        sourceId: "source-a",
        importedCount: 14,
        foundCount: 18,
        filteredCount: 4,
        dedupedCount: 0,
        rawFoundCount: 18,
        hardFilteredCount: 4,
        duplicateCollapsedCount: 0,
        importedKeptCount: 14,
        foundSamples: 1,
        filteredSamples: 1,
        dedupedSamples: 1,
        rawFoundSamples: 1,
        hardFilteredSamples: 1,
        duplicateCollapsedSamples: 1,
        importedKeptSamples: 1
      }
    ]);
  } finally {
    cleanupTempDb(db, dir);
  }
});

test("listSourceRunTotals ignores legacy rows without the current semantics version", () => {
  const { db, dir } = createTempDb();

  try {
    db.prepare(`
      INSERT INTO source_run_deltas (
        run_id,
        source_id,
        found_count,
        filtered_count,
        deduped_count,
        imported_count,
        recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      "run-legacy",
      "source-a",
      99,
      20,
      10,
      69,
      "2026-03-09T05:00:00.000Z"
    );

    recordSourceRunDeltas(db, [
      {
        runId: "run-v2",
        sourceId: "source-a",
        rawFoundCount: 8,
        hardFilteredCount: 3,
        duplicateCollapsedCount: 1,
        importedKeptCount: 4,
        importedCount: 4,
        recordedAt: "2026-03-09T06:00:00.000Z"
      }
    ]);

    assert.deepEqual(listSourceRunTotals(db).map((row) => ({ ...row })), [
      {
        sourceId: "source-a",
        importedCount: 4,
        foundCount: null,
        filteredCount: null,
        dedupedCount: null,
        rawFoundCount: 8,
        hardFilteredCount: 3,
        duplicateCollapsedCount: 1,
        importedKeptCount: 4,
        foundSamples: 0,
        filteredSamples: 0,
        dedupedSamples: 0,
        rawFoundSamples: 1,
        hardFilteredSamples: 1,
        duplicateCollapsedSamples: 1,
        importedKeptSamples: 1
      }
    ]);
  } finally {
    cleanupTempDb(db, dir);
  }
});

test("getLatestImportedRunId returns the latest completed run even when imports are zero", () => {
  const { db, dir } = createTempDb();

  try {
    recordSourceRunDeltas(db, [
      {
        runId: "run-empty",
        sourceId: "source-a",
        foundCount: 10,
        filteredCount: 5,
        dedupedCount: 5,
        rawFoundCount: 10,
        hardFilteredCount: 5,
        duplicateCollapsedCount: 5,
        importedKeptCount: 0,
        newCount: 0,
        updatedCount: 0,
        unchangedCount: 0,
        importedCount: 0,
        recordedAt: "2026-03-09T08:00:10.000Z"
      },
      {
        runId: "run-imported",
        sourceId: "source-a",
        foundCount: 12,
        filteredCount: 3,
        dedupedCount: 1,
        rawFoundCount: 12,
        hardFilteredCount: 3,
        duplicateCollapsedCount: 1,
        importedKeptCount: 8,
        newCount: 2,
        updatedCount: 0,
        unchangedCount: 6,
        importedCount: 8,
        recordedAt: "2026-03-09T07:00:10.000Z"
      }
    ]);

    assert.equal(getLatestImportedRunId(db), "run-empty");
  } finally {
    cleanupTempDb(db, dir);
  }
});

test("buildSourceRunSemanticMetrics counts hard-filter rejects and true duplicates", () => {
  const metrics = buildSourceRunSemanticMetrics({
    normalizedJobs: [
      { id: "job-1", normalizedHash: "hash-1" },
      { id: "job-2", normalizedHash: "hash-2" },
      { id: "job-3", normalizedHash: "hash-1" },
      { id: "job-4", normalizedHash: "hash-4" }
    ],
    evaluations: [
      { jobId: "job-1", hardFiltered: false },
      { jobId: "job-2", hardFiltered: true },
      { jobId: "job-3", hardFiltered: false },
      { jobId: "job-4", hardFiltered: false }
    ],
    knownDuplicateHashes: new Set(["hash-4"])
  });

  assert.deepEqual(
    {
      rawFoundCount: metrics.rawFoundCount,
      hardFilteredCount: metrics.hardFilteredCount,
      duplicateCollapsedCount: metrics.duplicateCollapsedCount,
      importedKeptCount: metrics.importedKeptCount,
      keptNormalizedHashes: Array.from(metrics.keptNormalizedHashes)
    },
    {
      rawFoundCount: 4,
      hardFilteredCount: 1,
      duplicateCollapsedCount: 2,
      importedKeptCount: 1,
      keptNormalizedHashes: ["hash-1"]
    }
  );
});

test("buildSourceRunSemanticMetrics ignores same-source reruns and only counts cross-source dupes", () => {
  const metrics = buildSourceRunSemanticMetrics({
    normalizedJobs: [
      { id: "job-1", normalizedHash: "hash-1" },
      { id: "job-2", normalizedHash: "hash-2" },
      { id: "job-3", normalizedHash: "hash-2" },
      { id: "job-4", normalizedHash: "hash-4" }
    ],
    evaluations: [
      { jobId: "job-1", hardFiltered: false },
      { jobId: "job-2", hardFiltered: false },
      { jobId: "job-3", hardFiltered: false },
      { jobId: "job-4", hardFiltered: false }
    ],
    knownDuplicateHashes: new Set(["hash-4"])
  });

  assert.deepEqual(
    {
      rawFoundCount: metrics.rawFoundCount,
      hardFilteredCount: metrics.hardFilteredCount,
      duplicateCollapsedCount: metrics.duplicateCollapsedCount,
      importedKeptCount: metrics.importedKeptCount,
      keptNormalizedHashes: Array.from(metrics.keptNormalizedHashes)
    },
    {
      rawFoundCount: 4,
      hardFilteredCount: 0,
      duplicateCollapsedCount: 2,
      importedKeptCount: 2,
      keptNormalizedHashes: ["hash-1", "hash-2"]
    }
  );
});

test("buildSourceRunSemanticMetrics returns imported-kept job ids for latest-batch stamping", () => {
  const metrics = buildSourceRunSemanticMetrics({
    normalizedJobs: [
      { id: "job-1", normalizedHash: "hash-1" },
      { id: "job-2", normalizedHash: "hash-2" },
      { id: "job-3", normalizedHash: "hash-3" },
      { id: "job-4", normalizedHash: "hash-2" }
    ],
    evaluations: [
      { jobId: "job-1", hardFiltered: false },
      { jobId: "job-2", hardFiltered: true },
      { jobId: "job-3", hardFiltered: false },
      { jobId: "job-4", hardFiltered: false }
    ],
    knownDuplicateHashes: new Set(["hash-3"])
  });

  assert.deepEqual(metrics.importedKeptJobIds, ["job-1", "job-4"]);
});

test("countSourceJobsInBatch reflects actual persisted rows touched in a run", () => {
  const { db, dir } = createTempDb();

  try {
    const sourceId = "levelsfyi-ai-pm";
    const runId = "run-levels";
    upsertJobs(db, [
      {
        id: "job-1",
        source: "levelsfyi_search",
        sourceId,
        sourceUrl: "https://www.levels.fyi/jobs",
        externalId: "1",
        title: "Role One",
        company: "Example",
        location: "San Francisco, CA",
        postedAt: "2026-03-27T00:00:00.000Z",
        employmentType: "full-time",
        easyApply: false,
        salaryText: "$200,000",
        description: "Role one",
        normalizedHash: "hash-1",
        structuredMeta: null,
        metadataQualityScore: 100,
        missingRequiredFields: [],
        createdAt: "2026-03-27T00:00:00.000Z",
        updatedAt: "2026-03-27T00:00:00.000Z"
      },
      {
        id: "job-2",
        source: "levelsfyi_search",
        sourceId,
        sourceUrl: "https://www.levels.fyi/jobs",
        externalId: "2",
        title: "Role Two",
        company: "Example",
        location: "San Francisco, CA",
        postedAt: "2026-03-27T00:00:00.000Z",
        employmentType: "full-time",
        easyApply: false,
        salaryText: "$210,000",
        description: "Role two",
        normalizedHash: "hash-2",
        structuredMeta: null,
        metadataQualityScore: 100,
        missingRequiredFields: [],
        createdAt: "2026-03-27T00:00:00.000Z",
        updatedAt: "2026-03-27T00:00:00.000Z"
      }
    ], { lastImportBatchId: runId });

    assert.equal(countSourceJobsInBatch(db, sourceId, runId), 1);
  } finally {
    cleanupTempDb(db, dir);
  }
});

test("upsertJobs clears last import batch id when explicitly passed null", () => {
  const { db, dir } = createTempDb();

  try {
    const normalizedJob = {
      id: "job-1",
      source: "builtin_search",
      sourceId: "builtin-sf-ai-pm",
      sourceUrl: "https://example.com/jobs/1",
      externalId: "1",
      title: "Senior Product Manager",
      company: "Example",
      location: "San Francisco, CA",
      postedAt: null,
      employmentType: null,
      easyApply: false,
      salaryText: null,
      description: "Role",
      normalizedHash: "hash-1",
      structuredMeta: null,
      metadataQualityScore: null,
      missingRequiredFields: null,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z"
    };

    upsertJobs(db, [normalizedJob], { lastImportBatchId: "run-1" });
    upsertJobs(db, [{ ...normalizedJob, updatedAt: "2026-03-02T00:00:00.000Z" }], {
      lastImportBatchId: null
    });

    const row = db
      .prepare(`SELECT last_import_batch_id AS lastImportBatchId FROM jobs WHERE id = 'job-1'`)
      .get();

    assert.equal(row.lastImportBatchId, null);
  } finally {
    cleanupTempDb(db, dir);
  }
});

test("countActiveJobsByIds counts only queue-eligible imported jobs", () => {
  const { db, dir } = createTempDb();

  try {
    upsertJobs(db, [
      {
        id: "job-1",
        source: "builtin_search",
        sourceId: "builtin-sf-ai-pm",
        sourceUrl: "https://example.com/jobs/1",
        externalId: "1",
        title: "Senior Product Manager",
        company: "Example",
        location: "San Francisco, CA",
        postedAt: null,
        employmentType: null,
        easyApply: false,
        salaryText: null,
        description: "Role",
        normalizedHash: "hash-1",
        structuredMeta: null,
        metadataQualityScore: null,
        missingRequiredFields: null,
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z"
      },
      {
        id: "job-2",
        source: "builtin_search",
        sourceId: "builtin-sf-ai-pm",
        sourceUrl: "https://example.com/jobs/2",
        externalId: "2",
        title: "Staff Product Manager",
        company: "Example",
        location: "San Francisco, CA",
        postedAt: null,
        employmentType: null,
        easyApply: false,
        salaryText: null,
        description: "Role",
        normalizedHash: "hash-2",
        structuredMeta: null,
        metadataQualityScore: null,
        missingRequiredFields: null,
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z"
      },
      {
        id: "job-3",
        source: "builtin_search",
        sourceId: "builtin-sf-ai-pm",
        sourceUrl: "https://example.com/jobs/3",
        externalId: "3",
        title: "Principal Product Manager",
        company: "Example",
        location: "San Francisco, CA",
        postedAt: null,
        employmentType: null,
        easyApply: false,
        salaryText: null,
        description: "Role",
        normalizedHash: "hash-3",
        structuredMeta: null,
        metadataQualityScore: null,
        missingRequiredFields: null,
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z"
      }
    ]);

    db.prepare(
      `INSERT INTO applications (job_id, status, notes, submitted_at, last_action_at) VALUES (?, ?, '', NULL, ?)`
    ).run("job-2", "applied", "2026-03-02T00:00:00.000Z");
    db.prepare(
      `INSERT INTO applications (job_id, status, notes, submitted_at, last_action_at) VALUES (?, ?, '', NULL, ?)`
    ).run("job-3", "rejected", "2026-03-02T00:00:00.000Z");
    db.prepare(
      `INSERT INTO evaluations (job_id, score, bucket, summary, reasons, confidence, freshness_days, hard_filtered, evaluated_at)
       VALUES (?, ?, ?, ?, '[]', ?, ?, ?, ?)`
    ).run(
      "job-1",
      25,
      "review_later",
      "Role",
      75,
      1,
      1,
      "2026-03-02T00:00:00.000Z"
    );

    assert.equal(countActiveJobsByIds(db, ["job-1", "job-2", "job-3"]), 0);
  } finally {
    cleanupTempDb(db, dir);
  }
});

test("finalizeSourceRunDeltasForBatch refreshes imported counts from scored batch state", () => {
  const { db, dir } = createTempDb();

  try {
    upsertJobs(
      db,
      [
        {
          id: "job-1",
          source: "builtin_search",
          sourceId: "builtin-sf-ai-pm",
          sourceUrl: "https://example.com/jobs/1",
          externalId: "1",
          title: "Senior Product Manager",
          company: "Example",
          location: "San Francisco, CA",
          postedAt: null,
          employmentType: null,
          easyApply: false,
          salaryText: null,
          description: "Role",
          normalizedHash: "hash-1",
          structuredMeta: null,
          metadataQualityScore: null,
          missingRequiredFields: null,
          createdAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-01T00:00:00.000Z"
        },
        {
          id: "job-2",
          source: "builtin_search",
          sourceId: "builtin-sf-ai-pm",
          sourceUrl: "https://example.com/jobs/2",
          externalId: "2",
          title: "Staff Product Manager",
          company: "Example",
          location: "San Francisco, CA",
          postedAt: null,
          employmentType: null,
          easyApply: false,
          salaryText: null,
          description: "Role",
          normalizedHash: "hash-2",
          structuredMeta: null,
          metadataQualityScore: null,
          missingRequiredFields: null,
          createdAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-01T00:00:00.000Z"
        }
      ],
      { lastImportBatchId: "run-1" }
    );

    recordSourceRunDeltas(db, [
      {
        runId: "run-1",
        sourceId: "builtin-sf-ai-pm",
        rawFoundCount: 2,
        hardFilteredCount: 0,
        duplicateCollapsedCount: 0,
        importedKeptCount: 2,
        importedCount: 2,
        recordedAt: "2026-03-02T00:00:00.000Z"
      }
    ]);

    db.prepare(
      `INSERT INTO evaluations (job_id, score, bucket, summary, reasons, confidence, freshness_days, hard_filtered, evaluated_at)
       VALUES (?, ?, ?, ?, '[]', ?, ?, ?, ?)`
    ).run("job-1", 25, "review_later", "Role", 75, 1, 1, "2026-03-02T00:00:00.000Z");
    db.prepare(
      `INSERT INTO applications (job_id, status, notes, submitted_at, last_action_at) VALUES (?, ?, '', NULL, ?)`
    ).run("job-2", "applied", "2026-03-02T00:00:00.000Z");

    finalizeSourceRunDeltasForBatch(db, "run-1");

    const row = db
      .prepare(
        `SELECT hard_filtered_count AS hardFilteredCount, imported_kept_count AS importedKeptCount, imported_count AS importedCount
         FROM source_run_deltas
         WHERE run_id = 'run-1' AND source_id = 'builtin-sf-ai-pm'`
      )
      .get();

    assert.equal(row.hardFilteredCount, 1);
    assert.equal(row.importedKeptCount, 2);
    assert.equal(row.importedCount, 0);
  } finally {
    cleanupTempDb(db, dir);
  }
});

test("queue semantics migration backfills legacy batch ids and first viewed timestamps", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-queue-semantics-"));
  const dbPath = path.join(dir, "jobs.db");
  const { db } = openDatabase(dbPath);

  try {
    db.exec(`
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_url TEXT,
        external_id TEXT,
        title TEXT NOT NULL,
        company TEXT,
        location TEXT,
        posted_at TEXT,
        employment_type TEXT,
        easy_apply INTEGER DEFAULT 0,
        salary_text TEXT,
        description TEXT,
        normalized_hash TEXT,
        structured_meta TEXT,
        metadata_quality_score REAL,
        missing_required_fields TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE applications (
        job_id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'new',
        notes TEXT,
        submitted_at TEXT,
        last_action_at TEXT
      );
    `);

    const createdAt = "2026-03-01T00:00:00.000Z";
    const updatedAt = "2026-03-02T00:00:00.000Z";
    db.prepare(
      `
      INSERT INTO jobs (
        id, source, source_id, source_url, external_id, title, company, location,
        posted_at, employment_type, easy_apply, salary_text, description,
        normalized_hash, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      "legacy-job",
      "builtin_search",
      "builtin-sf-ai-pm",
      "https://example.com/jobs/1",
      "1",
      "Senior Product Manager",
      "Example",
      "San Francisco, CA",
      null,
      null,
      0,
      null,
      "Role",
      "hash-1",
      createdAt,
      updatedAt,
    );
    db.prepare(
      `
      INSERT INTO applications (job_id, status, submitted_at, last_action_at)
      VALUES (?, ?, ?, ?)
    `
    ).run("legacy-job", "viewed", null, updatedAt);

    runMigrations(db);

    const migrated = db
      .prepare(
        `
        SELECT j.last_import_batch_id AS lastImportBatchId, a.first_viewed_at AS firstViewedAt
        FROM jobs j
        LEFT JOIN applications a ON a.job_id = j.id
        WHERE j.id = 'legacy-job'
      `,
      )
      .get();

    assert.equal(migrated.lastImportBatchId, "legacy-import-batch");
    assert.equal(migrated.firstViewedAt, updatedAt);

    const normalizedJob = {
      id: "legacy-job",
      source: "builtin_search",
      sourceId: "builtin-sf-ai-pm",
      sourceUrl: "https://example.com/jobs/1",
      externalId: "1",
      title: "Senior Product Manager",
      company: "Example",
      location: "San Francisco, CA",
      postedAt: null,
      employmentType: null,
      easyApply: false,
      salaryText: null,
      description: "Role",
      normalizedHash: "hash-1",
      structuredMeta: null,
      metadataQualityScore: null,
      missingRequiredFields: null,
      createdAt,
      updatedAt,
    };

    upsertJobs(db, [normalizedJob], { lastImportBatchId: "run-123" });
    const updated = db
      .prepare(`SELECT last_import_batch_id AS lastImportBatchId FROM jobs WHERE id = 'legacy-job'`)
      .get();
    assert.equal(updated.lastImportBatchId, "run-123");
  } finally {
    cleanupTempDb(db, dir);
  }
});
