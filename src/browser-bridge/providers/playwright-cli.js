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

export function authProbeLooksUnauthorizedForSource(sourceType, payload) {
  if (!payload || typeof payload !== "object") {
    return true;
  }

  const href = String(payload.href || "").toLowerCase();
  const title = String(payload.title || "").toLowerCase();
  const text = String(payload.textSnippet || "").toLowerCase();
  const host = String(payload.host || "").toLowerCase();
  const pathname = String(payload.pathname || "").toLowerCase();
  const source = String(sourceType || "").toLowerCase();

  let hostPattern = /(linkedin|workatastartup|indeed|wellfound|remoteok)\./;
  if (source === "linkedin_capture_file") {
    hostPattern = /linkedin\./;
  } else if (source === "yc_jobs") {
    hostPattern = /workatastartup\./;
  } else if (source === "indeed_search") {
    hostPattern = /indeed\./;
  } else if (source === "wellfound_search") {
    hostPattern = /wellfound\./;
  } else if (source === "remoteok_search") {
    hostPattern = /remoteok\./;
  }

  const hasLoginPath =
    hostPattern.test(host) &&
    /(login|signin|sign-in|authwall|checkpoint|session|sign_in)/.test(pathname);
  const hasLoginInHref = /(login|signin|sign-in|authwall|checkpoint|session|sign_in)/.test(href);
  const hasPasswordField = payload.hasPasswordField === true;
  const likelyLoginTitle = /(sign in|log in|login)/.test(title);
  const likelyLoginText = /(sign in|log in|login|continue with)/.test(text);

  return hasLoginPath || hasLoginInHref || hasPasswordField || (likelyLoginTitle && likelyLoginText);
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

export function probeSourceAccessWithPlaywrightCli(source, options = {}) {
  if (!source || !source.searchUrl) {
    throw new Error("Auth probe requires a source with searchUrl.");
  }

  const sessionName =
    String(options.sessionName || "").trim() || `job-finder-auth-${source.id || "source"}`;
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 20_000;
  const settleMs = Number(options.settleMs) > 0 ? Number(options.settleMs) : 1500;
  const prefix = buildSessionArgs(sessionName);

  runPlaywrightCli([...prefix, "open", source.searchUrl], { timeoutMs });
  runPlaywrightCli(
    [...prefix, "run-code", `await page.waitForTimeout(${Math.max(250, settleMs)})`],
    { timeoutMs }
  );
  const probeRaw = runPlaywrightCli(
    [
      ...prefix,
      "run-code",
      "const r={href:location.href,title:document.title,host:location.host,pathname:location.pathname,hasPasswordField:Boolean(document.querySelector('input[type=\"password\"]')),textSnippet:(document.body?.innerText||'').slice(0,1200)};console.log(JSON.stringify(r));"
    ],
    { timeoutMs }
  );

  const lines = String(probeRaw || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const payload = JSON.parse(lines[lines.length - 1] || "{}");
  const unauthorized = authProbeLooksUnauthorizedForSource(source?.type, payload);

  return {
    status: unauthorized ? "unauthorized" : "authorized",
    reasonCode: unauthorized ? "auth_required" : "auth_ok",
    pageUrl: String(payload.href || source.searchUrl),
    pageTitle: String(payload.title || ""),
    provider: "playwright_cli"
  };
}
