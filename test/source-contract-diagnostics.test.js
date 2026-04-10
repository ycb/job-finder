import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  evaluateSourceContractDrift,
  runSourceContractDiagnostics
} from "../src/sources/source-contracts.js";

const today = new Date().toISOString().slice(0, 10);

function createTempWorkspace(prefix = "job-finder-contract-diagnostics-") {
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

test("evaluateSourceContractDrift includes field-level coverage mismatch context", () => {
  const { tempDir, sourcesPath, contractsPath, historyPath } = createTempWorkspace();
  const capturePath = path.join(tempDir, "indeed.json");
  const nowIso = new Date().toISOString();

  try {
    writeJson(sourcesPath, {
      sources: [buildSource("indeed-main", "indeed_search", capturePath)]
    });
    writeJson(contractsPath, {
      version: "test",
      contracts: [
        buildContract("indeed_search", {
          requiredFields: ["salaryText"],
          lastVerified: today
        })
      ]
    });
    writeJson(capturePath, {
      sourceId: "indeed-main",
      capturedAt: nowIso,
      jobs: [{ salaryText: "" }, { salaryText: "unknown" }]
    });

    const report = evaluateSourceContractDrift({
      sourcesPath,
      contractsPath,
      staleAfterDays: 30,
      historyPath
    });
    const row = report.rows.find((entry) => entry.sourceId === "indeed-main");

    assert.ok(row);
    assert.equal(row.status, "error");
    assert.ok(Array.isArray(row.coverageMismatches));
    assert.equal(row.coverageMismatches.length, 1);
    assert.equal(row.coverageMismatches[0].field, "salaryText");
    assert.equal(row.coverageMismatches[0].threshold, 0.9);
    assert.equal(row.coverageMismatches[0].rollingCoverage, 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("evaluateSourceContractDrift reports healthy captures with no mismatches", () => {
  const { tempDir, sourcesPath, contractsPath, historyPath } = createTempWorkspace();
  const capturePath = path.join(tempDir, "indeed-healthy.json");
  const nowIso = new Date().toISOString();

  try {
    writeJson(sourcesPath, {
      sources: [buildSource("indeed-main", "indeed_search", capturePath)]
    });
    writeJson(contractsPath, {
      version: "test",
      contracts: [
        buildContract("indeed_search", {
          requiredFields: ["salaryText"],
          lastVerified: today
        })
      ]
    });
    writeJson(capturePath, {
      sourceId: "indeed-main",
      capturedAt: nowIso,
      jobs: [{ salaryText: "$250k" }, { salaryText: "$225k" }]
    });

    const report = evaluateSourceContractDrift({
      sourcesPath,
      contractsPath,
      staleAfterDays: 30,
      historyPath
    });
    const row = report.rows.find((entry) => entry.sourceId === "indeed-main");

    assert.ok(row);
    assert.equal(row.status, "ok");
    assert.deepEqual(row.coverageMismatches, []);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("runSourceContractDiagnostics persists latest diagnostics artifact", () => {
  const { tempDir, sourcesPath, contractsPath, historyPath } = createTempWorkspace();
  const capturePath = path.join(tempDir, "indeed.json");
  const diagnosticsDir = path.join(tempDir, "diagnostics");
  const nowIso = new Date().toISOString();

  try {
    writeJson(sourcesPath, {
      sources: [buildSource("indeed-main", "indeed_search", capturePath)]
    });
    writeJson(contractsPath, {
      version: "test",
      contracts: [
        buildContract("indeed_search", {
          requiredFields: ["salaryText"],
          lastVerified: today
        })
      ]
    });
    writeJson(capturePath, {
      sourceId: "indeed-main",
      capturedAt: nowIso,
      jobs: [{ salaryText: "" }, { salaryText: "unknown" }]
    });

    const result = runSourceContractDiagnostics({
      sourcesPath,
      contractsPath,
      staleAfterDays: 30,
      historyPath,
      rootDir: diagnosticsDir
    });

    assert.ok(result?.diagnostics?.latestPath);
    assert.equal(fs.existsSync(result.diagnostics.latestPath), true);

    const latest = JSON.parse(fs.readFileSync(result.diagnostics.latestPath, "utf8"));
    assert.ok(Array.isArray(latest.rows));
    assert.equal(latest.rows.length, 1);
    assert.equal(latest.rows[0].status, "error");
    assert.ok(Array.isArray(latest.rows[0].coverageMismatches));
    assert.equal(latest.rows[0].coverageMismatches[0].field, "salaryText");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
