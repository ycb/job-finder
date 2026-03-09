import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_RETENTION_POLICY,
  loadRetentionPolicy,
  saveRetentionPolicy
} from "../src/config/retention-policy.js";

function createTempPolicyDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-retention-policy-"));
  const configDir = path.join(tempDir, "config");
  fs.mkdirSync(configDir, { recursive: true });
  return {
    tempDir,
    policyPath: path.join(configDir, "retention-policy.json")
  };
}

test("loadRetentionPolicy returns status-aware defaults when policy file is missing", () => {
  const { tempDir, policyPath } = createTempPolicyDir();
  try {
    const loaded = loadRetentionPolicy(policyPath);
    assert.equal(loaded.path, path.resolve(policyPath));
    assert.equal(loaded.exists, false);
    assert.deepEqual(loaded.policy, DEFAULT_RETENTION_POLICY);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("saveRetentionPolicy persists custom overrides while preserving schema", () => {
  const { tempDir, policyPath } = createTempPolicyDir();
  try {
    const saved = saveRetentionPolicy(
      {
        enabled: true,
        statusTtlDays: {
          new: 10,
          viewed: 20,
          skip_for_now: 15,
          rejected: 7,
          applied: null
        }
      },
      policyPath
    );

    assert.equal(saved.policy.enabled, true);
    assert.equal(saved.policy.statusTtlDays.new, 10);
    assert.equal(saved.policy.statusTtlDays.viewed, 20);
    assert.equal(saved.policy.statusTtlDays.skip_for_now, 15);
    assert.equal(saved.policy.statusTtlDays.rejected, 7);
    assert.equal(saved.policy.statusTtlDays.applied, null);

    const reloaded = loadRetentionPolicy(policyPath);
    assert.deepEqual(reloaded.policy, saved.policy);
    assert.equal(reloaded.exists, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
