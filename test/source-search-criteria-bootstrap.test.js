import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadSourcesWithPath } from "../src/config/load-config.js";

function createTempSourcesFile(sources) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-search-criteria-"));
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

test("loadSourcesWithPath derives URL for Indeed source with searchCriteria", () => {
  const { tempDir, sourcesPath } = createTempSourcesFile([
    {
      id: "indeed-ai",
      name: "Indeed AI",
      type: "indeed_search",
      enabled: true,
      searchUrl: "https://www.indeed.com/jobs",
      searchCriteria: {
        title: "senior product manager",
        keywords: "fintech payments",
        location: "San Francisco, CA",
        distanceMiles: 25,
        minSalary: 195000,
        datePosted: "1w"
      }
    }
  ]);

  try {
    const loaded = loadSourcesWithPath(sourcesPath);
    const source = loaded.sources[0];
    const parsed = new URL(source.searchUrl);

    assert.equal(parsed.searchParams.get("q"), "senior product manager fintech payments");
    assert.equal(parsed.searchParams.get("l"), "San Francisco, CA");
    assert.equal(parsed.searchParams.get("radius"), "25");
    assert.equal(parsed.searchParams.get("salaryType"), "$195,000");
    assert.equal(parsed.searchParams.get("fromage"), "7");
    assert.deepEqual(source.criteriaAccountability, {
      appliedInUrl: [
        "title",
        "keywords",
        "location",
        "distanceMiles",
        "datePosted",
        "minSalary"
      ],
      appliedInUiBootstrap: [],
      appliedPostCapture: [],
      unsupported: []
    });
    assert.deepEqual(source.formatterDiagnostics, {
      unsupported: [],
      notes: []
    });

    const persisted = JSON.parse(fs.readFileSync(sourcesPath, "utf8"));
    assert.deepEqual(persisted.sources[0].criteriaAccountability, {
      appliedInUrl: [
        "title",
        "keywords",
        "location",
        "distanceMiles",
        "datePosted",
        "minSalary"
      ],
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

test("loadSourcesWithPath derives Google recencyWindow from searchCriteria.datePosted", () => {
  const { tempDir, sourcesPath } = createTempSourcesFile([
    {
      id: "google-ai",
      name: "Google AI",
      type: "google_search",
      enabled: true,
      searchUrl: "https://www.google.com/search?q=placeholder",
      searchCriteria: {
        title: "principal product manager",
        keywords: "b2b saas",
        location: "San Francisco",
        datePosted: "3d"
      }
    }
  ]);

  try {
    const loaded = loadSourcesWithPath(sourcesPath);
    const source = loaded.sources[0];
    const parsed = new URL(source.searchUrl);

    assert.equal(source.recencyWindow, "1w");
    assert.equal(parsed.searchParams.get("tbs"), "qdr:w");
    assert.match(String(parsed.searchParams.get("q")), /principal product manager/i);
    assert.match(String(parsed.searchParams.get("q")), /b2b saas/i);
    assert.match(String(parsed.searchParams.get("q")), /San Francisco/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("loadSourcesWithPath derives LinkedIn classic URL params from searchCriteria", () => {
  const { tempDir, sourcesPath } = createTempSourcesFile([
    {
      id: "linkedin-ai",
      name: "LinkedIn AI",
      type: "linkedin_capture_file",
      enabled: true,
      searchUrl:
        "https://www.linkedin.com/jobs/search/?geoId=90000084&origin=JOB_SEARCH_PAGE_JOB_FILTER&refresh=true",
      capturePath: "/tmp/linkedin-ai-capture.json",
      searchCriteria: {
        title: "ai product manager",
        location: "San Francisco Bay Area",
        distanceMiles: 25,
        minSalary: 200000,
        datePosted: "1w",
        experienceLevel: "senior"
      }
    }
  ]);

  try {
    const loaded = loadSourcesWithPath(sourcesPath);
    const source = loaded.sources[0];
    const parsed = new URL(source.searchUrl);

    assert.equal(parsed.pathname, "/jobs/search/");
    assert.equal(parsed.searchParams.get("keywords"), "ai product manager");
    assert.equal(parsed.searchParams.get("location"), "San Francisco Bay Area");
    assert.equal(parsed.searchParams.get("distance"), "25");
    assert.equal(parsed.searchParams.get("f_TPR"), "r604800");
    assert.equal(parsed.searchParams.get("f_E"), "4");
    assert.equal(parsed.searchParams.get("f_SB2"), "9");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
