import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

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
