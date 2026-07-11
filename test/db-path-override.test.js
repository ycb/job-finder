import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { openDatabase } from "../src/db/client.js";

test("JOB_FINDER_DB env var overrides the checkout-relative default", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jf-db-override-"));
  const stablePath = path.join(dir, "stable.db");
  const previous = process.env.JOB_FINDER_DB;

  try {
    process.env.JOB_FINDER_DB = stablePath;
    const { db, dbPath } = openDatabase();
    db.close();
    assert.equal(dbPath, path.resolve(stablePath));
    assert.ok(fs.existsSync(stablePath));
  } finally {
    if (previous === undefined) {
      delete process.env.JOB_FINDER_DB;
    } else {
      process.env.JOB_FINDER_DB = previous;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("explicit dbPath argument outranks JOB_FINDER_DB", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jf-db-override-"));
  const envPath = path.join(dir, "env.db");
  const explicitPath = path.join(dir, "explicit.db");
  const previous = process.env.JOB_FINDER_DB;

  try {
    process.env.JOB_FINDER_DB = envPath;
    const { db, dbPath } = openDatabase(explicitPath);
    db.close();
    assert.equal(dbPath, path.resolve(explicitPath));
    assert.ok(!fs.existsSync(envPath));
  } finally {
    if (previous === undefined) {
      delete process.env.JOB_FINDER_DB;
    } else {
      process.env.JOB_FINDER_DB = previous;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
