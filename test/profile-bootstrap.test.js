import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadProfile } from "../src/config/load-config.js";

function withTempCwd(tempDir, fn) {
  const previousCwd = process.cwd();
  process.chdir(tempDir);
  try {
    return fn();
  } finally {
    process.chdir(previousCwd);
  }
}

test("loadProfile bootstraps config/profile.json from profile.example.json when missing", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-profile-bootstrap-"));
  const configDir = path.join(tempDir, "config");
  fs.mkdirSync(configDir, { recursive: true });

  try {
    fs.writeFileSync(
      path.join(configDir, "profile.example.json"),
      `${JSON.stringify(
        {
          candidateName: "Sample Candidate",
          resumePath: "resume.md"
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const profile = withTempCwd(tempDir, () => loadProfile("config/profile.json"));
    assert.equal(profile.candidateName, "Sample Candidate");
    assert.equal(profile.resumePath, "resume.md");
    assert.equal(fs.existsSync(path.join(configDir, "profile.json")), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
