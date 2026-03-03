import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import { importLinkedInSnapshot } from "../../sources/linkedin-saved-search.js";

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function resolveBridgeStateDir(baseDir = "data/browser-bridge") {
  return path.resolve(baseDir);
}

function getPendingRequestPath(sourceId, baseDir) {
  return path.join(baseDir, "pending", `${sourceId}.json`);
}

function readPendingRequest(sourceId, baseDir) {
  const requestPath = getPendingRequestPath(sourceId, baseDir);

  if (!fs.existsSync(requestPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(requestPath, "utf8"));
  } catch {
    return null;
  }
}

function writePendingRequest(source, snapshotPath, baseDir) {
  const pendingDir = path.join(baseDir, "pending");
  ensureDirectory(pendingDir);

  const request = {
    sourceId: source.id,
    sourceName: source.name,
    searchUrl: source.searchUrl,
    snapshotPath,
    requestedAt: new Date().toISOString(),
    status: "awaiting_snapshot"
  };

  const requestPath = getPendingRequestPath(source.id, baseDir);
  fs.writeFileSync(requestPath, `${JSON.stringify(request, null, 2)}\n`, "utf8");

  return {
    request,
    requestPath
  };
}

function clearPendingRequest(sourceId, baseDir) {
  const requestPath = getPendingRequestPath(sourceId, baseDir);

  if (fs.existsSync(requestPath)) {
    fs.unlinkSync(requestPath);
  }
}

function isSnapshotFreshEnough(snapshotPath, pendingRequest) {
  if (!fs.existsSync(snapshotPath) || !pendingRequest?.requestedAt) {
    return false;
  }

  const snapshotMtime = fs.statSync(snapshotPath).mtimeMs;
  const requestedAt = new Date(pendingRequest.requestedAt).getTime();

  return Number.isFinite(snapshotMtime) && Number.isFinite(requestedAt)
    ? snapshotMtime >= requestedAt
    : false;
}

function openUrlInBrowser(url) {
  const normalizedUrl = String(url || "").trim();

  if (!normalizedUrl) {
    throw new Error("URL is required.");
  }

  let command = "open";
  let args = [normalizedUrl];

  if (process.platform === "win32") {
    command = "cmd";
    args = ["/c", "start", "", normalizedUrl];
  } else if (process.platform !== "darwin") {
    command = "xdg-open";
    args = [normalizedUrl];
  }

  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore"
  });

  child.unref();
}

export function captureLinkedInSourceWithPersistentScaffold(
  source,
  snapshotPath,
  options = {}
) {
  if (!source || source.type !== "linkedin_capture_file") {
    throw new Error("Persistent capture requires a linkedin_capture_file source.");
  }

  const resolvedSnapshotPath = path.resolve(snapshotPath);
  const stateDir = resolveBridgeStateDir(options.stateDir);
  ensureDirectory(stateDir);

  const pendingRequest = readPendingRequest(source.id, stateDir);

  if (pendingRequest && isSnapshotFreshEnough(resolvedSnapshotPath, pendingRequest)) {
    const importResult = importLinkedInSnapshot(source, resolvedSnapshotPath);
    clearPendingRequest(source.id, stateDir);

    return {
      ...importResult,
      snapshotPath: resolvedSnapshotPath,
      provider: "persistent_scaffold",
      status: "completed"
    };
  }

  const { request, requestPath } = writePendingRequest(
    source,
    resolvedSnapshotPath,
    stateDir
  );

  openUrlInBrowser(source.searchUrl);

  return {
    provider: "persistent_scaffold",
    status: "pending",
    requestPath,
    snapshotPath: resolvedSnapshotPath,
    requestedAt: request.requestedAt,
    message:
      `Opened "${source.name}" in your browser. Save a fresh Playwright snapshot to ` +
      `${resolvedSnapshotPath}, then rerun the capture command.`
  };
}
