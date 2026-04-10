import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  computeSourceHealthStatus,
  loadSourceHealthHistory,
  recordSourceHealthFromCaptureEvaluation,
  recordSourceHealthRun,
  resolveSourceHealthHistoryPath
} from "../src/sources/source-health.js";

function createTempHistoryPath(prefix = "job-finder-source-health-") {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    tempDir,
    historyPath: path.join(tempDir, "source-health-history.json")
  };
}

test("resolveSourceHealthHistoryPath returns provided absolute path", () => {
  const customPath = "/tmp/custom-source-health-history.json";
  assert.equal(resolveSourceHealthHistoryPath(customPath), customPath);
});

test("recordSourceHealthRun writes and deduplicates entries by capturedAt", () => {
  const { tempDir, historyPath } = createTempHistoryPath();

  try {
    const first = recordSourceHealthRun("linkedin-main", {
      capturedAt: "2026-03-07T20:00:00.000Z",
      sourceType: "linkedin_capture_file",
      outcome: "accept",
      sampleSize: 30,
      requiredCoverage: { title: 1, company: 1, url: 1 },
      optionalUnknownRates: { location: 0.1, postedAt: 0.1, salaryText: 0.8, employmentType: 0.7 },
      baselineRatio: 0.9,
      uniqueJobRatio: 0.95,
      urlValidityRatio: 1
    }, {
      historyPath
    });

    const second = recordSourceHealthRun("linkedin-main", {
      capturedAt: "2026-03-07T20:00:00.000Z",
      sourceType: "linkedin_capture_file",
      outcome: "quarantine",
      sampleSize: 2,
      requiredCoverage: { title: 0.4, company: 0.4, url: 0.3 },
      optionalUnknownRates: { location: 1, postedAt: 1, salaryText: 1, employmentType: 1 },
      baselineRatio: 0.05,
      uniqueJobRatio: 0.1,
      urlValidityRatio: 0.2
    }, {
      historyPath
    });

    assert.equal(first.sourceId, "linkedin-main");
    assert.equal(second.outcome, "quarantine");

    const stored = loadSourceHealthHistory(historyPath);
    const rows = stored.bySource["linkedin-main"];
    assert.equal(rows.length, 1, "expected capturedAt dedupe");
    assert.equal(rows[0].outcome, "quarantine", "latest upsert should replace entry");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("computeSourceHealthStatus marks reject outcomes as failing", () => {
  const { tempDir, historyPath } = createTempHistoryPath();
  const now = Date.now();

  try {
    recordSourceHealthRun("indeed-main", {
      capturedAt: new Date(now).toISOString(),
      sourceType: "indeed_search",
      outcome: "reject",
      sampleSize: 0,
      requiredCoverage: { title: 0, company: 0, url: 0 },
      optionalUnknownRates: { location: 1, postedAt: 1, salaryText: 1, employmentType: 1 },
      baselineRatio: 0,
      uniqueJobRatio: null,
      urlValidityRatio: 0
    }, {
      historyPath
    });

    const status = computeSourceHealthStatus("indeed-main", {
      historyPath,
      window: 3
    });

    assert.equal(status.status, "failing");
    assert.ok(status.reasons.some((reason) => reason.includes("reject")));
    assert.equal(
      status.updatedAt,
      status.latest?.recordedAt,
      "expected updatedAt to mirror latest health record timestamp"
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("computeSourceHealthStatus detects volume anomaly as degraded", () => {
  const { tempDir, historyPath } = createTempHistoryPath();
  const now = Date.now();

  try {
    recordSourceHealthRun("zip-main", {
      capturedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
      sourceType: "ziprecruiter_search",
      outcome: "accept",
      sampleSize: 90,
      requiredCoverage: { title: 1, company: 1, url: 1 },
      optionalUnknownRates: { location: 0.2, postedAt: 0.2, salaryText: 0.5, employmentType: 0.4 },
      baselineRatio: 1,
      uniqueJobRatio: 0.97,
      urlValidityRatio: 1
    }, {
      historyPath
    });

    recordSourceHealthRun("zip-main", {
      capturedAt: new Date(now - 60 * 60 * 1000).toISOString(),
      sourceType: "ziprecruiter_search",
      outcome: "accept",
      sampleSize: 88,
      requiredCoverage: { title: 1, company: 1, url: 1 },
      optionalUnknownRates: { location: 0.2, postedAt: 0.2, salaryText: 0.5, employmentType: 0.4 },
      baselineRatio: 0.97,
      uniqueJobRatio: 0.96,
      urlValidityRatio: 1
    }, {
      historyPath
    });

    recordSourceHealthRun("zip-main", {
      capturedAt: new Date(now).toISOString(),
      sourceType: "ziprecruiter_search",
      outcome: "accept",
      sampleSize: 4,
      requiredCoverage: { title: 1, company: 1, url: 1 },
      optionalUnknownRates: { location: 0.2, postedAt: 0.2, salaryText: 0.5, employmentType: 0.4 },
      baselineRatio: 0.04,
      uniqueJobRatio: 1,
      urlValidityRatio: 1
    }, {
      historyPath
    });

    const status = computeSourceHealthStatus("zip-main", {
      historyPath,
      window: 3
    });

    assert.equal(status.status, "degraded");
    assert.ok(status.reasons.some((reason) => reason.includes("volume anomaly")));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("recordSourceHealthFromCaptureEvaluation maps evaluation metrics into history rows", () => {
  const { tempDir, historyPath } = createTempHistoryPath();

  try {
    recordSourceHealthFromCaptureEvaluation(
      {
        id: "google-main",
        type: "google_search"
      },
      {
        capturedAt: "2026-03-07T20:00:00.000Z",
        expectedCount: 40,
        jobs: [{ title: "Job A", company: "A", url: "https://example.com/a" }]
      },
      {
        outcome: "quarantine",
        reasons: ["volume anomaly"],
        reasonDetails: [{ code: "baseline_volume_low", message: "volume anomaly" }],
        metrics: {
          sampleSize: 1,
          baselineCount: 40,
          baselineRatio: 0.025,
          uniqueJobRatio: 1,
          urlValidityRatio: 1,
          requiredCoverage: { title: 1, company: 1, url: 1 },
          optionalUnknownRates: { location: 1, postedAt: 1, salaryText: 1, employmentType: 1 }
        }
      },
      {
        historyPath
      }
    );

    const stored = loadSourceHealthHistory(historyPath);
    const rows = stored.bySource["google-main"];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sourceType, "google_search");
    assert.equal(rows[0].outcome, "quarantine");
    assert.equal(rows[0].baselineCount, 40);
    assert.ok(Array.isArray(rows[0].reasonDetails));
    assert.equal(rows[0].reasonDetails[0].code, "baseline_volume_low");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
