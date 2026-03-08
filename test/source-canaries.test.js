import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  evaluateSourceCanaries,
  loadSourceCanaries,
  writeSourceCanaryDiagnostics
} from "../src/sources/source-canaries.js";

function createTempWorkspace(prefix = "job-finder-canaries-") {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    tempDir,
    canariesPath: path.join(tempDir, "source-canaries.json")
  };
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

test("loadSourceCanaries parses definitions and indexes by source type", () => {
  const { tempDir, canariesPath } = createTempWorkspace();

  try {
    writeJson(canariesPath, {
      version: "1.0.0",
      canaries: [
        {
          id: "linkedin-default",
          sourceType: "linkedin_capture_file",
          checks: [{ kind: "min_samples", min: 10 }]
        }
      ]
    });

    const loaded = loadSourceCanaries(canariesPath);
    assert.equal(loaded.canaries.length, 1);
    assert.equal(loaded.bySourceType.get("linkedin_capture_file").id, "linkedin-default");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("evaluateSourceCanaries fails when required coverage falls below threshold", () => {
  const source = {
    id: "google-main",
    type: "google_search",
    name: "Google Main",
    searchUrl: "https://www.google.com/search?q=jobs"
  };

  const canaries = {
    canaries: [
      {
        id: "google-default",
        sourceType: "google_search",
        checks: [
          { kind: "min_samples", min: 3 },
          { kind: "required_coverage", min: 0.8, fields: ["title", "company", "url"] }
        ]
      }
    ],
    bySourceType: new Map([
      [
        "google_search",
        {
          id: "google-default",
          sourceType: "google_search",
          checks: [
            { kind: "min_samples", min: 3 },
            { kind: "required_coverage", min: 0.8, fields: ["title", "company", "url"] }
          ]
        }
      ]
    ]),
    bySourceId: new Map()
  };

  const result = evaluateSourceCanaries(source, {
    canaries,
    payload: {
      capturedAt: "2026-03-07T20:00:00.000Z",
      jobs: [
        { title: "A", company: "A", url: "https://example.com/a" },
        { title: "B", company: "", url: "" },
        { title: "", company: "C", url: "https://example.com/c" }
      ]
    }
  });

  assert.equal(result.status, "fail");
  assert.ok(result.checks.some((check) => check.pass === false));
  assert.ok(result.reasons.some((reason) => reason.includes("required coverage")));
});

test("writeSourceCanaryDiagnostics persists report artifacts", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-canary-report-"));

  try {
    const output = writeSourceCanaryDiagnostics(
      {
        generatedAt: "2026-03-07T20:00:00.000Z",
        rows: [{ sourceId: "linkedin-main", status: "pass", reasons: [] }]
      },
      { rootDir: tempDir }
    );

    assert.ok(fs.existsSync(output.latestPath));
    assert.ok(fs.existsSync(output.timestampedPath));

    const latest = JSON.parse(fs.readFileSync(output.latestPath, "utf8"));
    assert.equal(latest.rows.length, 1);
    assert.equal(latest.rows[0].status, "pass");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("evaluateSourceCanaries reports field-level diffs for expected_record checks", () => {
  const source = {
    id: "linkedin-main",
    type: "linkedin_capture_file",
    name: "LinkedIn Main",
    searchUrl: "https://www.linkedin.com/jobs/search"
  };

  const canaries = {
    canaries: [
      {
        id: "linkedin-canary",
        sourceType: "linkedin_capture_file",
        checks: [
          {
            kind: "expected_record",
            match: {
              field: "url",
              includes: "jobs/123"
            },
            expected: {
              title: { equals: "Senior Product Manager" },
              company: { equals: "ExpectedCo" }
            }
          }
        ]
      }
    ],
    bySourceType: new Map([
      [
        "linkedin_capture_file",
        {
          id: "linkedin-canary",
          sourceType: "linkedin_capture_file",
          checks: [
            {
              kind: "expected_record",
              match: {
                field: "url",
                includes: "jobs/123"
              },
              expected: {
                title: { equals: "Senior Product Manager" },
                company: { equals: "ExpectedCo" }
              }
            }
          ]
        }
      ]
    ]),
    bySourceId: new Map()
  };

  const result = evaluateSourceCanaries(source, {
    canaries,
    payload: {
      capturedAt: "2026-03-07T20:00:00.000Z",
      jobs: [
        {
          title: "Senior Product Manager",
          company: "ActualCo",
          url: "https://www.linkedin.com/jobs/123"
        }
      ]
    }
  });

  assert.equal(result.status, "fail");
  const expectedRecordCheck = result.checks.find(
    (check) => check.kind === "expected_record"
  );
  assert.ok(expectedRecordCheck, "expected expected_record check result");
  assert.equal(expectedRecordCheck.pass, false);
  assert.ok(Array.isArray(expectedRecordCheck.diffs));
  assert.ok(
    expectedRecordCheck.diffs.some((diff) => diff.field === "company"),
    "expected company diff"
  );
});
