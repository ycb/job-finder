import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  loadSearchCriteria,
  loadSourcesWithPath,
  saveSearchCriteria
} from "../src/config/load-config.js";

function createTempConfigDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-global-criteria-"));
  const configDir = path.join(tempDir, "config");
  fs.mkdirSync(configDir, { recursive: true });
  return {
    tempDir,
    configDir
  };
}

test("loadSearchCriteria returns empty criteria when file is missing", () => {
  const { tempDir, configDir } = createTempConfigDir();
  const criteriaPath = path.join(configDir, "search-criteria.json");

  try {
    const loaded = loadSearchCriteria(criteriaPath);
    assert.equal(loaded.path, path.resolve(criteriaPath));
    assert.deepEqual(loaded.criteria, {});
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("saveSearchCriteria persists normalized fields", () => {
  const { tempDir, configDir } = createTempConfigDir();
  const criteriaPath = path.join(configDir, "search-criteria.json");

  try {
    const saved = saveSearchCriteria(
      {
        title: "senior product manager",
        keywords: "ai fintech",
        location: "San Francisco, CA",
        minSalary: 195000.4,
        datePosted: "1W"
      },
      criteriaPath
    );

    assert.equal(saved.criteria.title, "senior product manager");
    assert.equal(saved.criteria.keywords, "ai fintech");
    assert.equal(saved.criteria.location, "San Francisco, CA");
    assert.equal(saved.criteria.minSalary, 195000);
    assert.equal(saved.criteria.datePosted, "1w");

    const reloaded = loadSearchCriteria(criteriaPath);
    assert.deepEqual(reloaded.criteria, saved.criteria);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("saveSearchCriteria normalizes comma-separated keywords", () => {
  const { tempDir, configDir } = createTempConfigDir();
  const criteriaPath = path.join(configDir, "search-criteria.json");

  try {
    const saved = saveSearchCriteria(
      {
        keywords: "ai, fintech, payments, fintech,  "
      },
      criteriaPath
    );

    assert.equal(saved.criteria.keywords, "ai, fintech, payments");

    const reloaded = loadSearchCriteria(criteriaPath);
    assert.equal(reloaded.criteria.keywords, "ai, fintech, payments");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("loadSourcesWithPath applies global search criteria and allows per-source overrides", () => {
  const { tempDir, configDir } = createTempConfigDir();
  const criteriaPath = path.join(configDir, "search-criteria.json");
  const sourcesPath = path.join(configDir, "sources.json");

  try {
    fs.writeFileSync(
      criteriaPath,
      `${JSON.stringify(
        {
          title: "senior product manager",
          keywords: "fintech payments",
          location: "San Francisco, CA",
          distanceMiles: 25,
          minSalary: 195000,
          datePosted: "1w"
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    fs.writeFileSync(
      sourcesPath,
      `${JSON.stringify(
        {
          sources: [
            {
              id: "indeed-global",
              name: "Indeed Global Criteria",
              type: "indeed_search",
              enabled: true,
              searchUrl: "https://www.indeed.com/jobs"
            },
            {
              id: "indeed-override",
              name: "Indeed Override",
              type: "indeed_search",
              enabled: true,
              searchUrl: "https://www.indeed.com/jobs",
              searchCriteria: {
                keywords: "b2b saas"
              }
            }
          ]
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const loaded = loadSourcesWithPath(sourcesPath, {
      searchCriteriaPath: criteriaPath
    });

    const globalSource = loaded.sources.find((source) => source.id === "indeed-global");
    assert.ok(globalSource);
    const globalUrl = new URL(globalSource.searchUrl);
    assert.equal(globalUrl.searchParams.get("q"), "senior product manager fintech payments");
    assert.equal(globalUrl.searchParams.get("l"), "San Francisco, CA");
    assert.equal(globalUrl.searchParams.get("radius"), "25");
    assert.equal(globalUrl.searchParams.get("salaryType"), "$195,000");
    assert.equal(globalUrl.searchParams.get("fromage"), "7");

    const overrideSource = loaded.sources.find((source) => source.id === "indeed-override");
    assert.ok(overrideSource);
    const overrideUrl = new URL(overrideSource.searchUrl);
    assert.equal(overrideUrl.searchParams.get("q"), "senior product manager b2b saas");
    assert.equal(overrideUrl.searchParams.get("l"), "San Francisco, CA");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
