import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  checkEnvironmentReadiness,
  checkSourceAccess,
  normalizeSourceCheckResult
} from "../src/onboarding/source-access.js";

function createTempCaptureFile(jobs = []) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-source-check-"));
  const capturePath = path.join(tempDir, "capture.json");

  fs.writeFileSync(
    capturePath,
    `${JSON.stringify({ capturedAt: new Date().toISOString(), jobs }, null, 2)}\n`,
    "utf8"
  );

  return { tempDir, capturePath };
}

test("checkEnvironmentReadiness reports baseline checks", () => {
  const checks = checkEnvironmentReadiness({
    platform: "darwin",
    env: {
      JOB_FINDER_BRIDGE_PROVIDER: "chrome_applescript"
    }
  });

  assert.ok(Array.isArray(checks));
  assert.ok(checks.some((check) => check.id === "node"));
  assert.ok(checks.some((check) => check.id === "platform"));
  assert.ok(checks.some((check) => check.id === "chrome-apple-events"));
});

test("checkSourceAccess returns pass when capture file has jobs", () => {
  const { tempDir, capturePath } = createTempCaptureFile([{ id: "job-1" }]);

  try {
    const result = checkSourceAccess({
      id: "linkedin",
      name: "LinkedIn",
      enabled: true,
      type: "linkedin_capture_file",
      searchUrl: "https://www.linkedin.com/jobs/search/?keywords=pm",
      capturePath
    });

    assert.equal(result.status, "pass");
    assert.equal(result.reasonCode, "capture_ok");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("checkSourceAccess returns warn for browser source without capture", () => {
  const result = checkSourceAccess({
    id: "linkedin",
    name: "LinkedIn",
    enabled: true,
    type: "linkedin_capture_file",
    searchUrl: "https://www.linkedin.com/jobs/search/?keywords=pm",
    capturePath: "/tmp/does-not-exist.json"
  });

  assert.equal(result.status, "warn");
  assert.equal(result.reasonCode, "capture_required");
});

test("checkSourceAccess allows onboarding checks against disabled source definitions", () => {
  const result = checkSourceAccess(
    {
      id: "linkedin",
      name: "LinkedIn",
      enabled: false,
      type: "linkedin_capture_file",
      searchUrl: "https://www.linkedin.com/jobs/search/?keywords=pm",
      capturePath: "/tmp/does-not-exist.json"
    },
    { ignoreEnabled: true }
  );

  assert.equal(result.reasonCode, "capture_required");
});

test("checkSourceAccess treats empty captured browser result as verified access", () => {
  const { tempDir, capturePath } = createTempCaptureFile([]);

  try {
    const result = checkSourceAccess({
      id: "linkedin",
      name: "LinkedIn",
      enabled: true,
      type: "linkedin_capture_file",
      searchUrl: "https://www.linkedin.com/jobs/search/?keywords=pm",
      capturePath
    });

    assert.equal(result.status, "pass");
    assert.equal(result.reasonCode, "capture_ok_empty");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("checkSourceAccess returns fail for invalid url and missing source", () => {
  const missing = checkSourceAccess(null);
  assert.equal(missing.status, "fail");
  assert.equal(missing.reasonCode, "source_missing");

  const invalidUrl = checkSourceAccess({
    id: "builtin",
    name: "Built In",
    enabled: true,
    type: "builtin_search",
    searchUrl: "not-a-url"
  });
  assert.equal(invalidUrl.status, "fail");
  assert.equal(invalidUrl.reasonCode, "invalid_search_url");
});

test("normalizeSourceCheckResult enforces shape", () => {
  const normalized = normalizeSourceCheckResult({
    status: "PASS",
    reasonCode: "ok",
    userMessage: "done",
    technicalDetails: "bad-shape"
  });

  assert.equal(normalized.status, "pass");
  assert.equal(normalized.reasonCode, "ok");
  assert.equal(normalized.userMessage, "done");
  assert.deepEqual(normalized.technicalDetails, {});
});
