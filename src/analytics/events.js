export const ANALYTICS_SCHEMA_VERSION = "2026-03-08";

export const ANALYTICS_CHANNELS = new Set([
  "terminal",
  "dashboard",
  "codex",
  "claude"
]);

export const ANALYTICS_IDENTITY_MODES = new Set([
  "machine_hash",
  "anonymous_session"
]);

export const ANALYTICS_EVENT_REGISTRY = Object.freeze({
  pipeline_run_completed: {
    posthogEvent: "jf_pipeline_run_completed",
    description: "CLI run pipeline completed"
  },
  jobs_synced: {
    posthogEvent: "jf_jobs_synced",
    description: "Jobs synced from configured sources"
  },
  jobs_scored: {
    posthogEvent: "jf_jobs_scored",
    description: "Jobs scored against active profile/criteria"
  },
  shortlist_generated: {
    posthogEvent: "jf_shortlist_generated",
    description: "Shortlist generated"
  },
  source_added: {
    posthogEvent: "jf_source_added",
    description: "Source added via CLI or dashboard"
  },
  source_captured_live: {
    posthogEvent: "jf_source_captured_live",
    description: "Live capture executed for source"
  },
  capture_quality_rejected: {
    posthogEvent: "jf_capture_quality_rejected",
    description: "Capture quality guardrail rejected ingest"
  },
  job_status_changed: {
    posthogEvent: "jf_job_status_changed",
    description: "Job status changed in dashboard"
  },
  sync_score_completed: {
    posthogEvent: "jf_sync_score_completed",
    description: "Dashboard sync+score completed"
  },
  source_run_completed: {
    posthogEvent: "jf_source_run_completed",
    description: "Single source run completed from dashboard"
  },
  search_criteria_updated: {
    posthogEvent: "jf_search_criteria_updated",
    description: "Search criteria updated from dashboard"
  },
  profile_source_changed: {
    posthogEvent: "jf_profile_source_changed",
    description: "Profile source switched from dashboard"
  }
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeAnalyticsChannel(rawChannel, fallback = "terminal") {
  const normalized = String(rawChannel || "").trim().toLowerCase();
  if (ANALYTICS_CHANNELS.has(normalized)) {
    return normalized;
  }

  const fallbackChannel = String(fallback || "").trim().toLowerCase();
  return ANALYTICS_CHANNELS.has(fallbackChannel) ? fallbackChannel : "terminal";
}

export function normalizeIdentityMode(rawMode, fallback = "machine_hash") {
  const normalized = String(rawMode || "").trim().toLowerCase();
  if (ANALYTICS_IDENTITY_MODES.has(normalized)) {
    return normalized;
  }

  const fallbackMode = String(fallback || "").trim().toLowerCase();
  return ANALYTICS_IDENTITY_MODES.has(fallbackMode)
    ? fallbackMode
    : "machine_hash";
}

export function createAnalyticsEnvelope(eventName, properties = {}, options = {}) {
  const normalizedEvent = String(eventName || "").trim();
  if (!normalizedEvent || !ANALYTICS_EVENT_REGISTRY[normalizedEvent]) {
    throw new Error(
      `Unknown analytics event "${normalizedEvent || "unknown"}". Add it to ANALYTICS_EVENT_REGISTRY first.`
    );
  }

  const channel = normalizeAnalyticsChannel(options.channel, "terminal");
  const identityMode = normalizeIdentityMode(options.identityMode, "machine_hash");
  const distinctId = String(options.distinctId || "").trim();
  if (!distinctId) {
    throw new Error("Analytics distinctId is required.");
  }

  const occurredAt = String(options.occurredAt || "").trim() || new Date().toISOString();
  const safeProperties = isPlainObject(properties) ? properties : {};
  const posthogEvent = ANALYTICS_EVENT_REGISTRY[normalizedEvent].posthogEvent;

  return {
    schemaVersion: ANALYTICS_SCHEMA_VERSION,
    occurredAt,
    event: normalizedEvent,
    channel,
    identityMode,
    distinctId,
    properties: safeProperties,
    posthog: {
      event: posthogEvent,
      properties: {
        ...safeProperties,
        channel,
        identity_mode: identityMode,
        schema_version: ANALYTICS_SCHEMA_VERSION
      }
    }
  };
}
