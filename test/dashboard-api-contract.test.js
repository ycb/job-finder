import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { startReviewServer } from "../src/review/server.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXAMPLE_CONFIGS = [
  ["config/profile.example.json", "config/profile.json"],
  ["config/profile-source.example.json", "config/profile-source.json"],
  ["config/source-criteria.example.json", "config/source-criteria.json"],
  ["config/sources.example.json", "config/sources.json"]
];

function createTempWorkspace() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-dashboard-contract-"));

  for (const [from, to] of EXAMPLE_CONFIGS) {
    const sourcePath = path.join(REPO_ROOT, from);
    const destinationPath = path.join(tempDir, to);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
  }

  return tempDir;
}

function assertRequiredPath(condition, pathText, message) {
  assert.equal(condition, true, `${pathText}: ${message}`);
}

function assertStringOrNull(value, pathText) {
  assertRequiredPath(
    value === null || typeof value === "string",
    pathText,
    "expected string or null"
  );
}

function assertNumberOrNull(value, pathText) {
  assertRequiredPath(
    value === null || (typeof value === "number" && Number.isFinite(value)),
    pathText,
    "expected number or null"
  );
}

function assertObject(value, pathText) {
  assertRequiredPath(
    Boolean(value) && typeof value === "object" && !Array.isArray(value),
    pathText,
    "expected object"
  );
}

function assertBoolean(value, pathText) {
  assertRequiredPath(typeof value === "boolean", pathText, "expected boolean");
}

function assertString(value, pathText) {
  assertRequiredPath(typeof value === "string" && value.trim().length > 0, pathText, "expected non-empty string");
}

