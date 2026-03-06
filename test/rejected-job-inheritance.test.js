import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { openDatabase } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrations.js";
import { upsertJobs, markApplicationStatusByNormalizedHash } from "../src/jobs/repository.js";

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

test("newly captured job inherits rejected status from existing job with same normalized_hash", () => {
  const { db, dir } = createTempDb();
  try {
    runMigrations(db);

  const normalizedHash = "test-hash-123";
  const now = new Date().toISOString();

  // Insert first job and mark it as rejected
  const job1 = {
    id: "job-1",
    source: "linkedin_capture_file",
    sourceId: "source-a",
    sourceUrl: "https://linkedin.com/jobs/view/1",
    externalId: "ext-1",
    title: "Senior Product Manager",
    company: "Test Company",
    location: "Remote",
    postedAt: now,
    employmentType: "Full-time",
    easyApply: false,
    salaryText: "$150k - $200k",
    description: "Job description",
    normalizedHash,
    createdAt: now,
    updatedAt: now
  };

  upsertJobs(db, [job1]);
  markApplicationStatusByNormalizedHash(db, normalizedHash, "rejected", "Not interested");

  // Verify job1 is marked as rejected
  const job1Status = db
    .prepare("SELECT COALESCE(a.status, 'new') as status FROM jobs j LEFT JOIN applications a ON a.job_id = j.id WHERE j.id = ?")
    .get("job-1");
  assert.equal(job1Status.status, "rejected", "First job should be rejected");

  // Now insert a new job with the same normalized_hash from a different source
  const job2 = {
    id: "job-2",
    source: "linkedin_capture_file",
    sourceId: "source-b",
    sourceUrl: "https://linkedin.com/jobs/view/2",
    externalId: "ext-2",
    title: "Senior Product Manager",
    company: "Test Company",
    location: "Remote",
    postedAt: now,
    employmentType: "Full-time",
    easyApply: false,
    salaryText: "$150k - $200k",
    description: "Job description",
    normalizedHash,
    createdAt: now,
    updatedAt: now
  };

  upsertJobs(db, [job2]);

  // Verify job2 inherits the rejected status
  const job2Status = db
    .prepare("SELECT COALESCE(a.status, 'new') as status FROM jobs j LEFT JOIN applications a ON a.job_id = j.id WHERE j.id = ?")
    .get("job-2");
  assert.equal(job2Status.status, "rejected", "Newly captured job should inherit rejected status");

  // Verify both jobs are excluded from review queue
  const queueCount = db
    .prepare("SELECT COUNT(*) as count FROM jobs j LEFT JOIN applications a ON a.job_id = j.id WHERE COALESCE(a.status, 'new') != 'rejected' AND j.normalized_hash = ?")
    .get(normalizedHash);
  assert.equal(queueCount.count, 0, "Both jobs should be excluded from review queue");
  } finally {
    cleanupTempDb(db, dir);
  }
});

test("newly captured job without existing status gets no inherited status", () => {
  const { db, dir } = createTempDb();
  try {
    runMigrations(db);

  const normalizedHash = "test-hash-456";
  const now = new Date().toISOString();

  // Insert a job with no existing duplicate
  const job = {
    id: "job-3",
    source: "linkedin_capture_file",
    sourceId: "source-c",
    sourceUrl: "https://linkedin.com/jobs/view/3",
    externalId: "ext-3",
    title: "Engineering Manager",
    company: "Another Company",
    location: "San Francisco",
    postedAt: now,
    employmentType: "Full-time",
    easyApply: false,
    salaryText: "$180k - $220k",
    description: "Job description",
    normalizedHash,
    createdAt: now,
    updatedAt: now
  };

  upsertJobs(db, [job]);

  // Verify job has no application status (defaults to 'new')
  const jobStatus = db
    .prepare("SELECT COALESCE(a.status, 'new') as status FROM jobs j LEFT JOIN applications a ON a.job_id = j.id WHERE j.id = ?")
    .get("job-3");
  assert.equal(jobStatus.status, "new", "New job without duplicates should default to new");
  } finally {
    cleanupTempDb(db, dir);
  }
});

test("newly captured job inherits applied status from existing job", () => {
  const { db, dir } = createTempDb();
  try {
    runMigrations(db);

  const normalizedHash = "test-hash-789";
  const now = new Date().toISOString();

  // Insert first job and mark it as applied
  const job1 = {
    id: "job-4",
    source: "linkedin_capture_file",
    sourceId: "source-d",
    sourceUrl: "https://linkedin.com/jobs/view/4",
    externalId: "ext-4",
    title: "Staff Product Manager",
    company: "Great Company",
    location: "New York",
    postedAt: now,
    employmentType: "Full-time",
    easyApply: false,
    salaryText: "$200k - $250k",
    description: "Job description",
    normalizedHash,
    createdAt: now,
    updatedAt: now
  };

  upsertJobs(db, [job1]);
  markApplicationStatusByNormalizedHash(db, normalizedHash, "applied", "Applied on company site");

  // Now insert a new job with the same normalized_hash
  const job2 = {
    id: "job-5",
    source: "linkedin_capture_file",
    sourceId: "source-e",
    sourceUrl: "https://linkedin.com/jobs/view/5",
    externalId: "ext-5",
    title: "Staff Product Manager",
    company: "Great Company",
    location: "New York",
    postedAt: now,
    employmentType: "Full-time",
    easyApply: false,
    salaryText: "$200k - $250k",
    description: "Job description",
    normalizedHash,
    createdAt: now,
    updatedAt: now
  };

  upsertJobs(db, [job2]);

  // Verify job2 inherits the applied status
  const job2Status = db
    .prepare("SELECT COALESCE(a.status, 'new') as status FROM jobs j LEFT JOIN applications a ON a.job_id = j.id WHERE j.id = ?")
    .get("job-5");
  assert.equal(job2Status.status, "applied", "Newly captured job should inherit applied status");
  } finally {
    cleanupTempDb(db, dir);
  }
});
