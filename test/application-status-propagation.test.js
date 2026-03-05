import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { openDatabase } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrations.js";
import {
  markApplicationStatusByNormalizedHash,
  upsertJobs
} from "../src/jobs/repository.js";
import { normalizeJobRecord, normalizeStoredJobForDedupe } from "../src/jobs/normalize.js";

function createTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-test-"));
  const dbPath = path.join(dir, "jobs.db");
  const { db } = openDatabase(dbPath);
  return { db, dir };
}

function cleanupTempDb(db, dir) {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

test("markApplicationStatusByNormalizedHash updates all duplicate records", () => {
  const { db, dir } = createTempDb();
  try {
    runMigrations(db);

    const source = {
      id: "ai-pm",
      type: "linkedin_capture_file",
      searchUrl: "https://www.linkedin.com/jobs/search-results/?keywords=ai+pm"
    };

    const jobs = [
      normalizeJobRecord(
        {
          title: "Staff Product Manager, AI Discovery",
          company: "Faire Wholesale, Inc.",
          location: "San Francisco, CA (Hybrid)",
          description: "Role details",
          url: "https://www.linkedin.com/jobs/view/1234567890/"
        },
        source
      ),
      normalizeJobRecord(
        {
          title: "Staff Product Manager, AI Discovery",
          company: "Staff Product Manager, AI Discovery",
          location: "Faire Wholesale, Inc.",
          description: "Role details",
          url: "https://www.linkedin.com/jobs/search-results/?keywords=Staff+Product+Manager%2C+AI+Discovery++Staff+Product+Manager%2C+AI+Discovery"
        },
        source
      )
    ];

    upsertJobs(db, jobs);
    markApplicationStatusByNormalizedHash(db, jobs[0].normalizedHash, "applied", "already applied");

    const statuses = db
      .prepare(
        `
        SELECT a.job_id AS jobId, a.status
        FROM applications a
        WHERE a.job_id IN (?, ?)
        ORDER BY a.job_id ASC;
      `
      )
      .all(jobs[0].id, jobs[1].id);

    assert.equal(statuses.length, 2);
    assert.equal(statuses[0].status, "applied");
    assert.equal(statuses[1].status, "applied");
  } finally {
    cleanupTempDb(db, dir);
  }
});

test("migration backfill repairs malformed linkedin company/location and normalized hash", () => {
  const { db, dir } = createTempDb();
  try {
    runMigrations(db);
    const now = new Date().toISOString();

    db.prepare(
      `
      INSERT INTO jobs (
        id, source, source_id, source_url, external_id, title, company, location,
        posted_at, employment_type, easy_apply, salary_text, description,
        normalized_hash, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `
    ).run(
      "legacy-1",
      "linkedin_capture_file",
      "ai-pm",
      "https://www.linkedin.com/jobs/search-results/?keywords=Staff+Product+Manager%2C+AI+Discovery++Staff+Product+Manager%2C+AI+Discovery",
      null,
      "Staff Product Manager, AI Discovery",
      "Staff Product Manager, AI Discovery",
      "Faire Wholesale, Inc.",
      null,
      null,
      0,
      null,
      "Legacy capture",
      "bad-hash",
      now,
      now
    );

    runMigrations(db);

    const repaired = db
      .prepare(
        `
        SELECT source, source_id, source_url, external_id, title, company, location, normalized_hash
        FROM jobs
        WHERE id = 'legacy-1';
      `
      )
      .get();

    const expected = normalizeStoredJobForDedupe(repaired);
    assert.equal(repaired.company, "Faire Wholesale, Inc.");
    assert.equal(repaired.location, null);
    assert.equal(repaired.normalized_hash, expected.normalizedHash);
  } finally {
    cleanupTempDb(db, dir);
  }
});
