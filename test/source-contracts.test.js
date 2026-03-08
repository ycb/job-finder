import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadSourceContracts } from "../src/sources/source-contracts.js";

test("loadSourceContracts parses configured contracts", () => {
  const loaded = loadSourceContracts();
  assert.ok(loaded.contracts.length > 0);
  assert.ok(loaded.byType.has("linkedin_capture_file"));
  assert.ok(loaded.byType.has("indeed_search"));
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
