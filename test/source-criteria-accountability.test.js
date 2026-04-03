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

test("loadSourcesWithPath preserves derived metadata in sources map mode", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-map-mode-sources-"));
  const configDir = path.join(tempDir, "config");
  fs.mkdirSync(configDir, { recursive: true });
  const sourcesPath = path.join(configDir, "sources.json");
  const criteriaPath = path.join(configDir, "source-criteria.json");

  fs.writeFileSync(
    sourcesPath,
    `${JSON.stringify({ sources: { "yc-product-jobs": true } }, null, 2)}\n`,
    "utf8"
  );
  fs.writeFileSync(
    criteriaPath,
    `${JSON.stringify({
      title: "Product manager",
      hardIncludeTerms: ["ai"],
      location: "San Francisco, CA",
      datePosted: "3d"
    }, null, 2)}\n`,
    "utf8"
  );

  try {
    const loaded = loadSourcesWithPath(sourcesPath);
    const yc = loaded.sources.find((source) => source.id === "yc-product-jobs");

    assert.ok(yc);
    assert.match(yc.searchUrl, /^https:\/\/www\.workatastartup\.com\/jobs\/l\/product-manager\?/);
    assert.deepEqual(yc.criteriaAccountability.appliedInUrl, ["title"]);
    assert.equal(yc.criteriaAccountability.appliedPostCapture.includes("hardIncludeTerms"), true);
    assert.equal(yc.criteriaAccountability.appliedPostCapture.includes("location"), true);
    assert.equal(yc.criteriaAccountability.appliedPostCapture.includes("datePosted"), true);
    assert.deepEqual(yc.formatterDiagnostics, {
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
    distanceMiles: 25,
    datePosted: "3d",
    minSalary: 200000,
  });

  assert.equal(result.url.includes("days=3"), false);
  assert.equal(result.url.includes("radius=25"), false);
  assert.equal(result.url.includes("refine_by_salary=200000"), false);
  assert.equal(result.criteriaAccountability.appliedInUrl.includes("hardIncludeTerms"), true);
  assert.equal(result.criteriaAccountability.unsupported.includes("hardIncludeTerms"), false);
  assert.equal(result.criteriaAccountability.appliedInUrl.includes("datePosted"), false);
  assert.equal(result.criteriaAccountability.appliedInUrl.includes("distanceMiles"), false);
  assert.equal(result.criteriaAccountability.appliedInUrl.includes("minSalary"), false);
  assert.equal(result.criteriaAccountability.appliedPostCapture.includes("datePosted"), true);
  assert.equal(result.criteriaAccountability.appliedPostCapture.includes("distanceMiles"), true);
  assert.equal(result.criteriaAccountability.appliedPostCapture.includes("minSalary"), true);
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
  assert.equal(result.url.includes("salaryType=%24200%2C000%2B"), true);
  assert.equal(result.url.includes("radius=0"), true);
  assert.equal(result.criteriaAccountability.appliedInUrl.includes("hardIncludeTerms"), true);
  assert.equal(result.criteriaAccountability.unsupported.includes("hardIncludeTerms"), false);
  assert.equal(result.criteriaAccountability.appliedInUrl.includes("datePosted"), true);
  assert.equal(result.criteriaAccountability.appliedInUrl.includes("minSalary"), true);
  assert.equal(result.criteriaAccountability.appliedPostCapture.includes("datePosted"), false);
  assert.equal(result.criteriaAccountability.appliedPostCapture.includes("minSalary"), false);
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

test("yc jobs builder carries browser bootstrap state and only leaves unsupported fields truly unsupported", () => {
  const result = buildSearchUrlForSourceType("yc_jobs", {
    title: "Product manager",
    hardIncludeTerms: ["ai"],
    location: "San Francisco, CA",
    datePosted: "3d"
  });

  assert.match(result.url, /^https:\/\/www\.workatastartup\.com\/jobs\/l\/product-manager\?/);
  assert.equal(result.criteriaAccountability.appliedInUrl.includes("title"), true);
  assert.equal(result.criteriaAccountability.appliedPostCapture.includes("hardIncludeTerms"), true);
  assert.equal(result.criteriaAccountability.appliedPostCapture.includes("location"), true);
  assert.equal(result.criteriaAccountability.appliedPostCapture.includes("datePosted"), true);
  assert.equal(result.criteriaAccountability.unsupported.includes("title"), false);
  assert.equal(result.criteriaAccountability.unsupported.includes("distanceMiles"), false);
});
