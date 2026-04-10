import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PostHog } from "posthog-node";

const ANALYTICS_MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(ANALYTICS_MODULE_DIR, "../..");
let didBootstrapRuntimeEnv = false;

export function parseDotenvValue(rawValue) {
  const trimmed = String(rawValue || "").trim();
  if (!trimmed) {
    return "";
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    const quote = trimmed[0];
    const inner = trimmed.slice(1, -1);
    if (quote === '"') {
      return inner
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    }
    return inner;
  }

  return trimmed.replace(/\s+#.*$/, "");
}

export function loadDotenvFile(dotenvPath) {
  if (!dotenvPath || !fs.existsSync(dotenvPath)) {
    return false;
  }

  const content = fs.readFileSync(dotenvPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const normalized = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const separatorIndex = normalized.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = normalized.slice(0, separatorIndex).trim();
    if (!key) {
      continue;
    }

    if (process.env[key] !== undefined && process.env[key] !== "") {
      continue;
    }

    const rawValue = normalized.slice(separatorIndex + 1);
    process.env[key] = parseDotenvValue(rawValue);
  }

  return true;
}

export function ensureRuntimeEnvLoaded() {
  const hasApiKey = String(process.env.POSTHOG_API_KEY || "").trim().length > 0;
  const hasHost = String(process.env.POSTHOG_HOST || "").trim().length > 0;
  if (didBootstrapRuntimeEnv && hasApiKey && hasHost) {
    return;
  }
  didBootstrapRuntimeEnv = true;

  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(PROJECT_ROOT, ".env")
  ];
  const seen = new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    if (loadDotenvFile(candidate)) {
      break;
    }
  }
}

export function normalizePosthogHost(host) {
  const normalized = String(host || "").trim();
  if (!normalized) {
    return "https://us.i.posthog.com";
  }

  return normalized.replace(/\/+$/, "");
}

export function resolvePosthogConfig(options = {}) {
  ensureRuntimeEnvLoaded();

  return {
    apiKey: String(
      options.apiKey !== undefined ? options.apiKey : process.env.POSTHOG_API_KEY || ""
    ).trim(),
    host: normalizePosthogHost(
      options.host !== undefined ? options.host : process.env.POSTHOG_HOST || ""
    )
  };
}

export function createPosthogNodeErrorTrackingClient(options = {}) {
  const { apiKey, host } = resolvePosthogConfig({
    apiKey: options.apiKey,
    host: options.host
  });
  if (!apiKey) {
    return null;
  }

  const PostHogCtor = options.PostHogCtor || PostHog;
  return new PostHogCtor(apiKey, {
    host,
    enableExceptionAutocapture: true,
    ...(options.clientOptions || {})
  });
}
