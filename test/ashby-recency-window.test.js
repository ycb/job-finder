import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  addAshbySearchSource,
  updateSourceDefinition
} from "../src/config/load-config.js";

function createTempSourcesFile(initialSources = []) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-ashby-recency-"));
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

function readSource(sourcesPath, sourceId) {
  const payload = JSON.parse(fs.readFileSync(sourcesPath, "utf8"));
  return payload.sources.find((source) => source.id === sourceId) || null;
}

test("addAshbySearchSource defaults recencyWindow to 1m and applies Google tbs=qdr:m", () => {
  const { tempDir, sourcesPath } = createTempSourcesFile();

  try {
    const source = addAshbySearchSource(
      "Ashby Discovery",
      "https://www.google.com/search?q=site%3Aashbyhq.com+%22product+manager%22+%22San+Francisco%22+%22AI%22",
      sourcesPath
    );

    assert.equal(source.type, "ashby_search");
    assert.equal(source.recencyWindow, "1m");
    assert.match(source.searchUrl, /[?&]tbs=qdr%3Am|[?&]tbs=qdr:m/i);

    const stored = readSource(sourcesPath, source.id);
    assert.equal(stored.recencyWindow, "1m");
    assert.match(String(stored.searchUrl), /[?&]tbs=qdr%3Am|[?&]tbs=qdr:m/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("updateSourceDefinition changes Ashby recencyWindow and rewrites tbs query parameter", () => {
  const { tempDir, sourcesPath } = createTempSourcesFile();
  fs.mkdirSync(path.join(tempDir, "captures"), { recursive: true });
  fs.writeFileSync(
    sourcesPath,
    `${JSON.stringify({
      sources: [
        {
          id: "ashby-source",
          name: "Ashby Discovery",
          type: "ashby_search",
          enabled: true,
          recencyWindow: "1m",
          searchUrl:
            "https://www.google.com/search?q=site%3Aashbyhq.com+%22product+manager%22&newwindow=1&tbs=qdr:m",
          capturePath: path.join(tempDir, "captures", "ashby-source.json")
        }
      ]
    }, null, 2)}\n`,
    "utf8"
  );

  try {
    const weekly = updateSourceDefinition(
      "ashby-source",
      {
        recencyWindow: "1w"
      },
      sourcesPath
    );
    assert.equal(weekly.recencyWindow, "1w");
    assert.match(weekly.searchUrl, /[?&]tbs=qdr(?::|%3A)w/i);

    const anyTime = updateSourceDefinition(
      "ashby-source",
      {
        recencyWindow: "any"
      },
      sourcesPath
    );
    assert.equal(anyTime.recencyWindow, "any");
    assert.doesNotMatch(anyTime.searchUrl, /[?&]tbs=qdr(?::|%3A)(d|w|m)/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
