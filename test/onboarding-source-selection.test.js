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
