import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ANALYTICS_SCHEMA_VERSION,
  createAnalyticsEnvelope,
  normalizeAnalyticsChannel,
  normalizeIdentityMode
} from "./events.js";

function ensureParentDir(filePath) {
  const resolved = path.resolve(String(filePath || "").trim());
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  return resolved;
}

function readJsonObject(filePath, fallback = {}) {
  const resolved = path.resolve(String(filePath || "").trim());
  if (!resolved || !fs.existsSync(resolved)) {
    return { ...fallback };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    return { ...fallback };
  }

  return { ...fallback };
}

function defaultEventsPath() {
  return path.resolve("data/analytics/events.jsonl");
}

function defaultCountersPath() {
  return path.resolve("data/analytics/counters.json");
}

export function buildMachineHashDistinctId(hostname = os.hostname()) {
  const input = String(hostname || "job-finder").trim().toLowerCase();
  const hash = crypto.createHash("sha256").update(input).digest("hex").slice(0, 16);
  return `machine:${hash}`;
}

function resolveDistinctId(identityMode, explicitDistinctId = "") {
  const explicit = String(explicitDistinctId || "").trim();
  if (explicit) {
    return explicit;
  }

  if (identityMode === "anonymous_session") {
    return `session:${crypto.randomUUID()}`;
  }

  return buildMachineHashDistinctId();
}

export function readAnalyticsCounters(countersPath = defaultCountersPath()) {
  const fallback = {
    schemaVersion: ANALYTICS_SCHEMA_VERSION,
    updatedAt: null,
    totals: {
      events: 0
    },
    byEvent: {},
    byChannel: {}
  };
  const parsed = readJsonObject(countersPath, fallback);

  return {
    schemaVersion: String(parsed.schemaVersion || ANALYTICS_SCHEMA_VERSION),
    updatedAt: parsed.updatedAt || null,
    totals: {
      events: Number.isFinite(Number(parsed?.totals?.events))
        ? Number(parsed.totals.events)
        : 0
    },
    byEvent:
      parsed.byEvent && typeof parsed.byEvent === "object" && !Array.isArray(parsed.byEvent)
        ? parsed.byEvent
        : {},
    byChannel:
      parsed.byChannel &&
      typeof parsed.byChannel === "object" &&
      !Array.isArray(parsed.byChannel)
        ? parsed.byChannel
        : {}
  };
}

function persistAnalyticsCounters(countersPath, counters) {
  const resolved = ensureParentDir(countersPath);
  fs.writeFileSync(resolved, `${JSON.stringify(counters, null, 2)}\n`, "utf8");
}

function appendAnalyticsEvent(eventsPath, envelope) {
  const resolved = ensureParentDir(eventsPath);
  fs.appendFileSync(resolved, `${JSON.stringify(envelope)}\n`, "utf8");
}

function incrementCounters(counters, envelope) {
  const next = {
    ...counters,
    schemaVersion: ANALYTICS_SCHEMA_VERSION,
    updatedAt: envelope.occurredAt,
    totals: {
      events: Number(counters?.totals?.events || 0) + 1
    },
    byEvent: {
      ...(counters?.byEvent || {})
    },
    byChannel: {
      ...(counters?.byChannel || {})
    }
  };

  next.byEvent[envelope.event] = Number(next.byEvent[envelope.event] || 0) + 1;
  next.byChannel[envelope.channel] = Number(next.byChannel[envelope.channel] || 0) + 1;

  return next;
}

function normalizePosthogHost(host) {
  const normalized = String(host || "").trim();
  if (!normalized) {
    return "https://us.i.posthog.com";
  }

  return normalized.replace(/\/+$/, "");
}

export function createAnalyticsClient(options = {}) {
  const baseChannel = normalizeAnalyticsChannel(
    options.channel || process.env.JOB_FINDER_ANALYTICS_CHANNEL || "terminal"
  );
  const baseIdentityMode = normalizeIdentityMode(
    options.identityMode || process.env.JOB_FINDER_ANALYTICS_IDENTITY_MODE || "machine_hash"
  );
  const baseDistinctId = resolveDistinctId(baseIdentityMode, options.distinctId);
  const eventsPath = options.eventsPath || process.env.JOB_FINDER_ANALYTICS_EVENTS_PATH || defaultEventsPath();
  const countersPath =
    options.countersPath || process.env.JOB_FINDER_ANALYTICS_COUNTERS_PATH || defaultCountersPath();
  const posthogApiKey = String(
    options.posthogApiKey !== undefined
      ? options.posthogApiKey
      : process.env.POSTHOG_API_KEY || ""
  ).trim();
  const posthogHost = normalizePosthogHost(
    options.posthogHost !== undefined
      ? options.posthogHost
      : process.env.POSTHOG_HOST || ""
  );
  const fetchImpl =
    options.fetchImpl ||
    (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null);

  async function track(eventName, properties = {}, context = {}) {
    const channel = normalizeAnalyticsChannel(context.channel, baseChannel);
    const identityMode = normalizeIdentityMode(context.identityMode, baseIdentityMode);
    const distinctId = resolveDistinctId(identityMode, context.distinctId || baseDistinctId);
    const envelope = createAnalyticsEnvelope(eventName, properties, {
      channel,
      identityMode,
      distinctId,
      occurredAt: context.occurredAt
    });

    try {
      appendAnalyticsEvent(eventsPath, envelope);
      const counters = readAnalyticsCounters(countersPath);
      const nextCounters = incrementCounters(counters, envelope);
      persistAnalyticsCounters(countersPath, nextCounters);
    } catch {
      // Never block runtime flow on analytics persistence.
    }

    if (posthogApiKey && fetchImpl) {
      const payload = {
        api_key: posthogApiKey,
        event: envelope.posthog.event,
        distinct_id: envelope.distinctId,
        properties: envelope.posthog.properties,
        timestamp: envelope.occurredAt
      };

      try {
        await fetchImpl(`${posthogHost}/capture/`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });
      } catch {
        // Never block runtime flow on analytics transport.
      }
    }

    return envelope;
  }

  return {
    channel: baseChannel,
    identityMode: baseIdentityMode,
    distinctId: baseDistinctId,
    track
  };
}
