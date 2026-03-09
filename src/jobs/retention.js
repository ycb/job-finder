import fs from "node:fs";
import path from "node:path";

const DEFAULT_RETENTION_AUDIT_PATH = "data/retention/cleanup-audit.jsonl";
const RETENTION_STATUSES = ["new", "viewed", "skip_for_now", "rejected", "applied"];
const DAY_MS = 24 * 60 * 60 * 1000;

function isFinitePositiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

export function resolveRetentionAuditPath(explicitPath = "") {
  const explicit = String(explicitPath || "").trim();
  if (explicit) {
    return explicit;
  }

  const fromEnv = String(process.env.JOB_FINDER_RETENTION_AUDIT_PATH || "").trim();
  if (fromEnv) {
    return fromEnv;
  }

  return DEFAULT_RETENTION_AUDIT_PATH;
}

function countJobsByStatus(db, status) {
  const row = db
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM jobs j
      LEFT JOIN applications a ON a.job_id = j.id
      WHERE COALESCE(a.status, 'new') = ?;
    `
    )
    .get(status);

  return Number(row?.count || 0);
}

export function applyRetentionPolicyCleanup(db, policy, options = {}) {
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const executedAt = new Date(nowMs).toISOString();

  const normalizedPolicy =
    policy && typeof policy === "object" && !Array.isArray(policy)
      ? policy
      : {
          enabled: false,
          statusTtlDays: {}
        };
  const enabled = normalizedPolicy.enabled !== false;
  const statusTtlDays =
    normalizedPolicy.statusTtlDays &&
    typeof normalizedPolicy.statusTtlDays === "object" &&
    !Array.isArray(normalizedPolicy.statusTtlDays)
      ? normalizedPolicy.statusTtlDays
      : {};

  const deletedByStatus = {
    new: 0,
    viewed: 0,
    skip_for_now: 0,
    rejected: 0,
    applied: 0
  };

  const protectedCounts = {
    applied: countJobsByStatus(db, "applied")
  };

  if (!enabled) {
    return {
      executedAt,
      enabled: false,
      statusTtlDays: { ...statusTtlDays },
      deletedByStatus,
      totalDeleted: 0,
      protected: protectedCounts
    };
  }

  const deleteStmt = db.prepare(
    `
    DELETE FROM jobs
    WHERE id IN (
      SELECT j.id
      FROM jobs j
      LEFT JOIN applications a ON a.job_id = j.id
      WHERE COALESCE(a.status, 'new') = ?
        AND COALESCE(a.last_action_at, j.updated_at, j.created_at) <= ?
    );
  `
  );

  for (const status of RETENTION_STATUSES) {
    if (status === "applied") {
      continue;
    }

    const ttlDays = statusTtlDays[status];
    if (!isFinitePositiveNumber(ttlDays)) {
      continue;
    }

    const cutoff = new Date(nowMs - Number(ttlDays) * DAY_MS).toISOString();
    const result = deleteStmt.run(status, cutoff);
    deletedByStatus[status] = Number(result?.changes || 0);
  }

  const totalDeleted = Object.values(deletedByStatus).reduce(
    (sum, value) => sum + Number(value || 0),
    0
  );

  return {
    executedAt,
    enabled: true,
    statusTtlDays: { ...statusTtlDays },
    deletedByStatus,
    totalDeleted,
    protected: protectedCounts
  };
}

export function writeRetentionCleanupAudit(cleanupSummary, auditPath = "") {
  const resolved = path.resolve(resolveRetentionAuditPath(auditPath));
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.appendFileSync(resolved, `${JSON.stringify(cleanupSummary)}\n`, "utf8");
  return resolved;
}
