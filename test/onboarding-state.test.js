import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  getEffectiveOnboardingChannel,
  incrementMonthlySearchUsage,
  inferChannel,
  loadUserSettings,
  markFirstRunCompleted,
  markOnboardingCompleted,
  updateAnalyticsPreference,
  updateInstallConsent,
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
    assert.equal(initial.settings.onboarding.consent.termsAccepted, false);
    assert.equal(initial.settings.onboarding.consent.privacyAccepted, false);
    assert.equal(initial.settings.onboarding.consent.rateLimitPolicyAccepted, false);
    assert.ok(fs.existsSync(settingsPath));

    updateInstallConsent(
      {
        termsAccepted: true,
        privacyAccepted: true,
        rateLimitPolicyAccepted: true,
        tosRiskAccepted: true
      },
      settingsPath
    );
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
    assert.equal(after.onboarding.consent.termsAccepted, true);
    assert.equal(after.onboarding.consent.privacyAccepted, true);
    assert.equal(after.onboarding.consent.rateLimitPolicyAccepted, true);
    assert.equal(after.onboarding.consent.tosRiskAccepted, true);
    assert.equal(typeof after.onboarding.consent.acceptedAt, "string");
    assert.equal(after.onboarding.channel.value, "codex");
    assert.deepEqual(after.onboarding.selectedSourceIds, ["linkedin", "google"]);
    assert.equal(typeof after.onboarding.sourcesConfiguredAt, "string");
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

test("loadUserSettings preserves explicit tosRiskAccepted without legacy remap", () => {
  const { tempDir, settingsPath } = createTempSettingsPath();
  try {
    fs.writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          onboarding: {
            consent: {
              tosRiskAccepted: true,
              rateLimitPolicyAccepted: true
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );
    const loaded = loadUserSettings(settingsPath).settings;
    assert.equal(loaded.onboarding.consent.termsAccepted, false);
    assert.equal(loaded.onboarding.consent.privacyAccepted, false);
    assert.equal(loaded.onboarding.consent.tosRiskAccepted, true);
    assert.equal(loaded.onboarding.consent.acceptedAt, null);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("updateOnboardingSources records explicit empty selection", () => {
  const { tempDir, settingsPath } = createTempSettingsPath();
  try {
    loadUserSettings(settingsPath);
    updateOnboardingSources([], settingsPath);
    const loaded = loadUserSettings(settingsPath).settings;
    assert.deepEqual(loaded.onboarding.selectedSourceIds, []);
    assert.equal(typeof loaded.onboarding.sourcesConfiguredAt, "string");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("incrementMonthlySearchUsage tracks count by month and resets on month rollover", () => {
  const { tempDir, settingsPath } = createTempSettingsPath();
  try {
    loadUserSettings(settingsPath);

    const first = incrementMonthlySearchUsage(settingsPath, "2026-03-18T12:00:00.000Z").settings;
    assert.equal(first.monetization.monthlySearchCount, 1);
    assert.equal(first.monetization.monthlySearchMonth, "2026-03");
    assert.equal(first.monetization.monthlySearchLimit, 10);

    const second = incrementMonthlySearchUsage(settingsPath, "2026-03-19T12:00:00.000Z").settings;
    assert.equal(second.monetization.monthlySearchCount, 2);
    assert.equal(second.monetization.monthlySearchMonth, "2026-03");

    const rolled = incrementMonthlySearchUsage(settingsPath, "2026-04-01T08:00:00.000Z").settings;
    assert.equal(rolled.monetization.monthlySearchCount, 1);
    assert.equal(rolled.monetization.monthlySearchMonth, "2026-04");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
