import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildSearchUrlForSourceType } from "../src/sources/search-url-builder.js";
import { loadSourcesWithPath } from "../src/config/load-config.js";

function createTempSourcesFile(sources) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-criteria-accountability-"));
  const configDir = path.join(tempDir, "config");
  fs.mkdirSync(configDir, { recursive: true });
  const sourcesPath = path.join(configDir, "sources.json");

  fs.writeFileSync(
    sourcesPath,
    `${JSON.stringify({ sources }, null, 2)}\n`,
    "utf8"
  );

  return {
    tempDir,
    sourcesPath
  };
}

function assertCriteriaPartitioning(result, expectedFields) {
  assert.ok(result.criteriaAccountability);
  const buckets = result.criteriaAccountability;
  const all = [
    ...(Array.isArray(buckets.appliedInUrl) ? buckets.appliedInUrl : []),
    ...(Array.isArray(buckets.appliedInUiBootstrap)
      ? buckets.appliedInUiBootstrap
      : []),
    ...(Array.isArray(buckets.appliedPostCapture)
      ? buckets.appliedPostCapture
      : []),
    ...(Array.isArray(buckets.unsupported) ? buckets.unsupported : [])
  ];
  assert.deepEqual(all.sort(), [...expectedFields].sort());
  assert.equal(new Set(all).size, all.length);
  assert.deepEqual(result.unsupported, buckets.unsupported);
}

test("criteriaAccountability assigns each provided criterion exactly once across source types", () => {
  const fullCriteria = {
    title: "principal product manager",
    keywords: "ai platform",
    location: "San Francisco, CA",
    distanceMiles: 25,
    minSalary: 200000,
    datePosted: "1w",
    experienceLevel: "senior"
  };
  const expectedFields = [
    "title",
    "keywords",
    "location",
    "distanceMiles",
    "minSalary",
    "datePosted",
    "experienceLevel"
  ];
  const sourceTypes = [
    "linkedin_capture_file",
    "builtin_search",
    "wellfound_search",
    "ashby_search",
    "google_search",
    "indeed_search",
    "ziprecruiter_search",
    "levelsfyi_search",
    "yc_jobs",
    "remoteok_search"
  ];

  for (const sourceType of sourceTypes) {
    const result = buildSearchUrlForSourceType(sourceType, fullCriteria);
    assertCriteriaPartitioning(result, expectedFields);
  }
});

test("loadSourcesWithPath clears stale criteriaAccountability when no criteria are configured", () => {
  const { tempDir, sourcesPath } = createTempSourcesFile([
    {
      id: "indeed-stale",
      name: "Indeed stale",
      type: "indeed_search",
      enabled: true,
      searchUrl: "https://www.indeed.com/jobs?q=product+manager",
      criteriaAccountability: {
        appliedInUrl: ["title", "keywords"],
        appliedInUiBootstrap: [],
        appliedPostCapture: [],
        unsupported: ["experienceLevel"]
      },
      formatterDiagnostics: {
        unsupported: ["experienceLevel"],
        notes: ["legacy stale formatter note"]
      }
    }
  ]);

  try {
    const loaded = loadSourcesWithPath(sourcesPath);
    assert.deepEqual(loaded.sources[0].criteriaAccountability, {
      appliedInUrl: [],
      appliedInUiBootstrap: [],
      appliedPostCapture: [],
      unsupported: []
    });
    assert.deepEqual(loaded.sources[0].formatterDiagnostics, {
      unsupported: [],
      notes: []
    });

    const persisted = JSON.parse(fs.readFileSync(sourcesPath, "utf8"));
    assert.deepEqual(persisted.sources[0].criteriaAccountability, {
      appliedInUrl: [],
      appliedInUiBootstrap: [],
      appliedPostCapture: [],
      unsupported: []
    });
    assert.deepEqual(persisted.sources[0].formatterDiagnostics, {
      unsupported: [],
      notes: []
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ziprecruiter criteria accountability marks hard include terms as applied in URL", () => {
  const result = buildSearchUrlForSourceType("ziprecruiter_search", {
    title: "Product manager",
    hardIncludeTerms: ["ai"],
    location: "San Francisco, CA",
    datePosted: "3d",
    minSalary: 200000,
  });

  assert.equal(result.url.includes("days=3"), true);
  assert.equal(result.criteriaAccountability.appliedInUrl.includes("hardIncludeTerms"), true);
  assert.equal(result.criteriaAccountability.unsupported.includes("hardIncludeTerms"), false);
});

test("indeed criteria accountability marks hard include terms as applied in URL", () => {
  const result = buildSearchUrlForSourceType("indeed_search", {
    title: "Product manager",
    hardIncludeTerms: ["ai"],
    location: "San Francisco, CA",
    datePosted: "3d",
    minSalary: 200000
  });

  assert.equal(result.url.includes("fromage=3"), true);
  assert.equal(result.criteriaAccountability.appliedInUrl.includes("hardIncludeTerms"), true);
  assert.equal(result.criteriaAccountability.unsupported.includes("hardIncludeTerms"), false);
});

test("levelsfyi builder returns a real URL and truthful accountability", () => {
  const result = buildSearchUrlForSourceType("levelsfyi_search", {
    title: "Product manager",
    hardIncludeTerms: ["ai"],
    location: "San Francisco, CA",
    datePosted: "3d",
    minSalary: 200000,
    distanceMiles: 25
  });

  assert.match(result.url, /^https:\/\/www\.levels\.fyi\/jobs\/title\/product-manager\/location\/san-francisco-ca\?/);
  assert.equal(result.url.includes("postedAfterValue=3"), true);
  assert.equal(result.criteriaAccountability.appliedInUrl.includes("hardIncludeTerms"), true);
  assert.equal(result.criteriaAccountability.appliedInUrl.includes("datePosted"), true);
  assert.equal(result.criteriaAccountability.unsupported.includes("distanceMiles"), true);
});

test("yc jobs builder returns fixed route and marks dynamic criteria unsupported", () => {
  const result = buildSearchUrlForSourceType("yc_jobs", {
    title: "Product manager",
    hardIncludeTerms: ["ai"],
    location: "San Francisco, CA",
    datePosted: "3d"
  });

  assert.equal(
    result.url,
    "https://www.workatastartup.com/jobs/l/product-manager"
  );
  assert.deepEqual(
    result.criteriaAccountability.unsupported.sort(),
    ["datePosted", "hardIncludeTerms", "location", "title"].sort()
  );
});
