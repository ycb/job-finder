import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { evaluateSourceContractDrift } from "../src/sources/source-contracts.js";

function createTempWorkspace(prefix = "job-finder-full-jd-gate-") {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    tempDir,
    sourcesPath: path.join(tempDir, "sources.json"),
    contractsPath: path.join(tempDir, "source-contracts.json"),
    historyPath: path.join(tempDir, "source-coverage-history.json"),
    capturePath: path.join(tempDir, "capture.json")
  };
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

function buildContract(sourceType) {
  return {
    sourceType,
    contractVersion: "1.0.0",
    lastVerified: "2026-04-06",
    criteriaMapping: {},
    extraction: {
      requiredFields: ["title"],
      fullJobDescription: "partial"
    },
    expectedCountStrategy: "none",
    paginationStrategy: "single_page"
  };
}

function buildJob(title, descriptionSource) {
  return {
    title,
    description: "Full job description content",
    extractorProvenance: {
      description: descriptionSource
    }
  };
}

test("evaluateSourceContractDrift computes detail-description coverage and fails the >=0.9 gate", () => {
  const { tempDir, sourcesPath, contractsPath, historyPath, capturePath } =
    createTempWorkspace("job-finder-detail-gate-fail-");

  try {
    writeJson(sourcesPath, {
      sources: [buildSource("indeed-main", "indeed_search", capturePath)]
    });
    writeJson(contractsPath, {
      version: "test",
      contracts: [buildContract("indeed_search")]
    });
    writeJson(capturePath, {
      sourceId: "indeed-main",
      capturedAt: "2026-04-06T20:00:00.000Z",
      jobs: [
        buildJob("AI Product Manager", "detail"),
        buildJob("Senior Product Manager", "detail"),
        buildJob("Product Manager", "card")
      ]
    });

    const report = evaluateSourceContractDrift({
      sourcesPath,
      contractsPath,
      historyPath,
      window: 3,
      minCoverage: 0.9
    });

    const row = report.rows.find((entry) => entry.sourceId === "indeed-main");
    assert.ok(row, "expected indeed row");
    assert.equal(row.detailDescriptionCoverage, 0.667);
    assert.equal(row.rollingDetailDescriptionCoverage, 0.667);
    assert.equal(row.detailDescriptionSampleSize, 3);
    assert.equal(row.passDetailCoverageGate, false);
    assert.equal(row.passCoverageGate, false);
    assert.equal(row.status, "error");
    assert.ok(
      row.issues.some((issue) => issue.includes("detail-description coverage below")),
      "expected detail coverage gate diagnostic"
    );

    const history = JSON.parse(fs.readFileSync(historyPath, "utf8"));
    const entries = history.bySource["indeed-main"];
    assert.ok(Array.isArray(entries));
    assert.equal(entries[0].detailDescriptionCoverage, 0.667);
    assert.equal(entries[0].detailDescriptionSampleSize, 3);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("evaluateSourceContractDrift passes detail-description gate when rolling window reaches >=0.9", () => {
  const { tempDir, sourcesPath, contractsPath, historyPath, capturePath } =
    createTempWorkspace("job-finder-detail-gate-pass-");

  try {
    const now = Date.now();
    writeJson(sourcesPath, {
      sources: [buildSource("zip-main", "ziprecruiter_search", capturePath)]
    });
    writeJson(contractsPath, {
      version: "test",
      contracts: [buildContract("ziprecruiter_search")]
    });
    writeJson(historyPath, {
      version: "1.0.0",
      bySource: {
        "zip-main": [
          {
            sourceType: "ziprecruiter_search",
            contractVersion: "1.0.0",
            capturedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
            sampleSize: 20,
            coverageByField: {
              title: 1
            },
            detailDescriptionCoverage: 1,
            detailDescriptionSampleSize: 20
          },
          {
            sourceType: "ziprecruiter_search",
            contractVersion: "1.0.0",
            capturedAt: new Date(now - 60 * 60 * 1000).toISOString(),
            sampleSize: 20,
            coverageByField: {
              title: 1
            },
            detailDescriptionCoverage: 0.8,
            detailDescriptionSampleSize: 20
          }
        ]
      }
    });

    const jobs = [];
    for (let index = 0; index < 10; index += 1) {
      jobs.push(
        buildJob(`Role ${index}`, index < 9 ? "detail" : "card")
      );
    }

    writeJson(capturePath, {
      sourceId: "zip-main",
      capturedAt: new Date(now).toISOString(),
      jobs
    });

    const report = evaluateSourceContractDrift({
      sourcesPath,
      contractsPath,
      historyPath,
      window: 3,
      minCoverage: 0.9
    });
    const row = report.rows.find((entry) => entry.sourceId === "zip-main");
    assert.ok(row, "expected zip row");
    assert.equal(row.detailDescriptionCoverage, 0.9);
    assert.equal(row.rollingDetailDescriptionCoverage, 0.9);
    assert.equal(row.detailDescriptionSampleSize, 10);
    assert.equal(row.passDetailCoverageGate, true);
    assert.equal(row.passCoverageGate, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
