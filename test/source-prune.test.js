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

test("pruneSourceJobs works for legacy schemas without ON DELETE CASCADE", () => {
  const { db, dir } = createTempDb();
  try {
    db.exec(`
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_url TEXT NOT NULL,
        external_id TEXT,
        title TEXT NOT NULL,
        company TEXT NOT NULL,
        location TEXT,
        posted_at TEXT,
        employment_type TEXT,
        easy_apply INTEGER NOT NULL DEFAULT 0,
        salary_text TEXT,
        description TEXT NOT NULL,
        normalized_hash TEXT NOT NULL,
        structured_meta TEXT,
        metadata_quality_score INTEGER,
        missing_required_fields TEXT,
        last_import_batch_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE evaluations (
        job_id TEXT PRIMARY KEY,
        score INTEGER NOT NULL,
        bucket TEXT NOT NULL,
        summary TEXT NOT NULL,
        reasons TEXT NOT NULL,
        evaluated_at TEXT NOT NULL,
        FOREIGN KEY (job_id) REFERENCES jobs (id)
      );

      CREATE TABLE applications (
        job_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        draft_path TEXT,
        first_viewed_at TEXT,
        last_action_at TEXT NOT NULL,
        submitted_at TEXT,
        FOREIGN KEY (job_id) REFERENCES jobs (id)
      );
    `);

    const source = {
      id: "legacy-source",
      type: "ashby_search",
      searchUrl: "https://www.google.com/search?q=site%3Aashbyhq.com+product+manager+ai"
    };

    const viewedJob = normalizeJobRecord(
      {
        title: "Viewed Job",
        company: "Legacy Co",
        location: "San Francisco, CA",
        description: "Viewed role",
        url: "https://jobs.ashbyhq.com/legacy/role-1"
      },
      source
    );
    const appliedJob = normalizeJobRecord(
      {
        title: "Applied Job",
        company: "Legacy Co",
        location: "San Francisco, CA",
        description: "Applied role",
        url: "https://jobs.ashbyhq.com/legacy/role-2"
      },
      source
    );

    upsertJobs(db, [viewedJob, appliedJob]);
    db.prepare(`
      INSERT INTO evaluations (job_id, score, bucket, summary, reasons, evaluated_at)
      VALUES (?, 80, 'strong', 'ok', '[]', ?);
    `).run(viewedJob.id, new Date().toISOString());
    db.prepare(`
      INSERT INTO applications (job_id, status, notes, last_action_at)
      VALUES (?, 'viewed', '', ?);
    `).run(viewedJob.id, new Date().toISOString());
    markApplicationStatus(db, appliedJob.id, "applied");

    const pruned = pruneSourceJobs(db, source.id);
    assert.equal(pruned, 1);

    const viewedStillExists = db
      .prepare("SELECT COUNT(*) AS count FROM jobs WHERE id = ?;")
      .get(viewedJob.id);
    const appliedStillExists = db
      .prepare("SELECT COUNT(*) AS count FROM jobs WHERE id = ?;")
      .get(appliedJob.id);
    const viewedEvalExists = db
      .prepare("SELECT COUNT(*) AS count FROM evaluations WHERE job_id = ?;")
      .get(viewedJob.id);
    const viewedAppExists = db
      .prepare("SELECT COUNT(*) AS count FROM applications WHERE job_id = ?;")
      .get(viewedJob.id);

    assert.equal(Number(viewedStillExists.count), 0);
    assert.equal(Number(appliedStillExists.count), 1);
    assert.equal(Number(viewedEvalExists.count), 0);
    assert.equal(Number(viewedAppExists.count), 0);
  } finally {
    cleanupTempDb(db, dir);
  }
});
