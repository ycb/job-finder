import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { openDatabase } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrations.js";
import { upsertJobs } from "../src/jobs/repository.js";

function createTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-upsert-test-"));
  const dbPath = path.join(dir, "jobs.db");
  const { db } = openDatabase(dbPath);
  runMigrations(db);
  return { db, dir };
}

function cleanupTempDb(db, dir) {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

test("upsertJobs updates existing row when source_id + source_url conflict with different id", () => {
  const { db, dir } = createTempDb();
  try {
    const now = new Date().toISOString();
    const sourceId = "ai-pm";
    const sourceUrl = "https://www.linkedin.com/jobs/view/1234567890/";

    upsertJobs(db, [
      {
        id: "legacy-id",
        source: "linkedin_capture_file",
        sourceId,
        sourceUrl,
        externalId: null,
        title: "Staff Product Manager",
        company: "Example Inc",
        location: "San Francisco, CA",
        postedAt: now,
        employmentType: null,
        easyApply: false,
        salaryText: null,
        description: "Original",
        normalizedHash: "hash-1",
        createdAt: now,
        updatedAt: now
      }
    ]);

    upsertJobs(db, [
      {
        id: "new-id-derived-from-external",
        source: "linkedin_capture_file",
        sourceId,
        sourceUrl,
        externalId: "1234567890",
        title: "Staff Product Manager, AI",
        company: "Example Inc",
        location: "San Francisco, CA (Hybrid)",
        postedAt: now,
        employmentType: "full-time",
        easyApply: false,
        salaryText: "$220K",
        description: "Updated",
        normalizedHash: "hash-2",
        createdAt: now,
        updatedAt: now
      }
    ]);

    const rows = db
      .prepare(
        `
        SELECT id, source_id, source_url, external_id, title, location, normalized_hash
        FROM jobs
        WHERE source_id = ? AND source_url = ?;
      `
      )
      .all(sourceId, sourceUrl);

    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "legacy-id");
    assert.equal(rows[0].external_id, "1234567890");
    assert.equal(rows[0].title, "Staff Product Manager, AI");
    assert.equal(rows[0].normalized_hash, "hash-2");
  } finally {
    cleanupTempDb(db, dir);
  }
});
