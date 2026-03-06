import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  addGoogleSearchSource,
  updateSourceDefinition
} from "../src/config/load-config.js";

function createTempSourcesFile(initialSources = []) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-google-recency-"));
  const configDir = path.join(tempDir, "config");
  fs.mkdirSync(configDir, { recursive: true });
  const sourcesPath = path.join(configDir, "sources.json");

  fs.writeFileSync(
    sourcesPath,
    `${JSON.stringify({ sources: initialSources }, null, 2)}\n`,
    "utf8"
  );

  return {
    tempDir,
    sourcesPath
  };
}

test("addGoogleSearchSource defaults recencyWindow to 1w and applies Google tbs=qdr:w", () => {
  const { tempDir, sourcesPath } = createTempSourcesFile();

  try {
    const source = addGoogleSearchSource(
      "Google AI PM",
      "https://www.google.com/search?q=ai+product+manager+san+francisco",
      sourcesPath
    );

    assert.equal(source.type, "google_search");
    assert.equal(source.recencyWindow, "1w");
    assert.match(source.searchUrl, /[?&]tbs=qdr(?::|%3A)w/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("updateSourceDefinition changes Google recencyWindow and rewrites tbs query parameter", () => {
  const { tempDir, sourcesPath } = createTempSourcesFile([
    {
      id: "google-ai",
      name: "Google AI PM",
      type: "google_search",
      enabled: true,
      recencyWindow: "1w",
      searchUrl: "https://www.google.com/search?q=ai+product+manager+san+francisco&tbs=qdr:w"
    }
  ]);

  try {
    const daily = updateSourceDefinition(
      "google-ai",
      {
        recencyWindow: "1d"
      },
      sourcesPath
    );
    assert.equal(daily.recencyWindow, "1d");
    assert.match(daily.searchUrl, /[?&]tbs=qdr(?::|%3A)d/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

