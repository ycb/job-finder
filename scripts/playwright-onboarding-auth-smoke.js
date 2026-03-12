import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { startReviewServer } from "../src/review/server.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const options = {
    outputDir: path.resolve(REPO_ROOT, "docs", "roadmap", "progress-merge"),
    artifactPrefix: `${new Date().toISOString().slice(0, 10)}-f2-e-onboarding-auth`,
    timeoutMs: 60_000
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--output-dir") {
      options.outputDir = path.resolve(String(next || ""));
      index += 1;
      continue;
    }

    if (arg === "--artifact-prefix") {
      options.artifactPrefix = String(next || "").trim();
      index += 1;
      continue;
    }

    if (arg === "--timeout-ms") {
      options.timeoutMs = Number(next);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.artifactPrefix) {
    throw new Error("--artifact-prefix must be non-empty");
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive number");
  }

  return options;
}

function createTempWorkspace() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-onboarding-auth-smoke-"));
  const configPairs = [
    ["config/profile.example.json", "config/profile.json"],
    ["config/profile-source.example.json", "config/profile-source.json"],
    ["config/source-criteria.example.json", "config/source-criteria.json"],
    ["config/sources.example.json", "config/sources.json"]
  ];

  for (const [from, to] of configPairs) {
    const sourcePath = path.join(REPO_ROOT, from);
    const destinationPath = path.join(tempDir, to);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
  }

  return tempDir;
}

function closeServer(server) {
  if (!server) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

async function fetchDashboardPayload(baseUrl) {
  const response = await fetch(`${baseUrl}/api/dashboard`, {
    signal: AbortSignal.timeout(3_000)
  });

  if (!response.ok) {
    throw new Error(`GET /api/dashboard failed with HTTP ${response.status}`);
  }

  return response.json();
}

async function runSmoke(options) {
  fs.mkdirSync(options.outputDir, { recursive: true });

  const workspace = createTempWorkspace();
  const screenshotPath = path.resolve(options.outputDir, `${options.artifactPrefix}-screenshot.png`);
  const jsonPath = path.resolve(options.outputDir, `${options.artifactPrefix}-result.json`);
  const logPath = path.resolve(options.outputDir, `${options.artifactPrefix}-smoke.log`);

  const logLines = [];
  const previousCwd = process.cwd();
  const previousMode = process.env.JOB_FINDER_DASHBOARD_UI;
  const previousBridgeProvider = process.env.JOB_FINDER_BRIDGE_PROVIDER;

  let server;
  let browser;

  try {
    process.chdir(workspace);
    process.env.JOB_FINDER_DASHBOARD_UI = "react";
    process.env.JOB_FINDER_BRIDGE_PROVIDER = "noop";
    server = await startReviewServer({ port: 0, limit: 200 });

    const address = server.address();
    if (!address || typeof address !== "object" || !Number.isFinite(address.port)) {
      throw new Error("Review server did not expose a valid listening port");
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;
    const initialPayload = await fetchDashboardPayload(baseUrl);
    const initialSources = Array.isArray(initialPayload.sources) ? initialPayload.sources : [];
    const authCandidate =
      initialSources.find((source) => source && source.authRequired === true && source.enabled !== true) ||
      null;

    if (!authCandidate) {
      throw new Error("No auth-required disabled source found in dashboard payload");
    }

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto(baseUrl, { waitUntil: "networkidle", timeout: options.timeoutMs });

    await page.waitForSelector("#onboarding-save-consent", { timeout: options.timeoutMs });
    await page.check("#onboarding-consent-legal");
    await page.check("#onboarding-consent-tos-risk");
    await page.click("#onboarding-save-consent");

    await page.waitForSelector("[data-onboarding-section='sources']", {
      timeout: options.timeoutMs
    });

    const disabledTab = page.getByRole("tab", { name: /^Disabled \(/ });
    await disabledTab.click();
    await page.waitForFunction(() => {
      const activeTab = document.querySelector('[role="tab"][data-state="active"]');
      if (!activeTab) {
        return false;
      }
      const text = (activeTab.textContent || "").trim();
      return text.startsWith("Disabled");
    });

    const enableSelector = `[data-onboarding-enable-source='${authCandidate.id}']`;
    await page.waitForSelector(enableSelector, { timeout: options.timeoutMs });
    await page.click(enableSelector);

    await page.waitForSelector("[data-auth-flow-modal='1']", {
      timeout: options.timeoutMs
    });

    const checkResponsePromise = page
      .waitForResponse(
        (response) =>
          response.url().includes("/api/onboarding/check-source") &&
          response.request().method() === "POST",
        { timeout: 15_000 }
      )
      .catch(() => null);

    await page.click("[data-auth-flow-check='1']");

    await page.waitForFunction(() => {
      const status = document.querySelector("[data-auth-flow-status='1']");
      if (!status) {
        return false;
      }
      const text = (status.textContent || "").trim();
      return text.startsWith("Checking access for ");
    });

    const modalStatus = await page
      .locator("[data-auth-flow-status='1']")
      .first()
      .textContent();

    const checkResponse = await checkResponsePromise;
    let checkResponseSummary = "pending";
    if (checkResponse) {
      try {
        const payload = await checkResponse.json();
        const status =
          payload && payload.result && payload.result.status
            ? String(payload.result.status).toLowerCase()
            : "unknown";
        checkResponseSummary = `${checkResponse.status()}:${status}`;
      } catch {
        checkResponseSummary = `${checkResponse.status()}:unparsed`;
      }
    }

    await page.screenshot({ path: screenshotPath, fullPage: true });

    const finalPayload = await fetchDashboardPayload(baseUrl);
    const result = {
      capturedAt: new Date().toISOString(),
      baseUrl,
      authCandidate: {
        id: authCandidate.id,
        name: authCandidate.name
      },
      modalStatus: String(modalStatus || "").trim(),
      checkResponseSummary,
      onboardingConsentComplete:
        finalPayload && finalPayload.onboarding ? finalPayload.onboarding.consentComplete : null
    };

    logLines.push(`[assert] auth candidate id=${authCandidate.id}`);
    logLines.push(`[assert] modal status=${result.modalStatus}`);
    logLines.push(`[assert] check response=${result.checkResponseSummary}`);
    logLines.push(`[assert] onboarding consent complete=${String(result.onboardingConsentComplete)}`);

    fs.writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    fs.writeFileSync(logPath, `${logLines.join("\n")}\n`, "utf8");

    return {
      screenshotPath,
      jsonPath,
      logPath,
      result
    };
  } finally {
    if (browser) {
      await browser.close();
    }

    await closeServer(server);
    process.chdir(previousCwd);

    if (typeof previousMode === "string") {
      process.env.JOB_FINDER_DASHBOARD_UI = previousMode;
    } else {
      delete process.env.JOB_FINDER_DASHBOARD_UI;
    }

    if (typeof previousBridgeProvider === "string") {
      process.env.JOB_FINDER_BRIDGE_PROVIDER = previousBridgeProvider;
    } else {
      delete process.env.JOB_FINDER_BRIDGE_PROVIDER;
    }

    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outcome = await runSmoke(options);

  const lines = [
    `[smoke] screenshot: ${outcome.screenshotPath}`,
    `[smoke] result: ${outcome.jsonPath}`,
    `[smoke] log: ${outcome.logPath}`,
    `[smoke] modal status: ${outcome.result.modalStatus}`
  ];

  process.stdout.write(`${lines.join("\n")}\n`);
  process.exit(0);
}

main().catch((error) => {
  process.stderr.write(`[smoke] FAILED: ${error?.stack || error?.message || String(error)}\n`);
  process.exitCode = 1;
});
