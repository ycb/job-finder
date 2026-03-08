import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { evaluateSourceContractDrift } from "../src/sources/source-contracts.js";

function createTempWorkspace(prefix = "job-finder-contract-drift-") {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const sourcesPath = path.join(tempDir, "sources.json");
  const contractsPath = path.join(tempDir, "source-contracts.json");
  const historyPath = path.join(tempDir, "source-coverage-history.json");
  return { tempDir, sourcesPath, contractsPath, historyPath };
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function buildSource(id, type, capturePath) {
  return {
    id,
    name: id,
    type,
    enabled: true,
    searchUrl: "https://example.com/jobs?q=ai+product+manager",
    capturePath
  };
}

function buildContract(sourceType, options = {}) {
  return {
    sourceType,
    contractVersion: "1.0.0",
    lastVerified: options.lastVerified || "2026-03-07",
    criteriaMapping: options.criteriaMapping || {},
    extraction: {
      requiredFields: options.requiredFields || ["title", "company", "location", "salaryText"],
      fullJobDescription: "partial"
    },
    expectedCountStrategy: "none",
    paginationStrategy: "single_page"
  };
}

test("evaluateSourceContractDrift classifies low coverage as error and stale-only as warning", () => {
  const { tempDir, sourcesPath, contractsPath, historyPath } = createTempWorkspace();
  const indeedCapturePath = path.join(tempDir, "indeed.json");
  const zipCapturePath = path.join(tempDir, "zip.json");

  try {
    writeJson(sourcesPath, {
      sources: [
        buildSource("indeed-main", "indeed_search", indeedCapturePath),
        buildSource("zip-main", "ziprecruiter_search", zipCapturePath)
      ]
    });

    writeJson(contractsPath, {
      version: "test",
      contracts: [
        buildContract("indeed_search", {
          lastVerified: "2026-03-07",
          requiredFields: ["title", "salaryText", "location"]
        }),
        buildContract("ziprecruiter_search", {
          lastVerified: "2025-01-01",
          requiredFields: ["title", "company", "location"]
        })
      ]
    });

    writeJson(indeedCapturePath, {
      sourceId: "indeed-main",
      capturedAt: "2026-03-07T00:00:00.000Z",
      jobs: [
        { title: "AI PM", salaryText: "", location: "San Francisco, CA" },
        { title: "Senior PM", salaryText: "unknown", location: "San Jose, CA" }
      ]
    });

    writeJson(zipCapturePath, {
      sourceId: "zip-main",
      capturedAt: "2026-03-07T00:00:00.000Z",
      jobs: [{ title: "PM", company: "ZipCo", location: "Remote" }]
    });

    const report = evaluateSourceContractDrift({
      sourcesPath,
      contractsPath,
      staleAfterDays: 30,
      historyPath
    });

    const indeedRow = report.rows.find((row) => row.sourceId === "indeed-main");
    const zipRow = report.rows.find((row) => row.sourceId === "zip-main");

    assert.ok(indeedRow, "expected indeed row");
    assert.equal(indeedRow.status, "error");
    assert.equal(indeedRow.sampleSize, 2);
    assert.equal(indeedRow.coverageByField.salaryText, 0);
    assert.ok(
      indeedRow.issues.some((issue) => issue.includes("Rolling coverage below")),
      "expected low coverage issue"
    );

    assert.ok(zipRow, "expected zip row");
    assert.equal(zipRow.status, "warning");
    assert.equal(zipRow.stale, true);
    assert.ok(
      zipRow.issues.some((issue) => issue.includes("lastVerified")),
      "expected stale warning"
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("evaluateSourceContractDrift reports missing contracts as errors", () => {
  const { tempDir, sourcesPath, contractsPath, historyPath } = createTempWorkspace(
    "job-finder-contract-missing-"
  );
  const capturePath = path.join(tempDir, "google.json");

  try {
    writeJson(sourcesPath, {
      sources: [buildSource("google-main", "google_search", capturePath)]
    });

    writeJson(contractsPath, {
      version: "test",
      contracts: [buildContract("indeed_search")]
    });

    writeJson(capturePath, {
      sourceId: "google-main",
      capturedAt: "2026-03-07T00:00:00.000Z",
      jobs: [{ title: "PM", company: "ACME", location: "Remote", salaryText: "$200k" }]
    });

    const report = evaluateSourceContractDrift({
      sourcesPath,
      contractsPath,
      staleAfterDays: 30,
      historyPath
    });
    const row = report.rows.find((entry) => entry.sourceId === "google-main");

    assert.ok(row, "expected google row");
    assert.equal(row.status, "error");
    assert.equal(row.contractVersion, null);
    assert.deepEqual(row.coverageByField, {});
    assert.ok(row.issues.some((issue) => issue.includes("Missing contract")));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("evaluateSourceContractDrift emits null coverage for empty captures", () => {
  const { tempDir, sourcesPath, contractsPath, historyPath } = createTempWorkspace(
    "job-finder-contract-empty-"
  );
  const capturePath = path.join(tempDir, "builtin.json");

  try {
    writeJson(sourcesPath, {
      sources: [buildSource("builtin-main", "builtin_search", capturePath)]
    });

    writeJson(contractsPath, {
      version: "test",
      contracts: [
        buildContract("builtin_search", {
          requiredFields: ["title", "company", "location"],
          lastVerified: "2026-03-07"
        })
      ]
    });

    writeJson(capturePath, {
      sourceId: "builtin-main",
      capturedAt: "2026-03-07T00:00:00.000Z",
      jobs: []
    });

    const report = evaluateSourceContractDrift({
      sourcesPath,
      contractsPath,
      staleAfterDays: 30,
      historyPath
    });
    const row = report.rows.find((entry) => entry.sourceId === "builtin-main");

    assert.ok(row, "expected builtin row");
    assert.equal(row.status, "ok");
    assert.equal(row.sampleSize, 0);
    assert.equal(row.coverageByField.title, null);
    assert.equal(row.coverageByField.company, null);
    assert.equal(row.coverageByField.location, null);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("evaluateSourceContractDrift applies rolling coverage gate with configurable threshold", () => {
  const { tempDir, sourcesPath, contractsPath, historyPath } = createTempWorkspace(
    "job-finder-contract-rolling-"
  );
  const capturePath = path.join(tempDir, "indeed.json");
  const now = Date.now();

  try {
    writeJson(sourcesPath, {
      sources: [buildSource("indeed-main", "indeed_search", capturePath)]
    });
    writeJson(contractsPath, {
      version: "test",
      contracts: [
        buildContract("indeed_search", {
          requiredFields: ["salaryText"],
          lastVerified: "2026-03-07"
        })
      ]
    });
    writeJson(capturePath, {
      sourceId: "indeed-main",
      capturedAt: new Date(now).toISOString(),
      jobs: [{ salaryText: "$250k" }]
    });
    writeJson(historyPath, {
      version: "1.0.0",
      bySource: {
        "indeed-main": [
          {
            sourceType: "indeed_search",
            contractVersion: "1.0.0",
            capturedAt: new Date(now - 60 * 60 * 1000).toISOString(),
            sampleSize: 10,
            coverageByField: {
              salaryText: 0.5
            }
          },
          {
            sourceType: "indeed_search",
            contractVersion: "1.0.0",
            capturedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
            sampleSize: 10,
            coverageByField: {
              salaryText: 0.55
            }
          }
        ]
      }
    });

    const failReport = evaluateSourceContractDrift({
      sourcesPath,
      contractsPath,
      staleAfterDays: 30,
      historyPath,
      window: 3,
      minCoverage: 0.7
    });
    const failRow = failReport.rows.find((entry) => entry.sourceId === "indeed-main");
    assert.ok(failRow);
    assert.equal(failRow.status, "error");
    assert.equal(failRow.passCoverageGate, false);
    assert.equal(failRow.rollingSamplesUsed, 3);
    assert.equal(failRow.rollingCoverageByField.salaryText, 0.683);

    const passReport = evaluateSourceContractDrift({
      sourcesPath,
      contractsPath,
      staleAfterDays: 30,
      historyPath,
      window: 3,
      minCoverage: 0.69
    });
    const passRow = passReport.rows.find((entry) => entry.sourceId === "indeed-main");
    assert.ok(passRow);
    assert.equal(passRow.status, "error");
    assert.equal(passRow.passCoverageGate, false);

    const passReportBoundary = evaluateSourceContractDrift({
      sourcesPath,
      contractsPath,
      staleAfterDays: 30,
      historyPath,
      window: 3,
      minCoverage: 0.683
    });
    const boundaryRow = passReportBoundary.rows.find((entry) => entry.sourceId === "indeed-main");
    assert.ok(boundaryRow);
    assert.equal(boundaryRow.passCoverageGate, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("evaluateSourceContractDrift excludes stale history runs from rolling coverage", () => {
  const { tempDir, sourcesPath, contractsPath, historyPath } = createTempWorkspace(
    "job-finder-contract-stale-history-"
  );
  const capturePath = path.join(tempDir, "zip.json");
  const now = Date.now();

  try {
    writeJson(sourcesPath, {
      sources: [buildSource("zip-main", "ziprecruiter_search", capturePath)]
    });
    writeJson(contractsPath, {
      version: "test",
      contracts: [
        buildContract("ziprecruiter_search", {
          requiredFields: ["postedAt"],
          lastVerified: "2026-03-07"
        })
      ]
    });
    writeJson(capturePath, {
      sourceId: "zip-main",
      capturedAt: new Date(now).toISOString(),
      jobs: [{ postedAt: "1 day ago" }]
    });
    writeJson(historyPath, {
      version: "1.0.0",
      bySource: {
        "zip-main": [
          {
            sourceType: "ziprecruiter_search",
            contractVersion: "1.0.0",
            capturedAt: "2020-01-01T00:00:00.000Z",
            sampleSize: 100,
            coverageByField: {
              postedAt: 0
            }
          }
        ]
      }
    });

    const report = evaluateSourceContractDrift({
      sourcesPath,
      contractsPath,
      staleAfterDays: 30,
      historyPath,
      window: 3,
      minCoverage: 0.7
    });
    const row = report.rows.find((entry) => entry.sourceId === "zip-main");
    assert.ok(row);
    assert.equal(row.rollingSamplesUsed, 1);
    assert.equal(row.rollingCoverageByField.postedAt, 1);
    assert.equal(row.passCoverageGate, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("evaluateSourceContractDrift defaults to enabled sources only", () => {
  const { tempDir, sourcesPath, contractsPath, historyPath } = createTempWorkspace(
    "job-finder-contract-enabled-only-"
  );
  const capturePathEnabled = path.join(tempDir, "enabled.json");
  const capturePathDisabled = path.join(tempDir, "disabled.json");

  try {
    const disabledSource = buildSource("disabled-google", "google_search", capturePathDisabled);
    disabledSource.enabled = false;
    writeJson(sourcesPath, {
      sources: [
        buildSource("enabled-indeed", "indeed_search", capturePathEnabled),
        disabledSource
      ]
    });
    writeJson(contractsPath, {
      version: "test",
      contracts: [buildContract("indeed_search"), buildContract("google_search")]
    });
    writeJson(capturePathEnabled, {
      sourceId: "enabled-indeed",
      capturedAt: "2026-03-07T00:00:00.000Z",
      jobs: [{ title: "PM", company: "Acme", location: "Remote", salaryText: "$200k" }]
    });
    writeJson(capturePathDisabled, {
      sourceId: "disabled-google",
      capturedAt: "2026-03-07T00:00:00.000Z",
      jobs: [{ title: "PM", company: "Acme", location: "Remote", salaryText: "$200k" }]
    });

    const report = evaluateSourceContractDrift({
      sourcesPath,
      contractsPath,
      historyPath
    });
    assert.equal(report.rows.length, 1);
    assert.equal(report.rows[0].sourceId, "enabled-indeed");

    const includeDisabledReport = evaluateSourceContractDrift({
      sourcesPath,
      contractsPath,
      historyPath,
      includeDisabled: true
    });
    assert.equal(includeDisabledReport.rows.length, 2);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
