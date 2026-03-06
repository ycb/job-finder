import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { openDatabase } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrations.js";
import {
  markApplicationStatus,
  pruneSourceJobs,
  upsertJobs
} from "../src/jobs/repository.js";
import { normalizeJobRecord } from "../src/jobs/normalize.js";

function createTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-prune-test-"));
  const dbPath = path.join(dir, "jobs.db");
  const { db } = openDatabase(dbPath);
  return { db, dir };
}

function cleanupTempDb(db, dir) {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

test("pruneSourceJobs removes stale new/viewed rows and preserves applied rows", () => {
  const { db, dir } = createTempDb();
  try {
    runMigrations(db);

    const source = {
      id: "ai-san-francisco",
      type: "ashby_search",
      searchUrl:
        "https://www.google.com/search?q=site%3Aashbyhq.com+product+manager+ai+san+francisco"
    };

    const keepJob = normalizeJobRecord(
      {
        title: "Senior Product Manager, AI Platform",
        company: "Example AI",
        location: "San Francisco, CA",
        description: "Product manager role",
        url: "https://jobs.ashbyhq.com/exampleai/role-1"
      },
      source
    );
    const staleNewJob = normalizeJobRecord(
      {
        title: "Software Engineer, AI",
        company: "Example AI",
        location: "San Francisco, CA",
        description: "Engineering role",
        url: "https://jobs.ashbyhq.com/exampleai/role-2"
      },
      source
    );
    const staleAppliedJob = normalizeJobRecord(
      {
        title: "Product Designer",
        company: "Example AI",
        location: "San Francisco, CA",
        description: "Design role",
        url: "https://jobs.ashbyhq.com/exampleai/role-3"
      },
      source
    );

    upsertJobs(db, [keepJob, staleNewJob, staleAppliedJob]);
    markApplicationStatus(db, staleAppliedJob.id, "applied");

    const pruned = pruneSourceJobs(db, source.id, [keepJob.id]);
    assert.equal(pruned, 1);

    const remaining = db
      .prepare(
        `
        SELECT j.id, COALESCE(a.status, 'new') AS status
        FROM jobs j
        LEFT JOIN applications a ON a.job_id = j.id
        WHERE j.source_id = ?
        ORDER BY j.id;
      `
      )
      .all(source.id)
      .map((row) => ({
        id: row.id,
        status: row.status
      }));

    assert.deepEqual(
      remaining,
      [
        { id: keepJob.id, status: "new" },
        { id: staleAppliedJob.id, status: "applied" }
      ].sort((left, right) => left.id.localeCompare(right.id))
    );
  } finally {
    cleanupTempDb(db, dir);
  }
});
