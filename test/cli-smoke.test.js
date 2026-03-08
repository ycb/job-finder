import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CLI_PATH = path.join(REPO_ROOT, "src/cli.js");

test("cli help exits successfully", () => {
  const result = spawnSync("node", ["src/cli.js", "help"], {
    cwd: REPO_ROOT,
    env: process.env,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || "Expected CLI help to exit 0");
  assert.match(result.stdout, /job-finder - Local-first job search/i);
});

test("cli doctor exits successfully even without sources config", () => {
  const result = spawnSync("node", ["src/cli.js", "doctor"], {
    cwd: REPO_ROOT,
    env: process.env,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || "Expected doctor to exit 0");
  assert.match(result.stdout, /Environment:/i);
});

test("cli init accepts install channel and analytics consent flags", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-cli-init-"));
  try {
    const result = spawnSync(
      "node",
      [CLI_PATH, "init", "--channel", "codex", "--analytics", "no", "--non-interactive"],
      {
        cwd: tempDir,
        env: process.env,
        encoding: "utf8"
      }
    );

    assert.equal(result.status, 0, result.stderr || "Expected init to exit 0");
    const settingsPath = path.join(tempDir, "data/user-settings.json");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    assert.equal(settings.onboarding.channel.value, "codex");
    assert.equal(settings.analytics.enabled, false);
    assert.match(result.stdout, /Install channel:\s+codex/i);
    assert.match(result.stdout, /Anonymous metrics:\s+disabled/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("cli init rejects invalid install channel", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-cli-init-invalid-"));
  try {
    const result = spawnSync(
      "node",
      [CLI_PATH, "init", "--channel", "discord", "--non-interactive"],
      {
        cwd: tempDir,
        env: process.env,
        encoding: "utf8"
      }
    );
    assert.notEqual(result.status, 0, "Expected init to fail with invalid channel");
    assert.match(
      result.stderr,
      /Invalid install channel "discord"/i
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
