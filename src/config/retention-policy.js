import fs from "node:fs";
import path from "node:path";

export const DEFAULT_RETENTION_POLICY_PATH = "config/retention-policy.json";

export const DEFAULT_RETENTION_POLICY = Object.freeze({
  enabled: true,
  statusTtlDays: {
    new: 30,
    viewed: 45,
    skip_for_now: 21,
    rejected: 14,
    applied: null
  }
});

const RETENTION_STATUSES = [
  "new",
  "viewed",
  "skip_for_now",
  "rejected",
  "applied"
];

function cloneDefaultPolicy() {
  return {
    enabled: DEFAULT_RETENTION_POLICY.enabled,
    statusTtlDays: { ...DEFAULT_RETENTION_POLICY.statusTtlDays }
  };
}

function normalizeTtlDays(value, label) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (
    typeof value === "string" &&
    String(value).trim().toLowerCase() === "never"
  ) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive number or null.`);
  }

  return Math.round(parsed);
}

export function resolveRetentionPolicyPath(explicitPath = "") {
  const explicit = String(explicitPath || "").trim();
  if (explicit) {
    return explicit;
  }

  const fromEnv = String(process.env.JOB_FINDER_RETENTION_POLICY_PATH || "").trim();
  if (fromEnv) {
    return fromEnv;
  }

  return DEFAULT_RETENTION_POLICY_PATH;
}

export function normalizeRetentionPolicy(rawPolicy = {}) {
  const normalized = cloneDefaultPolicy();

  if (!rawPolicy || typeof rawPolicy !== "object" || Array.isArray(rawPolicy)) {
    return normalized;
  }

  if (rawPolicy.enabled !== undefined) {
    normalized.enabled = Boolean(rawPolicy.enabled);
  }

  const rawTtls =
    rawPolicy.statusTtlDays &&
    typeof rawPolicy.statusTtlDays === "object" &&
    !Array.isArray(rawPolicy.statusTtlDays)
      ? rawPolicy.statusTtlDays
      : {};

  for (const status of RETENTION_STATUSES) {
    if (!Object.prototype.hasOwnProperty.call(rawTtls, status)) {
      continue;
    }
    normalized.statusTtlDays[status] = normalizeTtlDays(
      rawTtls[status],
      `Retention policy statusTtlDays.${status}`
    );
  }

  return normalized;
}

function readRetentionPolicyFile(policyPath) {
  const resolvedPath = path.resolve(policyPath);
  if (!fs.existsSync(resolvedPath)) {
    return {
      exists: false,
      raw: {}
    };
  }

  const text = fs.readFileSync(resolvedPath, "utf8");
  try {
    const parsed = JSON.parse(text);
    return {
      exists: true,
      raw: parsed
    };
  } catch (error) {
    throw new Error(`Invalid JSON in retention policy ${resolvedPath}: ${error.message}`);
  }
}

export function loadRetentionPolicy(policyPath = "") {
  const resolvedSettingPath = resolveRetentionPolicyPath(policyPath);
  const resolvedPath = path.resolve(resolvedSettingPath);
  const fromFile = readRetentionPolicyFile(resolvedSettingPath);
  const normalized = normalizeRetentionPolicy(fromFile.raw);

  return {
    path: resolvedPath,
    exists: fromFile.exists,
    policy: normalized
  };
}

export function saveRetentionPolicy(policy, policyPath = "") {
  const resolvedSettingPath = resolveRetentionPolicyPath(policyPath);
  const resolvedPath = path.resolve(resolvedSettingPath);
  const normalized = normalizeRetentionPolicy(policy);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");

  return {
    path: resolvedPath,
    policy: normalized
  };
}