async function fetchDashboardPayload(baseUrl) {
  const response = await fetch(`${baseUrl}/api/dashboard`);
  assert.equal(response.status, 200, "GET /api/dashboard should return HTTP 200");
  return response.json();
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

test(
  "GET /api/dashboard returns Searches + onboarding contract fields",
  { concurrency: false },
  async () => {
    const previousCwd = process.cwd();
    const workspace = createTempWorkspace();
    let server;

    try {
      process.chdir(workspace);
      server = await startReviewServer({ port: 0, limit: 200 });

      const address = server.address();
      assertRequiredPath(
        Boolean(address) && typeof address === "object" && Number.isFinite(address.port),
        "server.address()",
        "expected a listening port"
      );

      const payload = await fetchDashboardPayload(`http://127.0.0.1:${address.port}`);

      assertObject(payload, "dashboard");
      assertObject(payload.featureFlags, "dashboard.featureFlags");
      assertBoolean(payload.featureFlags.onboardingWizard, "dashboard.featureFlags.onboardingWizard");

      assertObject(payload.onboarding, "dashboard.onboarding");
      assertBoolean(payload.onboarding.enabled, "dashboard.onboarding.enabled");
      assertBoolean(payload.onboarding.completed, "dashboard.onboarding.completed");
      assertBoolean(payload.onboarding.consentComplete, "dashboard.onboarding.consentComplete");
      assertBoolean(payload.onboarding.analyticsEnabled, "dashboard.onboarding.analyticsEnabled");
      assertRequiredPath(
        Array.isArray(payload.onboarding.selectedSourceIds),
        "dashboard.onboarding.selectedSourceIds",
        "expected array"
      );
      assertObject(payload.onboarding.consent, "dashboard.onboarding.consent");
      assertBoolean(payload.onboarding.consent.termsAccepted, "dashboard.onboarding.consent.termsAccepted");
      assertBoolean(payload.onboarding.consent.privacyAccepted, "dashboard.onboarding.consent.privacyAccepted");
      assertBoolean(
        payload.onboarding.consent.rateLimitPolicyAccepted,
        "dashboard.onboarding.consent.rateLimitPolicyAccepted"
      );
      assertBoolean(payload.onboarding.consent.tosRiskAccepted, "dashboard.onboarding.consent.tosRiskAccepted");
      assertObject(payload.onboarding.checks, "dashboard.onboarding.checks");
      assertObject(payload.onboarding.checks.sources, "dashboard.onboarding.checks.sources");
      assertStringOrNull(payload.onboarding.firstRunAt, "dashboard.onboarding.firstRunAt");
      assertStringOrNull(payload.onboarding.sourcesConfiguredAt, "dashboard.onboarding.sourcesConfiguredAt");

      assertObject(payload.searchCriteria, "dashboard.searchCriteria");
      assertObject(payload.monetization, "dashboard.monetization");
      assertRequiredPath(
        typeof payload.monetization.monthlySearchLimit === "number",
        "dashboard.monetization.monthlySearchLimit",
        "expected number"
      );
      assertRequiredPath(
        typeof payload.monetization.searchesUsedThisMonth === "number",
        "dashboard.monetization.searchesUsedThisMonth",
        "expected number"
      );
      assertRequiredPath(
        typeof payload.monetization.jobsInDbLimit === "number",
        "dashboard.monetization.jobsInDbLimit",
        "expected number"
      );
      assertRequiredPath(
        typeof payload.monetization.jobsStored === "number",
        "dashboard.monetization.jobsStored",
        "expected number"
      );
      assertRequiredPath(Array.isArray(payload.sources), "dashboard.sources", "expected array");
      assertRequiredPath(payload.sources.length > 0, "dashboard.sources", "expected at least one source row");

      for (const [index, source] of payload.sources.entries()) {
        const sourcePath = `dashboard.sources[${index}]`;
        assertObject(source, sourcePath);
        assertString(source.id, `${sourcePath}.id`);
        assertString(source.name, `${sourcePath}.name`);
        assertString(source.type, `${sourcePath}.type`);
        assertString(source.searchUrl, `${sourcePath}.searchUrl`);
        assertBoolean(source.enabled, `${sourcePath}.enabled`);
        assertBoolean(source.authRequired, `${sourcePath}.authRequired`);

        assertString(source.captureStatus, `${sourcePath}.captureStatus`);
        assertStringOrNull(source.capturedAt, `${sourcePath}.capturedAt`);
        assertNumberOrNull(source.captureJobCount, `${sourcePath}.captureJobCount`);
        assertNumberOrNull(source.droppedByHardFilterCount, `${sourcePath}.droppedByHardFilterCount`);
        assertNumberOrNull(source.droppedByDedupeCount, `${sourcePath}.droppedByDedupeCount`);
        assertNumberOrNull(source.importedCount, `${sourcePath}.importedCount`);
        assertNumberOrNull(source.captureExpectedCount, `${sourcePath}.captureExpectedCount`);

        assertString(source.statusReason, `${sourcePath}.statusReason`);
        assertString(source.servedFrom, `${sourcePath}.servedFrom`);

        assertString(source.adapterHealthStatus, `${sourcePath}.adapterHealthStatus`);
        assertNumberOrNull(source.adapterHealthScore, `${sourcePath}.adapterHealthScore`);
        assertRequiredPath(
          Array.isArray(source.adapterHealthReasons),
          `${sourcePath}.adapterHealthReasons`,
          "expected array"
        );
        assertStringOrNull(source.adapterHealthUpdatedAt, `${sourcePath}.adapterHealthUpdatedAt`);

        assertNumberOrNull(source.runNewCount, `${sourcePath}.runNewCount`);
        assertNumberOrNull(source.runUpdatedCount, `${sourcePath}.runUpdatedCount`);
        assertNumberOrNull(source.runUnchangedCount, `${sourcePath}.runUnchangedCount`);

        assertNumberOrNull(source.avgScore, `${sourcePath}.avgScore`);
        assertBoolean(source.manualRefreshAllowed, `${sourcePath}.manualRefreshAllowed`);
        assertNumberOrNull(source.manualRefreshRemaining, `${sourcePath}.manualRefreshRemaining`);
        assertStringOrNull(source.manualRefreshNextEligibleAt, `${sourcePath}.manualRefreshNextEligibleAt`);

        const hasFormatterDiagnostics =
          source.formatterDiagnostics &&
          typeof source.formatterDiagnostics === "object" &&
          !Array.isArray(source.formatterDiagnostics);
        const hasCriteriaAccountability =
          source.criteriaAccountability &&
          typeof source.criteriaAccountability === "object" &&
          !Array.isArray(source.criteriaAccountability);
        assertRequiredPath(
          hasFormatterDiagnostics || hasCriteriaAccountability,
          sourcePath,
          "expected formatterDiagnostics or criteriaAccountability object"
        );
      }
    } finally {
      process.chdir(previousCwd);
      if (server) {
        await closeServer(server);
      }
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  }
);
