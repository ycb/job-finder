import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadSourcesWithPath } from "../src/config/load-config.js";

function createTempSourcesFile() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-sources-"));
  const configDir = path.join(tempDir, "config");
  fs.mkdirSync(configDir, { recursive: true });
  const sourcesPath = path.join(configDir, "sources.json");

  fs.writeFileSync(
    sourcesPath,
    `${JSON.stringify(
      {
        sources: [
          {
            id: "wf-ai",
            name: "Wellfound AI",
            type: "wellfound_search",
            enabled: true,
            searchUrl: "https://wellfound.com/jobs"
          }
        ]
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  return {
    tempDir,
    sourcesPath
  };
}

test("loadSourcesWithPath auto-provisions capturePath for legacy wellfound sources", () => {
  const { tempDir, sourcesPath } = createTempSourcesFile();

  try {
    const loaded = loadSourcesWithPath(sourcesPath);
    const source = loaded.sources[0];

    assert.equal(source.type, "wellfound_search");
    assert.ok(source.capturePath);
    assert.ok(fs.existsSync(source.capturePath));

    const capturePayload = JSON.parse(fs.readFileSync(source.capturePath, "utf8"));
    assert.equal(capturePayload.sourceId, "wf-ai");
    assert.equal(capturePayload.searchUrl, "https://wellfound.com/jobs");
    assert.deepEqual(capturePayload.jobs, []);

    const updatedSources = JSON.parse(fs.readFileSync(sourcesPath, "utf8"));
    assert.equal(updatedSources.sources[0].capturePath, source.capturePath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("loadSourcesWithPath auto-provisions capturePath for builtin sources", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-sources-"));
  const configDir = path.join(tempDir, "config");
  fs.mkdirSync(configDir, { recursive: true });
  const sourcesPath = path.join(configDir, "sources.json");

  fs.writeFileSync(
    sourcesPath,
    `${JSON.stringify(
      {
        sources: [
          {
            id: "builtin-ai",
            name: "Built In AI",
            type: "builtin_search",
            enabled: true,
            searchUrl:
              "https://www.builtinsf.com/jobs/product-management/product-manager?search=AI"
          }
        ]
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  try {
    const loaded = loadSourcesWithPath(sourcesPath);
    const source = loaded.sources[0];

    assert.equal(source.type, "builtin_search");
    assert.ok(source.capturePath);
    assert.ok(fs.existsSync(source.capturePath));

    const capturePayload = JSON.parse(fs.readFileSync(source.capturePath, "utf8"));
    assert.equal(capturePayload.sourceId, "builtin-ai");
    assert.deepEqual(capturePayload.jobs, []);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("loadSourcesWithPath auto-provisions capturePath for google and auth capture sources", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-sources-"));
  const configDir = path.join(tempDir, "config");
  fs.mkdirSync(configDir, { recursive: true });
  const sourcesPath = path.join(configDir, "sources.json");

  fs.writeFileSync(
    sourcesPath,
    `${JSON.stringify(
      {
        sources: [
          {
            id: "google-ai",
            name: "Google AI",
            type: "google_search",
            enabled: true,
            searchUrl: "https://www.google.com/search?q=ai+product+manager+san+francisco"
          },
          {
            id: "indeed-ai",
            name: "Indeed AI",
            type: "indeed_search",
            enabled: true,
            searchUrl: "https://www.indeed.com/jobs?q=product+manager+ai"
          }
        ]
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  try {
    const loaded = loadSourcesWithPath(sourcesPath);
    assert.equal(loaded.sources[0].type, "google_search");
    assert.equal(loaded.sources[0].recencyWindow, "1w");
    assert.ok(loaded.sources[0].capturePath);
    assert.ok(fs.existsSync(loaded.sources[0].capturePath));

    assert.equal(loaded.sources[1].type, "indeed_search");
    assert.ok(loaded.sources[1].capturePath);
    assert.ok(fs.existsSync(loaded.sources[1].capturePath));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
