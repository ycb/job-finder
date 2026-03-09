import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { openDatabase } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrations.js";
import { markApplicationStatus, upsertJobs } from "../src/jobs/repository.js";
import {
  applyRetentionPolicyCleanup,
  writeRetentionCleanupAudit
} from "../src/jobs/retention.js";

function createTempDbAndAuditPaths() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-retention-cleanup-"));
  return {
    dir,
    dbPath: path.join(dir, "jobs.db"),
    auditPath: path.join(dir, "retention-audit.jsonl")
  };
}

function cleanupTemp(db, dir) {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

function makeJob(id, sourceId, createdAtIso) {
  return {
    id,
    source: "google_search",
    sourceId,
    sourceUrl: `https://example.com/jobs/${id}`,
    externalId: id,
    title: `Title ${id}`,
    company: "Example",
    location: "San Francisco, CA",
    postedAt: createdAtIso,
    employmentType: "full-time",
    easyApply: false,
    salaryText: "$200,000",
    description: "Example job",
    normalizedHash: `hash-${id}`,
    structuredMeta: null,
    metadataQualityScore: null,
    missingRequiredFields: [],
    createdAt: createdAtIso,
    updatedAt: createdAtIso
  };
}

test("applyRetentionPolicyCleanup deletes stale rows by status and preserves applied", () => {
  const { dir, dbPath } = createTempDbAndAuditPaths();
  const { db } = openDatabase(dbPath);
  try {
    runMigrations(db);
    const nowMs = Date.parse("2026-03-08T12:00:00.000Z");
    const dayMs = 24 * 60 * 60 * 1000;
    const old = (days) => new Date(nowMs - days * dayMs).toISOString();

    const sourceId = "retention-test";
    const jobs = [
      makeJob("job-new-old", sourceId, old(31)),
      makeJob("job-viewed-old", sourceId, old(46)),
      makeJob("job-skip-old", sourceId, old(22)),
      makeJob("job-rejected-old", sourceId, old(15)),
      makeJob("job-applied-old", sourceId, old(365)),
      makeJob("job-new-fresh", sourceId, old(5))
    ];

    upsertJobs(db, jobs);
    markApplicationStatus(db, "job-viewed-old", "viewed");
    markApplicationStatus(db, "job-skip-old", "skip_for_now");
    markApplicationStatus(db, "job-rejected-old", "rejected");
    markApplicationStatus(db, "job-applied-old", "applied");
    db.prepare("UPDATE applications SET last_action_at = ? WHERE job_id = ?").run(
      old(46),
      "job-viewed-old"
    );
    db.prepare("UPDATE applications SET last_action_at = ? WHERE job_id = ?").run(
      old(22),
      "job-skip-old"
    );
    db.prepare("UPDATE applications SET last_action_at = ? WHERE job_id = ?").run(
      old(15),
      "job-rejected-old"
    );
    db.prepare("UPDATE applications SET last_action_at = ? WHERE job_id = ?").run(
      old(365),
      "job-applied-old"
    );

    const cleanup = applyRetentionPolicyCleanup(
      db,
      {
        enabled: true,
        statusTtlDays: {
          new: 30,
          viewed: 45,
          skip_for_now: 21,
          rejected: 14,
          applied: null
        }
      },
      { nowMs }
    );

    assert.equal(cleanup.totalDeleted, 4);
    assert.deepEqual(cleanup.deletedByStatus, {
      new: 1,
      viewed: 1,
      skip_for_now: 1,
      rejected: 1,
      applied: 0
    });
    assert.equal(cleanup.protected.applied, 1);

    const remaining = db
      .prepare(
        `
        SELECT j.id, COALESCE(a.status, 'new') AS status
        FROM jobs j
        LEFT JOIN applications a ON a.job_id = j.id
        ORDER BY j.id;
      `
      )
      .all()
      .map((row) => ({
        id: row.id,
        status: row.status
      }));
    assert.deepEqual(remaining, [
      { id: "job-applied-old", status: "applied" },
      { id: "job-new-fresh", status: "new" }
    ]);
  } finally {
    cleanupTemp(db, dir);
  }
});

test("writeRetentionCleanupAudit appends cleanup summary with deleted/protected counts", () => {
  const { dir, auditPath } = createTempDbAndAuditPaths();
  try {
    writeRetentionCleanupAudit(
      {
        executedAt: "2026-03-08T12:00:00.000Z",
        totalDeleted: 3,
        deletedByStatus: {
          new: 1,
          viewed: 1,
          skip_for_now: 1,
          rejected: 0,
          applied: 0
        },
        protected: {
          applied: 2
        }
      },
      auditPath
    );

    const lines = fs
      .readFileSync(auditPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean);
    assert.equal(lines.length, 1);
    const row = JSON.parse(lines[0]);
    assert.equal(row.totalDeleted, 3);
    assert.equal(row.deletedByStatus.new, 1);
    assert.equal(row.protected.applied, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
