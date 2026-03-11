import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CLI_PATH = path.join(REPO_ROOT, "src", "cli.js");

function parseArgs(argv) {
  const options = {
    mode: "legacy",
    outputDir: path.resolve(REPO_ROOT, "docs", "roadmap", "progress-merge"),
    artifactPrefix: `${new Date().toISOString().slice(0, 10)}-dashboard-smoke`,
    port: null,
    timeoutMs: 30_000
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--mode") {
      options.mode = String(next || "").trim().toLowerCase();
      index += 1;
      continue;
    }

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

  if (!["legacy", "react"].includes(options.mode)) {
    throw new Error("--mode must be one of: legacy, react");
  }

  if (!options.artifactPrefix) {
    throw new Error("--artifact-prefix must be non-empty");
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive number");
  }

  if (options.port === null) {
    options.port = options.mode === "legacy" ? 4411 : 4412;
  }

  if (!Number.isInteger(options.port) || options.port <= 0) {
    throw new Error("--port must be a positive integer");
  }

  return options;
}

function createTempWorkspace() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-dashboard-smoke-"));
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDashboardJson(baseUrl, timeoutMs) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/api/dashboard`, {
        signal: AbortSignal.timeout(2_000)
      });

      if (response.ok) {
        return response.json();
      }

      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await delay(250);
  }

  const reason =
    lastError && typeof lastError.message === "string"
      ? lastError.message
      : "unknown error";
  throw new Error(`Timed out waiting for ${baseUrl}/api/dashboard (${reason})`);
}

async function stopProcess(child) {
  if (!child || child.killed) {
    return;
  }

  child.kill("SIGTERM");

  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(2_000)
  ]);

  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  fs.mkdirSync(options.outputDir, { recursive: true });

  const workspace = createTempWorkspace();
  const baseUrl = `http://127.0.0.1:${options.port}`;
  const screenshotPath = path.resolve(
    options.outputDir,
    `${options.artifactPrefix}-${options.mode}-dashboard.png`
  );
  const dashboardJsonPath = path.resolve(
    options.outputDir,
    `${options.artifactPrefix}-${options.mode}-dashboard.json`
  );
  const logPath = path.resolve(
    options.outputDir,
    `${options.artifactPrefix}-${options.mode}-smoke.log`
  );

  const reviewCommand = [CLI_PATH, "review", String(options.port), "--quiet"];
  const reviewEnv = {
    ...process.env,
    JOB_FINDER_DASHBOARD_UI: options.mode
  };

  const reviewStdout = [];
  const reviewStderr = [];

  const reviewProcess = spawn(process.execPath, reviewCommand, {
    cwd: workspace,
    env: reviewEnv,
    stdio: ["ignore", "pipe", "pipe"]
  });

  reviewProcess.stdout.on("data", (chunk) => {
    reviewStdout.push(String(chunk));
  });
  reviewProcess.stderr.on("data", (chunk) => {
    reviewStderr.push(String(chunk));
  });

  try {
    const dashboardPayload = await waitForDashboardJson(baseUrl, options.timeoutMs);

    fs.writeFileSync(
      dashboardJsonPath,
      `${JSON.stringify(
        {
          mode: options.mode,
          baseUrl,
          capturedAt: new Date().toISOString(),
          payload: dashboardPayload
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const screenshotResult = spawnSync(
      "npx",
      ["playwright", "screenshot", "--browser=chromium", baseUrl, screenshotPath],
      {
        cwd: REPO_ROOT,
        env: process.env,
        encoding: "utf8"
      }
    );

    if (screenshotResult.status !== 0) {
      throw new Error(
        `Playwright screenshot failed (${screenshotResult.status}): ${
          screenshotResult.stderr || screenshotResult.stdout || "unknown error"
        }`
      );
    }

    const logLines = [
      `mode=${options.mode}`,
      `baseUrl=${baseUrl}`,
      `review_command=${process.execPath} ${reviewCommand.join(" ")}`,
      `screenshot_command=npx playwright screenshot --browser=chromium ${baseUrl} ${screenshotPath}`,
      `dashboard_json=${dashboardJsonPath}`,
      `screenshot=${screenshotPath}`,
      "review_stdout:",
      reviewStdout.join("").trim(),
      "review_stderr:",
      reviewStderr.join("").trim(),
      "playwright_stdout:",
      String(screenshotResult.stdout || "").trim(),
      "playwright_stderr:",
      String(screenshotResult.stderr || "").trim()
    ];

    fs.writeFileSync(logPath, `${logLines.join("\n")}\n`, "utf8");

    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          mode: options.mode,
          baseUrl,
          screenshotPath,
          dashboardJsonPath,
          logPath
        },
        null,
        2
      )}\n`
    );
  } finally {
    await stopProcess(reviewProcess);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${String(error?.message || error)}\n`);
  process.exitCode = 1;
});
