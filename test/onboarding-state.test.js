import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  getEffectiveOnboardingChannel,
  inferChannel,
  loadUserSettings,
  markFirstRunCompleted,
  markOnboardingCompleted,
  updateAnalyticsPreference,
  updateOnboardingChannel,
  updateOnboardingSourceCheck,
  updateOnboardingSources
} from "../src/onboarding/state.js";

function createTempSettingsPath() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-onboarding-state-"));
  return {
    tempDir,
    settingsPath: path.join(tempDir, "user-settings.json")
  };
}

test("inferChannel recognizes claude/codex/npm and unknown", () => {
  assert.equal(inferChannel({ CLAUDE_PROJECT_DIR: "/tmp/proj" }).channel, "claude");
  assert.equal(inferChannel({ CODEX_HOME: "/tmp/.codex" }).channel, "codex");
  assert.equal(inferChannel({ npm_config_user_agent: "npm/10.0.0" }).channel, "npm");
  assert.equal(inferChannel({}).channel, "unknown");
});

test("loadUserSettings initializes defaults and supports onboarding updates", () => {
  const { tempDir, settingsPath } = createTempSettingsPath();

  try {
    const initial = loadUserSettings(settingsPath);
    assert.equal(initial.settings.version, 1);
    assert.equal(typeof initial.settings.installId, "string");
    assert.equal(initial.settings.onboarding.completed, false);
    assert.equal(initial.settings.analytics.enabled, true);
    assert.ok(fs.existsSync(settingsPath));

    updateOnboardingChannel("codex", "self_reported", settingsPath);
    updateAnalyticsPreference(false, settingsPath);
    updateOnboardingSources(["linkedin", "google", "linkedin"], settingsPath);
    updateOnboardingSourceCheck(
      "linkedin",
      {
        status: "pass",
        reasonCode: "capture_ok",
        userMessage: "Captured jobs.",
        technicalDetails: {
          count: 10
        }
      },
      settingsPath
    );
    markFirstRunCompleted(settingsPath);
    markOnboardingCompleted(settingsPath);

    const after = loadUserSettings(settingsPath).settings;
    assert.equal(after.analytics.enabled, false);
    assert.equal(after.onboarding.channel.value, "codex");
    assert.deepEqual(after.onboarding.selectedSourceIds, ["linkedin", "google"]);
    assert.equal(after.onboarding.checks.sources.linkedin.status, "pass");
    assert.equal(typeof after.onboarding.firstRunAt, "string");
    assert.equal(after.onboarding.completed, true);
    assert.equal(typeof after.onboarding.completedAt, "string");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("getEffectiveOnboardingChannel prefers persisted channel over inference", () => {
  const settings = {
    onboarding: {
      channel: {
        value: "npm",
        confidence: "self_reported"
      }
    }
  };

  const effective = getEffectiveOnboardingChannel(settings);
  assert.equal(effective.value, "npm");
  assert.equal(effective.confidence, "self_reported");
});
