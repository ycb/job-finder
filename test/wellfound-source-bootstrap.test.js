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
