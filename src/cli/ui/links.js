import path from "node:path";
import { pathToFileURL } from "node:url";

function shouldEmitOsc8() {
  if (process.env.JOB_FINDER_DISABLE_OSC8 === "1") {
    return false;
  }
  if (process.env.JOB_FINDER_FORCE_OSC8 === "1") {
    return true;
  }
  if (process.env.TERM_PROGRAM === "Apple_Terminal") {
    return false;
  }
  return Boolean(process.stdout && process.stdout.isTTY);
}

function osc8Link(label, target) {
  const safeLabel = String(label || "");
  const safeTarget = String(target || "");
  return `\u001B]8;;${safeTarget}\u0007${safeLabel}\u001B]8;;\u0007`;
}

function toFileUrl(relativeOrAbsolutePath) {
  const absolutePath = path.resolve(String(relativeOrAbsolutePath || ""));
  return pathToFileURL(absolutePath).toString();
}

export function formatLocalDocLink(label, relativeOrAbsolutePath) {
  const displayLabel = String(label || "").trim() || String(relativeOrAbsolutePath || "").trim();
  const docPath = String(relativeOrAbsolutePath || "").trim();
  if (!docPath) {
    return displayLabel;
  }
  const target = toFileUrl(docPath);
  const forceOsc8 = process.env.JOB_FINDER_FORCE_OSC8 === "1";
  if (!forceOsc8 && !shouldEmitOsc8()) {
    return displayLabel;
  }
  return osc8Link(displayLabel, target);
}

export function formatHttpLink(label, url, options = {}) {
  const displayLabel = String(label || "").trim() || String(url || "").trim();
  const target = String(url || "").trim();
  if (!target) {
    return displayLabel;
  }
  const forceOsc8 = Boolean(options.forceOsc8) || process.env.JOB_FINDER_FORCE_OSC8 === "1";
  if (!forceOsc8 && !shouldEmitOsc8()) {
    return displayLabel;
  }
  return osc8Link(displayLabel, target);
}
