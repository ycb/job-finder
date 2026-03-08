import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  evaluateCaptureRun,
  shouldIngestCaptureEvaluation,
  writeCaptureQuarantineArtifact
} from "../src/sources/capture-validation.js";

function buildSource(overrides = {}) {
  return {
    id: "linkedin-main",
    name: "LinkedIn Main",
    type: "linkedin_capture_file",
    searchUrl: "https://www.linkedin.com/jobs/search",
    ...overrides
  };
}

function buildJobs(count, overrides = {}) {
  const jobs = [];
  for (let index = 0; index < count; index += 1) {
    jobs.push({
      title: `Job ${index + 1}`,
      company: `Company ${index + 1}`,
      location: "San Francisco, CA",
      postedAt: "1 day ago",
      salaryText: "$200,000",
      employmentType: "full-time",
      url: `https://example.com/jobs/${index + 1}`,
      ...overrides
    });
  }
  return jobs;
}

test("evaluateCaptureRun accepts healthy payloads", () => {
  const source = buildSource();
  const payload = {
    capturedAt: "2026-03-07T20:00:00.000Z",
    expectedCount: 20,
    jobs: buildJobs(18)
  };

  const result = evaluateCaptureRun(source, payload);

  assert.equal(result.outcome, "accept");
  assert.equal(result.metrics.sampleSize, 18);
  assert.ok(Array.isArray(result.reasons));
  assert.equal(result.reasons.length, 0);
});

test("evaluateCaptureRun rejects malformed payloads", () => {
  const source = buildSource();
  const payload = {
    capturedAt: "2026-03-07T20:00:00.000Z",
    jobs: null
  };

  const result = evaluateCaptureRun(source, payload);

  assert.equal(result.outcome, "reject");
  assert.ok(result.reasons.some((reason) => reason.includes("jobs array")));
});

test("evaluateCaptureRun quarantines suspiciously low volume runs", () => {
  const source = buildSource();
  const payload = {
    capturedAt: "2026-03-07T20:00:00.000Z",
    expectedCount: 50,
    jobs: buildJobs(2)
  };

  const result = evaluateCaptureRun(source, payload);

  assert.equal(result.outcome, "quarantine");
  assert.ok(
    result.reasons.some((reason) => reason.includes("baseline")),
    "expected baseline-volume quarantine reason"
  );
});

test("evaluateCaptureRun quarantines duplicate-inflated runs", () => {
  const source = buildSource();
  const duplicateJobs = buildJobs(12).map((job) => ({
    ...job,
    title: "Product Manager",
    company: "DuplicateCo",
    url: "https://example.com/jobs/constant"
  }));
  const payload = {
    capturedAt: "2026-03-07T20:00:00.000Z",
    expectedCount: 12,
    jobs: duplicateJobs
  };

  const result = evaluateCaptureRun(source, payload);

  assert.equal(result.outcome, "quarantine");
  assert.ok(
    result.reasons.some((reason) => reason.includes("duplicate")),
    "expected duplicate inflation quarantine reason"
  );
});

test("writeCaptureQuarantineArtifact persists source + evaluation evidence", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-quarantine-"));

  try {
    const source = buildSource({ id: "indeed-main", type: "indeed_search" });
    const payload = {
      capturedAt: "2026-03-07T20:00:00.000Z",
      jobs: buildJobs(3)
    };
    const evaluation = {
      outcome: "quarantine",
      reasons: ["baseline volume fell below threshold"],
      metrics: {
        sampleSize: 3
      }
    };

    const artifactPath = writeCaptureQuarantineArtifact(source, payload, evaluation, {
      rootDir: tempDir,
      maxJobs: 2
    });

    assert.ok(fs.existsSync(artifactPath), "expected quarantine artifact file");
    const stored = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

    assert.equal(stored.source.id, "indeed-main");
    assert.equal(stored.evaluation.outcome, "quarantine");
    assert.equal(stored.jobsSample.length, 2);
    assert.equal(stored.totalJobs, 3);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("shouldIngestCaptureEvaluation blocks quarantine by default and allows with override", () => {
  const evaluation = {
    outcome: "quarantine",
    reasons: ["duplicate inflation detected"]
  };

  assert.equal(shouldIngestCaptureEvaluation(evaluation), false);
  assert.equal(
    shouldIngestCaptureEvaluation(evaluation, { allowQuarantined: true }),
    true
  );
});
