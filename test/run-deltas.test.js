import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { openDatabase } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrations.js";
import { classifyRunDeltas } from "../src/jobs/run-deltas.js";
import {
  listSourceRunTotals,
  listLatestSourceRunDeltas,
  recordSourceRunDeltas
} from "../src/jobs/repository.js";

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
        foundCount: 18,
        filteredCount: 4,
        dedupedCount: 2,
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
        foundCount: 8,
        filteredCount: 2,
        dedupedCount: 1,
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
        foundSamples: 2,
        filteredSamples: 2,
        dedupedSamples: 2
      }
    ]);
  } finally {
    cleanupTempDb(db, dir);
  }
});
