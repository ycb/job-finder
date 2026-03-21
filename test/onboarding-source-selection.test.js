import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadSourcesWithPath, setEnabledSources } from "../src/config/load-config.js";

function createTempSourcesConfig() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-onboarding-sources-"));
  const sourcesPath = path.join(tempDir, "sources.json");
  const payload = {
    sources: [
      {
        id: "linkedin",
        name: "LinkedIn",
        type: "linkedin_capture_file",
        enabled: true,
        searchUrl: "https://www.linkedin.com/jobs/search/?keywords=pm",
        capturePath: path.join(tempDir, "linkedin-capture.json")
      },
      {
        id: "indeed",
        name: "Indeed",
        type: "indeed_search",
        enabled: true,
        searchUrl: "https://www.indeed.com/jobs?q=pm"
      },
      {
        id: "google",
        name: "Google",
        type: "google_search",
        enabled: true,
        searchUrl: "https://www.google.com/search?q=product+manager"
      }
    ]
  };

  fs.writeFileSync(sourcesPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return { tempDir, sourcesPath };
}

function createTempSourcesMapConfig() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-onboarding-sources-map-"));
  const sourcesPath = path.join(tempDir, "sources.json");
  const payload = {
    sources: {
      "linkedin-live-capture": true,
      "indeed-ai-pm": true,
      "levelsfyi-ai-pm": false
    }
  };

  fs.writeFileSync(sourcesPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return { tempDir, sourcesPath };
}

function createTempSourcesMapWithLegacyOverridesConfig() {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "job-finder-onboarding-sources-map-overrides-")
  );
  const sourcesPath = path.join(tempDir, "sources.json");
  const payload = {
    sources: {
      "linkedin-live-capture": {
        enabled: true,
        name: "LinkedIn Lead Product Manager Search",
        searchUrl: "https://www.linkedin.com/jobs/search/?keywords=legacy+saved+search"
      }
    }
  };

  fs.writeFileSync(sourcesPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return { tempDir, sourcesPath };
}

test("setEnabledSources persists selected source ids", () => {
  const { tempDir, sourcesPath } = createTempSourcesConfig();
  try {
    const result = setEnabledSources(["linkedin", "google"], sourcesPath);
    assert.equal(typeof result.path, "string");

    const loaded = loadSourcesWithPath(sourcesPath).sources;
    assert.equal(loaded.find((source) => source.id === "linkedin")?.enabled, true);
    assert.equal(loaded.find((source) => source.id === "google")?.enabled, true);
    assert.equal(loaded.find((source) => source.id === "indeed")?.enabled, false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("setEnabledSources persists selected source ids in map mode", () => {
  const { tempDir, sourcesPath } = createTempSourcesMapConfig();
  try {
    const result = setEnabledSources(
      ["linkedin-live-capture", "levelsfyi-ai-pm"],
      sourcesPath
    );
    assert.equal(typeof result.path, "string");

    const persisted = JSON.parse(fs.readFileSync(sourcesPath, "utf8"));
    assert.equal(persisted.sources["linkedin-live-capture"], true);
    assert.equal(persisted.sources["indeed-ai-pm"], false);
    assert.equal(persisted.sources["levelsfyi-ai-pm"], true);

    const loaded = loadSourcesWithPath(sourcesPath).sources;
    assert.equal(
      loaded.find((source) => source.id === "linkedin-live-capture")?.enabled,
      true
    );
    assert.equal(
      loaded.find((source) => source.id === "levelsfyi-ai-pm")?.enabled,
      true
    );
    assert.equal(
      loaded.find((source) => source.id === "indeed-ai-pm")?.enabled,
      false
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("loadSourcesWithPath bootstraps sources.json when missing", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-onboarding-bootstrap-"));
  const sourcesPath = path.join(tempDir, "sources.json");

  try {
    const loaded = loadSourcesWithPath(sourcesPath);
    assert.ok(Array.isArray(loaded.sources));
    assert.ok(loaded.sources.length > 0);
    assert.equal(fs.existsSync(sourcesPath), true);

    const persisted = JSON.parse(fs.readFileSync(sourcesPath, "utf8"));
    assert.equal(typeof persisted.sources, "object");
    assert.equal(Array.isArray(persisted.sources), false);
    assert.equal(typeof persisted.sources["linkedin-live-capture"], "boolean");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("loadSourcesWithPath ignores legacy map overrides beyond enabled flag", () => {
  const { tempDir, sourcesPath } = createTempSourcesMapWithLegacyOverridesConfig();
  try {
    const loaded = loadSourcesWithPath(sourcesPath).sources;
    const linkedIn = loaded.find((source) => source.id === "linkedin-live-capture");
    assert.ok(linkedIn);
    assert.equal(linkedIn.name, "LinkedIn");
    assert.equal(linkedIn.searchUrl, "https://www.linkedin.com/jobs/search/");
    assert.equal(linkedIn.enabled, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
