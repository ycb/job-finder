import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  loadSourceContracts,
  resolveSourceContract
} from "../src/sources/source-contracts.js";

test("loadSourceContracts parses configured contracts", () => {
  const loaded = loadSourceContracts();
  assert.ok(loaded.contracts.length > 0);
  assert.ok(loaded.byType.has("linkedin_capture_file"));
  assert.ok(loaded.byType.has("indeed_search"));
  assert.ok(loaded.byType.has("levelsfyi_search"));
  assert.ok(loaded.byType.has("yc_jobs"));
  const linkedIn = loaded.byType.get("linkedin_capture_file");
  assert.ok(linkedIn.searchParameterShape);
  assert.ok(Array.isArray(linkedIn.searchParameterShape.supported));
  assert.ok(Array.isArray(linkedIn.searchParameterShape.required));
  assert.ok(Array.isArray(linkedIn.searchParameterShape.optional));
  assert.ok(Array.isArray(linkedIn.searchParameterShape.uiDrivenOnly));
  assert.ok(linkedIn.extraction.qualityThresholds);
  assert.ok(Array.isArray(linkedIn.extraction.requiredMetadata));
  assert.ok(Array.isArray(linkedIn.extraction.optionalMetadata));
  assert.ok(linkedIn.searchParameterShape.supported.includes("title"));
  assert.equal(linkedIn.searchParameterShape.unsupported.includes("title"), false);
  const zip = loaded.byType.get("ziprecruiter_search");
  assert.ok(zip.searchParameterShape.supported.includes("hardIncludeTerms"));
  assert.ok(zip.searchParameterShape.supported.includes("includeTerms"));
  assert.ok(zip.searchParameterShape.supported.includes("keywordMode"));
  assert.ok(zip.searchParameterShape.supported.includes("excludeTerms"));
  const yc = loaded.byType.get("yc_jobs");
  assert.ok(yc.searchParameterShape.unsupported.includes("hardIncludeTerms"));
  assert.ok(yc.searchParameterShape.unsupported.includes("keywordMode"));
  assert.ok(yc.searchParameterShape.supported.includes("excludeTerms"));
});

test("loadSourceContracts rejects duplicate source type contracts", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-source-contracts-"));
  const contractsPath = path.join(tempDir, "source-contracts.json");

  try {
    fs.writeFileSync(
      contractsPath,
      JSON.stringify(
        {
          version: "test",
          contracts: [
            {
              sourceType: "indeed_search",
              contractVersion: "1.0.0",
              lastVerified: "2026-03-07",
              criteriaMapping: {},
              extraction: { requiredFields: ["title"] },
              expectedCountStrategy: "none",
              paginationStrategy: "none"
            },
            {
              sourceType: "indeed_search",
              contractVersion: "1.0.1",
              lastVerified: "2026-03-07",
              criteriaMapping: {},
              extraction: { requiredFields: ["title"] },
              expectedCountStrategy: "none",
              paginationStrategy: "none"
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    assert.throws(() => loadSourceContracts(contractsPath));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("loadSourceContracts rejects unsupported criteria mapping modes", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-source-contracts-"));
  const contractsPath = path.join(tempDir, "source-contracts.json");

  try {
    fs.writeFileSync(
      contractsPath,
      JSON.stringify(
        {
          version: "test",
          contracts: [
            {
              sourceType: "indeed_search",
              contractVersion: "1.0.0",
              lastVerified: "2026-03-07",
              criteriaMapping: {
                title: "url",
                location: "totally_invalid_mode"
              },
              extraction: { requiredFields: ["title"] },
              expectedCountStrategy: "none",
              paginationStrategy: "none"
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    assert.throws(() => loadSourceContracts(contractsPath));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("loadSourceContracts rejects overlapping search parameter buckets", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-source-contracts-"));
  const contractsPath = path.join(tempDir, "source-contracts.json");

  try {
    fs.writeFileSync(
      contractsPath,
      JSON.stringify(
        {
          version: "test",
          contracts: [
            {
              sourceType: "indeed_search",
              criteriaMapping: {
                title: "url"
              },
              searchParameterShape: {
                required: ["title"],
                optional: ["title"],
                uiDrivenOnly: [],
                supported: ["title"]
              },
              extraction: {
                requiredFields: ["title"]
              }
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    assert.throws(() => loadSourceContracts(contractsPath));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("resolveSourceContract prefers sourceId-specific contract over type default", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-source-contracts-"));
  const contractsPath = path.join(tempDir, "source-contracts.json");

  try {
    fs.writeFileSync(
      contractsPath,
      JSON.stringify(
        {
          version: "test",
          contracts: [
            {
              sourceType: "indeed_search",
              contractVersion: "1.0.0",
              criteriaMapping: {
                title: "url"
              },
              extraction: {
                requiredFields: ["title"]
              }
            },
            {
              sourceType: "indeed_search",
              sourceId: "indeed-special",
              contractVersion: "1.1.0",
              criteriaMapping: {
                title: "url"
              },
              extraction: {
                requiredFields: ["title", "salaryText"]
              }
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    const loaded = loadSourceContracts(contractsPath);
    const specific = resolveSourceContract(loaded, {
      id: "indeed-special",
      type: "indeed_search"
    });
    const fallback = resolveSourceContract(loaded, {
      id: "indeed-default",
      type: "indeed_search"
    });

    assert.equal(specific.contractVersion, "1.1.0");
    assert.equal(fallback.contractVersion, "1.0.0");
    assert.deepEqual(specific.extraction.requiredFields, ["title", "salaryText"]);
    assert.deepEqual(fallback.extraction.requiredFields, ["title"]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("loadSourceContracts accepts YC Jobs and Levels.fyi source types", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-source-contracts-new-types-"));
  const contractsPath = path.join(tempDir, "source-contracts.json");

  try {
    fs.writeFileSync(
      contractsPath,
      JSON.stringify(
        {
          version: "test",
          contracts: [
            {
              sourceType: "yc_jobs",
              contractVersion: "1.0.0",
              lastVerified: "2026-03-07",
              criteriaMapping: {},
              extraction: { requiredFields: ["title"] },
              expectedCountStrategy: "none",
              paginationStrategy: "none"
            },
            {
              sourceType: "levelsfyi_search",
              contractVersion: "1.0.0",
              lastVerified: "2026-03-07",
              criteriaMapping: {},
              extraction: { requiredFields: ["title"] },
              expectedCountStrategy: "none",
              paginationStrategy: "none"
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    const loaded = loadSourceContracts(contractsPath);
    assert.ok(loaded.byType.has("yc_jobs"));
    assert.ok(loaded.byType.has("levelsfyi_search"));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
