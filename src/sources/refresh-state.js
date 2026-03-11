import fs from "node:fs";
import path from "node:path";

const DEFAULT_STATE_PATH = "data/refresh-state.json";
const MAX_EVENT_HISTORY = 500;
const SUPPORTED_OUTCOMES = new Set(["success", "transient_error", "challenge"]);
const SUPPORTED_MODES = new Set(["scheduled", "manual"]);
const CHALLENGE_PATTERNS = [
  /\bcaptcha\b/i,
  /\bverify (?:you(?:'|’)re|you are) human\b/i,
  /\bare you human\b/i,
  /\bunusual traffic\b/i,
  /\bbot protection\b/i,
  /\bautomated quer(?:y|ies)\b/i,
  /\baccess denied\b/i,
  /\btemporarily blocked\b/i
];

function defaultState() {
  return {
    version: 1,
    sources: {}
  };
}

function parseTimestamp(rawValue) {
  const parsed = Date.parse(String(rawValue || "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeOutcome(rawOutcome) {
  const normalized = String(rawOutcome || "").trim().toLowerCase();
  if (!SUPPORTED_OUTCOMES.has(normalized)) {
    throw new Error(
      `Unsupported refresh outcome "${rawOutcome}". Expected one of: success, transient_error, challenge.`
    );
  }
  return normalized;
}

function normalizeMode(rawMode) {
  const normalized = String(rawMode || "").trim().toLowerCase();
  if (!normalized) {
    return "scheduled";
  }

  if (!SUPPORTED_MODES.has(normalized)) {
    throw new Error(
      `Unsupported refresh mode "${rawMode}". Expected one of: scheduled, manual.`
    );
  }

  return normalized;
}

export function classifyRefreshErrorOutcome(errorLike) {
  const message =
    typeof errorLike === "string"
      ? errorLike
      : String(errorLike?.message || errorLike || "");

  for (const pattern of CHALLENGE_PATTERNS) {
    if (pattern.test(message)) {
      return "challenge";
    }
  }

  return "transient_error";
}

function resolveStatePath(statePath = DEFAULT_STATE_PATH) {
  return path.resolve(String(statePath || DEFAULT_STATE_PATH));
}

function normalizeSourceState(rawSourceState) {
  const sourceState =
    rawSourceState && typeof rawSourceState === "object" && !Array.isArray(rawSourceState)
      ? rawSourceState
      : {};

  const events = Array.isArray(sourceState.events)
    ? sourceState.events
        .filter(
          (event) =>
            event &&
            typeof event === "object" &&
            parseTimestamp(event.at) !== null &&
            SUPPORTED_OUTCOMES.has(String(event.outcome || "").trim().toLowerCase())
        )
        .map((event) => ({
          at: new Date(parseTimestamp(event.at)).toISOString(),
          outcome: String(event.outcome).trim().toLowerCase(),
          mode: normalizeMode(event.mode)
        }))
    : [];

  const lastLiveAtMs = parseTimestamp(sourceState.lastLiveAt);
  const cooldownUntilMs = parseTimestamp(sourceState.cooldownUntil);

  return {
    lastLiveAt: lastLiveAtMs !== null ? new Date(lastLiveAtMs).toISOString() : null,
    cooldownUntil: cooldownUntilMs !== null ? new Date(cooldownUntilMs).toISOString() : null,
    events: events.slice(-MAX_EVENT_HISTORY)
  };
}

function normalizeState(rawState) {
  const state =
    rawState && typeof rawState === "object" && !Array.isArray(rawState)
      ? rawState
      : defaultState();
  const sources =
    state.sources && typeof state.sources === "object" && !Array.isArray(state.sources)
      ? state.sources
      : {};

  const normalizedSources = {};
  for (const [sourceId, sourceState] of Object.entries(sources)) {
    const normalizedSourceId = String(sourceId || "").trim();
    if (!normalizedSourceId) {
      continue;
    }
    normalizedSources[normalizedSourceId] = normalizeSourceState(sourceState);
  }

  return {
    version: 1,
    sources: normalizedSources
  };
}

function writeRefreshState(state, statePath = DEFAULT_STATE_PATH) {
  const resolvedPath = resolveStatePath(statePath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, `${JSON.stringify(normalizeState(state), null, 2)}\n`, "utf8");
}

export function ensureRefreshStateFile(statePath = DEFAULT_STATE_PATH) {
  const resolvedPath = resolveStatePath(statePath);

  if (!fs.existsSync(resolvedPath)) {
    writeRefreshState(defaultState(), resolvedPath);
  }

  return readRefreshState(resolvedPath);
}

export function readRefreshState(statePath = DEFAULT_STATE_PATH) {
  const resolvedPath = resolveStatePath(statePath);

  if (!fs.existsSync(resolvedPath)) {
    return ensureRefreshStateFile(resolvedPath);
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
    const normalized = normalizeState(parsed);
    writeRefreshState(normalized, resolvedPath);
    return normalized;
  } catch {
    const fresh = defaultState();
    writeRefreshState(fresh, resolvedPath);
    return fresh;
  }
}

export function resolveSourceRefreshState(state, sourceId) {
  const normalizedState = normalizeState(state);
  const normalizedSourceId = String(sourceId || "").trim();
  if (!normalizedSourceId) {
    throw new Error("sourceId is required.");
  }

  return (
    normalizedState.sources[normalizedSourceId] || {
      lastLiveAt: null,
      cooldownUntil: null,
      events: []
    }
  );
}

export function countSourceEventsForUtcDay(state, sourceId, dayValue = Date.now(), options = {}) {
  const sourceState = resolveSourceRefreshState(state, sourceId);
  const dayMs = parseTimestamp(dayValue) ?? Number(dayValue);
  const effectiveDayMs = Number.isFinite(dayMs) ? dayMs : Date.now();
  const requestedMode =
    options && typeof options.mode === "string" ? normalizeMode(options.mode) : null;
  const day = new Date(effectiveDayMs);
  const startMs = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  const endMs = startMs + 24 * 60 * 60 * 1000;

  return sourceState.events.reduce((count, event) => {
    const eventMs = parseTimestamp(event.at);
    if (eventMs === null) {
      return count;
    }
    if (requestedMode && normalizeMode(event.mode) !== requestedMode) {
      return count;
    }
    return eventMs >= startMs && eventMs < endMs ? count + 1 : count;
  }, 0);
}

export function recordRefreshEvent({
  statePath = DEFAULT_STATE_PATH,
  sourceId,
  outcome,
  at,
  mode = "scheduled",
  cooldownMinutes = 0
}) {
  const normalizedSourceId = String(sourceId || "").trim();
  if (!normalizedSourceId) {
    throw new Error("sourceId is required.");
  }

  const normalizedOutcome = normalizeOutcome(outcome);
  const normalizedMode = normalizeMode(mode);
  const eventMs = parseTimestamp(at) ?? Date.now();
  const eventAt = new Date(eventMs).toISOString();

  const state = readRefreshState(statePath);
  const sourceState = resolveSourceRefreshState(state, normalizedSourceId);
  const nextSourceState = {
    ...sourceState,
    events: [...sourceState.events, { at: eventAt, outcome: normalizedOutcome, mode: normalizedMode }].slice(
      -MAX_EVENT_HISTORY
    )
  };

  if (normalizedOutcome === "success") {
    nextSourceState.lastLiveAt = eventAt;
  }

  if (normalizedOutcome === "challenge") {
    const cooldownMs = Math.max(0, Number(cooldownMinutes) || 0) * 60 * 1000;
    const nextCooldownMs = eventMs + cooldownMs;
    const existingCooldownMs = parseTimestamp(sourceState.cooldownUntil) ?? 0;
    const effectiveCooldownMs = Math.max(existingCooldownMs, nextCooldownMs);
    nextSourceState.cooldownUntil =
      effectiveCooldownMs > 0 ? new Date(effectiveCooldownMs).toISOString() : null;
  }

  const nextState = {
    ...state,
    sources: {
      ...state.sources,
      [normalizedSourceId]: nextSourceState
    }
  };

  writeRefreshState(nextState, statePath);
  return nextState.sources[normalizedSourceId];
}
