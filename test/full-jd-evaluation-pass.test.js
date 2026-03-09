import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { evaluateJobsFromSearchCriteria } from "../src/jobs/score.js";
import { openDatabase } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrations.js";
import { upsertEvaluations } from "../src/jobs/repository.js";

function createTempDb(prefix = "job-finder-full-jd-eval-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const dbPath = path.join(dir, "jobs.db");
  const { db } = openDatabase(dbPath);
  runMigrations(db);
  return { db, dir };
}

function cleanupTempDb(db, dir) {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

test("evaluateJobsFromSearchCriteria uses detail description path when provenance is detail", () => {
  const criteria = {
    keywords: "vector database"
  };

  const evaluations = evaluateJobsFromSearchCriteria(criteria, [
    {
      id: "job-detail-path",
      title: "Senior Product Manager",
      company: "Acme",
      location: "Remote",
      description: "Card snippet without keyword",
      structured_meta: JSON.stringify({
        description: "Lead vector database roadmap for AI platform retrieval quality.",
        descriptionSource: "detail",
        extractorProvenance: {
          description: "detail"
        }
      })
    }
  ]);

  assert.equal(evaluations.length, 1);
  assert.equal(evaluations[0].bucket, "high_signal");
  assert.ok(
    evaluations[0].reasons.some((reason) => reason.includes("keywords matched 1/1")),
    "expected keyword match to use detail description content"
  );
  assert.equal(evaluations[0].evaluationMeta.contentPathUsed, "detail_description");
  assert.equal(evaluations[0].evaluationMeta.detailFetchStatus, "detail_success");
});

test("evaluateJobsFromSearchCriteria records snippet fallback metadata when detail path is unavailable", () => {
  const criteria = {
    keywords: "ai platform"
  };

  const evaluations = evaluateJobsFromSearchCriteria(criteria, [
    {
      id: "job-snippet-path",
      title: "Product Manager",
      company: "Acme",
      location: "Remote",
      description: "Own AI platform product strategy.",
      structured_meta: JSON.stringify({
        descriptionSource: "card",
        extractorProvenance: {
          description: "card"
        }
      })
    }
  ]);

  assert.equal(evaluations.length, 1);
  assert.equal(evaluations[0].bucket, "high_signal");
  assert.equal(evaluations[0].evaluationMeta.contentPathUsed, "snippet_description");
  assert.equal(evaluations[0].evaluationMeta.detailFetchStatus, "snippet_fallback");
  assert.ok(
    evaluations[0].evaluationMeta.contentPathRationale.includes("card"),
    "expected rationale to record fallback provenance"
  );
});

test("upsertEvaluations persists evaluation metadata for full-JD path evidence", () => {
  const { db, dir } = createTempDb();
  try {
    db.prepare(
      `
      INSERT INTO jobs (
        id, source, source_id, source_url, external_id,
        title, company, location, posted_at, employment_type,
        easy_apply, salary_text, description, normalized_hash,
        structured_meta, metadata_quality_score, missing_required_fields,
        created_at, updated_at
      ) VALUES (
        'job-1', 'indeed_search', 'indeed-main', 'https://example.com/job/1', NULL,
        'PM', 'Acme', 'Remote', NULL, NULL,
        0, NULL, 'desc', 'hash-1',
        NULL, NULL, NULL,
        ?, ?
      );
    `
    ).run(new Date().toISOString(), new Date().toISOString());

    upsertEvaluations(db, [
      {
        jobId: "job-1",
        score: 88,
        bucket: "high_signal",
        summary: "Score 88: keywords matched",
        reasons: ["keywords matched 1/1"],
        confidence: 80,
        freshnessDays: null,
        hardFiltered: false,
        evaluationMeta: {
          contentPathUsed: "detail_description",
          detailFetchStatus: "detail_success",
          contentPathRationale: "detail description available",
          descriptionSource: "detail"
        },
        evaluatedAt: new Date().toISOString()
      }
    ]);

    const row = db
      .prepare("SELECT evaluation_meta FROM evaluations WHERE job_id = ?")
      .get("job-1");
    assert.ok(row, "expected stored evaluation row");
    const metadata = JSON.parse(String(row.evaluation_meta || "{}"));
    assert.equal(metadata.contentPathUsed, "detail_description");
    assert.equal(metadata.detailFetchStatus, "detail_success");
  } finally {
    cleanupTempDb(db, dir);
  }
});
