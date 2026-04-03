import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  normalizeAllSourceSearchUrls,
  previewNormalizedSourceSearchUrls
} from "../src/config/load-config.js";

function createTempSourcesFile(sources) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-url-preview-"));
  const configDir = path.join(tempDir, "config");
  fs.mkdirSync(configDir, { recursive: true });
  const sourcesPath = path.join(configDir, "sources.json");

  fs.writeFileSync(sourcesPath, `${JSON.stringify({ sources }, null, 2)}\n`, "utf8");

  return {
    tempDir,
    sourcesPath
  };
}

test("previewNormalizedSourceSearchUrls reports URL changes without mutating file", () => {
  const initialSource = {
    id: "indeed-ai",
    name: "Indeed AI",
    type: "indeed_search",
    enabled: true,
    searchUrl: "https://www.indeed.com/jobs",
    searchCriteria: {
      keywords: "product manager ai",
      location: "San Francisco, CA",
      distanceMiles: 25,
      minSalary: 195000,
      datePosted: "1w"
    }
  };

  const { tempDir, sourcesPath } = createTempSourcesFile([initialSource]);

  try {
    const beforeText = fs.readFileSync(sourcesPath, "utf8");

    const preview = previewNormalizedSourceSearchUrls(sourcesPath);

    assert.equal(preview.changed, 1);
    assert.equal(preview.sources.length, 1);
    assert.equal(preview.sources[0].id, "indeed-ai");
    assert.equal(preview.sources[0].changed, true);

    const parsed = new URL(preview.sources[0].nextSearchUrl);
    assert.equal(parsed.searchParams.get("q"), "product manager ai");
    assert.equal(parsed.searchParams.get("l"), "San Francisco, CA");
    assert.equal(parsed.searchParams.get("radius"), "25");
    assert.equal(parsed.searchParams.get("salaryType"), "$195,000+");
    assert.equal(parsed.searchParams.get("fromage"), "7");
    assert.deepEqual(preview.sources[0].criteriaAccountability, {
      appliedInUrl: ["keywords", "location", "distanceMiles", "datePosted", "minSalary"],
      appliedInUiBootstrap: [],
      appliedPostCapture: [],
      unsupported: []
    });

    const afterText = fs.readFileSync(sourcesPath, "utf8");
    assert.equal(afterText, beforeText);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("preview/normalize map mode are non-mutating and return generated runtime URLs", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-url-preview-map-"));
  const configDir = path.join(tempDir, "config");
  const sourcesPath = path.join(configDir, "sources.json");
  const criteriaPath = path.join(configDir, "source-criteria.json");
  fs.mkdirSync(configDir, { recursive: true });

  try {
    fs.writeFileSync(
      sourcesPath,
      `${JSON.stringify(
        {
          sources: {
            "linkedin-live-capture": true,
            "indeed-ai-pm": true
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    fs.writeFileSync(
      criteriaPath,
      `${JSON.stringify(
        {
          title: "senior product manager",
          keywords: "ai fintech",
          location: "San Francisco, CA",
          minSalary: 200000,
          datePosted: "1w"
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const beforeText = fs.readFileSync(sourcesPath, "utf8");
    const preview = previewNormalizedSourceSearchUrls(sourcesPath, {
      searchCriteriaPath: criteriaPath
    });
    const normalized = normalizeAllSourceSearchUrls(sourcesPath, {
      searchCriteriaPath: criteriaPath
    });

    assert.equal(preview.changed, 0);
    assert.ok(preview.sources.length > 0);
    assert.equal(preview.sources[0].changed, false);
    assert.match(preview.sources[0].notes.join(" "), /runtime/i);

    const linkedin = normalized.sources.find((source) => source.id === "linkedin-live-capture");
    assert.ok(linkedin);
    const linkedinUrl = new URL(linkedin.searchUrl);
    assert.equal(linkedinUrl.searchParams.get("keywords"), "senior product manager ai fintech");

    assert.equal(normalized.changed, 0);
    const afterText = fs.readFileSync(sourcesPath, "utf8");
    assert.equal(afterText, beforeText);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
