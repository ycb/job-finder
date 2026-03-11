import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

test("npm pack payload includes TERMS.md and PRIVACY.md", () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-npm-pack-cache-"));
  try {
    const result = spawnSync("npm", ["pack", "--json", "--dry-run"], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        NPM_CONFIG_CACHE: cacheDir
      },
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr || "Expected npm pack --dry-run to exit 0");
    const payload = JSON.parse(result.stdout);
    const files = Array.isArray(payload) && payload[0] && Array.isArray(payload[0].files)
      ? payload[0].files.map((entry) => String(entry.path || ""))
      : [];

    assert.equal(
      files.includes("TERMS.md"),
      true,
      "TERMS.md must be published in npm package."
    );
    assert.equal(
      files.includes("PRIVACY.md"),
      true,
      "PRIVACY.md must be published in npm package."
    );
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});
