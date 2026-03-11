import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI_PATH = path.join(REPO_ROOT, "src", "cli.js");
const REVIEW_WEB_DIST_INDEX_PATH = path.join(
  REPO_ROOT,
  "src",
  "review",
  "web",
  "dist",
  "index.html",
);

function parseArgs(argv) {
  const options = {
    outputDir: path.resolve(REPO_ROOT, "docs", "roadmap", "progress-merge"),
    artifactPrefix: `${new Date().toISOString().slice(0, 10)}-f2-d-searches-smoke`,
    port: 4432,
    timeoutMs: 30_000,
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

    if (arg === "--port") {
      options.port = Number(next);
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
  if (!Number.isInteger(options.port) || options.port <= 0) {
    throw new Error("--port must be a positive integer");
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive number");
  }

  return options;
}

function createTempWorkspace() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-searches-smoke-"));
  const configPairs = [
    ["config/profile.example.json", "config/profile.json"],
    ["config/profile-source.example.json", "config/profile-source.json"],
    ["config/source-criteria.example.json", "config/source-criteria.json"],
    ["config/sources.example.json", "config/sources.json"],
  ];

  for (const [from, to] of configPairs) {
    const sourcePath = path.join(REPO_ROOT, from);
    const destinationPath = path.join(tempDir, to);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
  }

  return tempDir;
}

function ensureReactBuild() {
  const buildResult = spawnSync("npm", ["run", "dashboard:web:build"], {
    cwd: REPO_ROOT,
    env: process.env,
    encoding: "utf8",
  });

  if (buildResult.status !== 0) {
    throw new Error(
      `React build failed (${buildResult.status}): ${
        buildResult.stderr || buildResult.stdout || "unknown error"
      }`,
    );
  }

  if (!fs.existsSync(REVIEW_WEB_DIST_INDEX_PATH)) {
    throw new Error(
      `React build completed but dist index is missing at ${REVIEW_WEB_DIST_INDEX_PATH}`,
    );
  }
}

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDashboardJson(baseUrl, timeoutMs) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/api/dashboard`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) {
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await delay(250);
  }

  throw new Error(
    `Timed out waiting for ${baseUrl}/api/dashboard (${lastError?.message || "unknown"})`,
  );
}

async function stopProcess(child) {
  if (!child || child.killed) {
    return;
  }

  child.kill("SIGTERM");

  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(2_000),
  ]);

  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
  }
}

async function ensureAttr(locator, attrName, expected, label) {
  const count = await locator.count();
  if (count === 0) {
    throw new Error(`${label}: element not found`);
  }
  const actual = await locator.first().getAttribute(attrName);
  if (actual !== expected) {
    throw new Error(`${label}: expected ${attrName}=${expected}, saw ${actual}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  fs.mkdirSync(options.outputDir, { recursive: true });
  ensureReactBuild();

  const workspace = createTempWorkspace();
  const baseUrl = `http://127.0.0.1:${options.port}`;
  const screenshotPath = path.resolve(
    options.outputDir,
    `${options.artifactPrefix}-react-searches.png`,
  );
  const logPath = path.resolve(options.outputDir, `${options.artifactPrefix}-react-searches.log`);

  const reviewCommand = [CLI_PATH, "review", String(options.port), "--quiet"];
  const reviewEnv = {
    ...process.env,
    JOB_FINDER_DASHBOARD_UI: "react",
  };

  const reviewStdout = [];
  const reviewStderr = [];

  const reviewProcess = spawn(process.execPath, reviewCommand, {
    cwd: workspace,
    env: reviewEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  reviewProcess.stdout.on("data", (chunk) => {
    reviewStdout.push(String(chunk));
  });
  reviewProcess.stderr.on("data", (chunk) => {
    reviewStderr.push(String(chunk));
  });

  let browser;
  try {
    await waitForDashboardJson(baseUrl, options.timeoutMs);

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: options.timeoutMs });

    const pageTitle = await page.title();
    if (!pageTitle.includes("Job Finder Dashboard UI")) {
      throw new Error(`Unexpected page title: ${pageTitle}`);
    }

    const searchesMainTab = page.getByRole("tab", { name: "Searches" });
    await ensureAttr(searchesMainTab, "data-state", "active", "main Searches tab");

    const enabledStateTab = page.getByRole("tab", { name: /^Enabled \(/ });
    await ensureAttr(enabledStateTab, "data-state", "active", "Enabled state tab");

    const searchFrequencyLabel = page.getByText("Search frequency", { exact: false });
    if ((await searchFrequencyLabel.count()) === 0) {
      throw new Error("Expected Search frequency control in Enabled tab");
    }

    const welcomeToast = page.getByText("Welcome to Job Finder!", { exact: false });
    if ((await welcomeToast.count()) === 0) {
      throw new Error("Expected first-visit welcome toast on Searches tab");
    }

    await page.getByRole("button", { name: "Go to Disabled" }).click();

    const disabledStateTab = page.getByRole("tab", { name: /^Disabled \(/ });
    await ensureAttr(disabledStateTab, "data-state", "active", "Disabled state tab");

    if ((await page.getByText("Search frequency", { exact: false }).count()) !== 0) {
      throw new Error("Search frequency control should not render in Disabled tab");
    }

    const enableButtons = page.getByRole("button", { name: "Enable", exact: true });
    if ((await enableButtons.count()) === 0) {
      throw new Error("Expected at least one Enable action in Disabled tab");
    }

    await enabledStateTab.click();
    await ensureAttr(enabledStateTab, "data-state", "active", "Enabled state tab after return");

    const runNowButtons = page.getByRole("button", { name: /Run now|Available in/i });
    if ((await runNowButtons.count()) === 0) {
      throw new Error("Expected Run now action in Enabled tab");
    }

    await page.reload({ waitUntil: "domcontentloaded" });
    if ((await page.getByText("Welcome to Job Finder!", { exact: false }).count()) !== 0) {
      throw new Error("Welcome toast should only appear on first visit");
    }

    await page.screenshot({ path: screenshotPath, fullPage: true });

    const logLines = [
      "mode=react",
      `baseUrl=${baseUrl}`,
      "searches_flow_check=pass",
      "checks=main_tab_active,enabled_tab_active,frequency_present,welcome_toast_first_visit,go_to_disabled_cta,disabled_tab_active,enable_action_present,run_now_action_present,welcome_toast_single_visit",
      `title=${pageTitle}`,
      `screenshot=${screenshotPath}`,
      `review_command=${process.execPath} ${reviewCommand.join(" ")}`,
      "review_stdout:",
      reviewStdout.join("").trim(),
      "review_stderr:",
      reviewStderr.join("").trim(),
    ];

    fs.writeFileSync(logPath, `${logLines.join("\n")}\n`, "utf8");

    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          mode: "react",
          baseUrl,
          screenshotPath,
          logPath,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    if (browser) {
      await browser.close();
    }
    await stopProcess(reviewProcess);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${String(error?.message || error)}\n`);
  process.exitCode = 1;
});
