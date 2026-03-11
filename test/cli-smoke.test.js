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

test("cli init accepts install channel and analytics flags", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-cli-init-"));
  try {
    const result = spawnSync(
      "node",
      [
        CLI_PATH,
        "init",
        "--channel",
        "codex",
        "--analytics",
        "no",
        "--non-interactive"
      ],
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
    assert.equal(settings.onboarding.consent.termsAccepted, false);
    assert.equal(settings.onboarding.consent.privacyAccepted, false);
    assert.equal(settings.onboarding.consent.rateLimitPolicyAccepted, false);
    assert.match(result.stdout, /Setup complete! To get started:\s*npm run review/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("cli init rejects invalid install channel", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-cli-init-invalid-"));
  try {
    const result = spawnSync(
      "node",
      [
        CLI_PATH,
        "init",
        "--channel",
        "discord",
        "--non-interactive"
      ],
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

test("cli init non-interactive works without legal consent flags", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-cli-init-no-consent-"));
  try {
    const result = spawnSync(
      "node",
      [CLI_PATH, "init", "--channel", "npm", "--non-interactive"],
      {
        cwd: tempDir,
        env: process.env,
        encoding: "utf8"
      }
    );
    assert.equal(result.status, 0, result.stderr || "Expected init to succeed without consent flags.");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("cli init non-interactive repeat run succeeds without consent flags", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-cli-init-repeat-consent-"));
  try {
    const first = spawnSync(
      "node",
      [
        CLI_PATH,
        "init",
        "--channel",
        "npm",
        "--non-interactive"
      ],
      {
        cwd: tempDir,
        env: process.env,
        encoding: "utf8"
      }
    );
    assert.equal(first.status, 0, first.stderr || "Expected initial init to succeed.");

    const second = spawnSync("node", [CLI_PATH, "init", "--channel", "npm", "--non-interactive"], {
      cwd: tempDir,
      env: process.env,
      encoding: "utf8"
    });
    assert.equal(second.status, 0, second.stderr || "Expected repeat non-interactive init to succeed.");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("cli init rejects removed legacy --accept-tos-risk flag", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-cli-init-legacy-flag-"));
  try {
    const result = spawnSync(
      "node",
      [
        CLI_PATH,
        "init",
        "--channel",
        "codex",
        "--accept-tos-risk",
        "--non-interactive"
      ],
      {
        cwd: tempDir,
        env: process.env,
        encoding: "utf8"
      }
    );
    assert.equal(result.status, 2, "Expected removed legacy consent flag to fail with misuse exit.");
    assert.match(result.stderr, /Unknown option\(s\) for init/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("cli init rejects conflicting analytics flags", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-cli-init-analytics-conflict-"));
  try {
    const result = spawnSync(
      "node",
      [
        CLI_PATH,
        "init",
        "--channel",
        "npm",
        "--analytics",
        "yes",
        "--no-analytics",
        "--non-interactive"
      ],
      {
        cwd: tempDir,
        env: process.env,
        encoding: "utf8"
      }
    );
    assert.equal(result.status, 2, "Expected conflicting analytics flags to fail with misuse exit.");
    assert.match(result.stderr, /Invalid analytics options/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("cli init supports --json output in non-interactive mode", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-cli-init-json-"));
  try {
    const result = spawnSync(
      "node",
      [
        CLI_PATH,
        "init",
        "--channel",
        "npm",
        "--analytics",
        "yes",
        "--non-interactive",
        "--json"
      ],
      {
        cwd: tempDir,
        env: process.env,
        encoding: "utf8"
      }
    );
    assert.equal(result.status, 0, result.stderr || "Expected init --json to exit 0");
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.channel, "npm");
    assert.equal(payload.analyticsEnabled, true);
    assert.equal(payload.nextAction, "npm run review");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
