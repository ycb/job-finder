import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { importLinkedInSnapshot } from "../../sources/linkedin-saved-search.js";

function resolveCodexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

function resolvePlaywrightCliScript() {
  return path.join(resolveCodexHome(), "skills", "playwright", "scripts", "playwright_cli.sh");
}

function readPlaywrightExtensionToken() {
  const envToken = String(process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN || "").trim();
  if (envToken) {
    return envToken;
  }

  const configPath = path.join(resolveCodexHome(), "config.toml");
  if (!fs.existsSync(configPath)) {
    return "";
  }

  const configText = fs.readFileSync(configPath, "utf8");
  const match = configText.match(
    /PLAYWRIGHT_MCP_EXTENSION_TOKEN\s*=\s*"([^"]+)"/
  );

  return match?.[1]?.trim() || "";
}

function runPlaywrightCli(commandArgs, options = {}) {
  const scriptPath = resolvePlaywrightCliScript();

  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Playwright CLI wrapper not found: ${scriptPath}`);
  }

  const extensionToken = readPlaywrightExtensionToken();
  if (!extensionToken) {
    throw new Error(
      "Missing PLAYWRIGHT_MCP_EXTENSION_TOKEN. Set it in the environment or ~/.codex/config.toml."
    );
  }

  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 30_000;
  const result = spawnSync(scriptPath, commandArgs, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: timeoutMs,
    env: {
      ...process.env,
      NPM_CONFIG_CACHE: process.env.NPM_CONFIG_CACHE || "/tmp/npm-cache",
      PLAYWRIGHT_MCP_EXTENSION_TOKEN: extensionToken
    }
  });

  if (result.error) {
    if (result.error.code === "ETIMEDOUT") {
      throw new Error(
        `Playwright CLI timed out after ${timeoutMs}ms. Confirm the browser extension is connected.`
      );
    }

    throw result.error;
  }

  if (result.status !== 0) {
    const errorText = String(result.stderr || result.stdout || "").trim();
    throw new Error(errorText || `Playwright CLI exited with status ${result.status}.`);
  }

  return String(result.stdout || "");
}

function buildSessionArgs(sessionName) {
  const args = [];

  if (sessionName) {
    args.push("--session", sessionName);
  }

  args.push("--extension");
  return args;
}

function writeSnapshotFile(snapshotPath, snapshotText) {
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.writeFileSync(snapshotPath, snapshotText, "utf8");
}

export function captureLinkedInSourceWithPlaywrightCli(
  source,
  snapshotPath,
  options = {}
) {
  if (!source || source.type !== "linkedin_capture_file") {
    throw new Error("Live LinkedIn capture requires a linkedin_capture_file source.");
  }

  const resolvedSnapshotPath = path.resolve(snapshotPath);
  const sessionName =
    String(options.sessionName || "").trim() || `job-finder-${source.id}`;
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 30_000;
  const prefix = buildSessionArgs(sessionName);

  runPlaywrightCli([...prefix, "open", source.searchUrl], { timeoutMs });
  runPlaywrightCli(
    [...prefix, "run-code", "await page.waitForTimeout(2000)"],
    { timeoutMs }
  );
  const snapshotText = runPlaywrightCli([...prefix, "snapshot"], {
    timeoutMs
  });

  if (!snapshotText.trim()) {
    throw new Error("Playwright CLI returned an empty snapshot.");
  }

  writeSnapshotFile(resolvedSnapshotPath, snapshotText);
  const importResult = importLinkedInSnapshot(source, resolvedSnapshotPath);

  return {
    ...importResult,
    snapshotPath: resolvedSnapshotPath,
    sessionName,
    provider: "playwright_cli"
  };
}

export function captureSourceWithPlaywrightCli(source, snapshotPath, options = {}) {
  if (source?.type !== "linkedin_capture_file") {
    throw new Error(
      `Playwright CLI provider currently supports linkedin_capture_file only. "${source?.name || "unknown"}" is ${source?.type || "unknown"}.`
    );
  }

  return captureLinkedInSourceWithPlaywrightCli(source, snapshotPath, options);
}
