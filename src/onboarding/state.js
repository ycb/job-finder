import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_SETTINGS_PATH = "data/user-settings.json";
const SUPPORTED_CHANNELS = new Set(["npm", "claude", "codex", "unknown"]);

function nowIso() {
  return new Date().toISOString();
}

function resolveSettingsPath(settingsPath = DEFAULT_SETTINGS_PATH) {
  return path.resolve(String(settingsPath || DEFAULT_SETTINGS_PATH));
}

function normalizeChannel(rawChannel) {
  const normalized = String(rawChannel || "").trim().toLowerCase();
  if (!normalized) {
    return "unknown";
  }

  if (SUPPORTED_CHANNELS.has(normalized)) {
    return normalized;
  }

  return "unknown";
}

export function inferChannel(env = process.env) {
  const userAgent = String(env?.npm_config_user_agent || "").toLowerCase();
  const execPath = String(env?._ || "").toLowerCase();
  const codexHome = String(env?.CODEX_HOME || "").trim();
  const codexEnv = String(env?.CODEX_ENV || "").trim();
  const claudeProject = String(env?.CLAUDE_PROJECT_DIR || "").trim();
  const claudeCode = String(env?.CLAUDECODE || "").trim();

  if (claudeProject || claudeCode) {
    return { channel: "claude", confidence: "inferred" };
  }

  if (codexHome || codexEnv || execPath.includes("/.codex/")) {
    return { channel: "codex", confidence: "inferred" };
  }

  if (userAgent.includes("npm")) {
    return { channel: "npm", confidence: "inferred" };
  }

  return { channel: "unknown", confidence: "unknown" };
}

function defaultSettings() {
  const inferred = inferChannel();

  return {
    version: 1,
    installId: crypto.randomUUID(),
    analytics: {
      enabled: true,
      updatedAt: nowIso()
    },
    onboarding: {
      startedAt: nowIso(),
      completed: false,
      completedAt: null,
      firstRunAt: null,
      channel: {
        value: inferred.channel,
        confidence: inferred.confidence,
        updatedAt: nowIso()
      },
      selectedSourceIds: [],
      checks: {
        sources: {}
      }
    },
    monetization: {
      plan: "free",
      dailyViewLimit: 10,
      dailyViewCount: 0,
      dailyViewDate: null
    }
  };
}

function normalizeSettings(rawSettings) {
  const defaults = defaultSettings();
  const input =
    rawSettings && typeof rawSettings === "object" && !Array.isArray(rawSettings)
      ? rawSettings
      : {};
  const onboardingInput =
    input.onboarding && typeof input.onboarding === "object" && !Array.isArray(input.onboarding)
      ? input.onboarding
      : {};
  const analyticsInput =
    input.analytics && typeof input.analytics === "object" && !Array.isArray(input.analytics)
      ? input.analytics
      : {};
  const monetizationInput =
    input.monetization &&
    typeof input.monetization === "object" &&
    !Array.isArray(input.monetization)
      ? input.monetization
      : {};
  const checksInput =
    onboardingInput.checks &&
    typeof onboardingInput.checks === "object" &&
    !Array.isArray(onboardingInput.checks)
      ? onboardingInput.checks
      : {};
  const sourceChecksInput =
    checksInput.sources &&
    typeof checksInput.sources === "object" &&
    !Array.isArray(checksInput.sources)
      ? checksInput.sources
      : {};

  return {
    version: 1,
    installId: String(input.installId || defaults.installId).trim() || defaults.installId,
    analytics: {
      enabled:
        typeof analyticsInput.enabled === "boolean"
          ? analyticsInput.enabled
          : defaults.analytics.enabled,
      updatedAt: String(analyticsInput.updatedAt || defaults.analytics.updatedAt)
    },
    onboarding: {
      startedAt: String(onboardingInput.startedAt || defaults.onboarding.startedAt),
      completed: Boolean(onboardingInput.completed),
      completedAt:
        onboardingInput.completedAt && String(onboardingInput.completedAt).trim()
          ? String(onboardingInput.completedAt)
          : null,
      firstRunAt:
        onboardingInput.firstRunAt && String(onboardingInput.firstRunAt).trim()
          ? String(onboardingInput.firstRunAt)
          : null,
      channel: {
        value: normalizeChannel(onboardingInput?.channel?.value || defaults.onboarding.channel.value),
        confidence: String(
          onboardingInput?.channel?.confidence || defaults.onboarding.channel.confidence
        ),
        updatedAt: String(
          onboardingInput?.channel?.updatedAt || defaults.onboarding.channel.updatedAt
        )
      },
      selectedSourceIds: Array.isArray(onboardingInput.selectedSourceIds)
        ? [...new Set(onboardingInput.selectedSourceIds.map((value) => String(value || "").trim()).filter(Boolean))]
        : [],
      checks: {
        sources: sourceChecksInput
      }
    },
    monetization: {
      plan: String(monetizationInput.plan || defaults.monetization.plan),
      dailyViewLimit: Number.isFinite(Number(monetizationInput.dailyViewLimit))
        ? Math.max(0, Math.round(Number(monetizationInput.dailyViewLimit)))
        : defaults.monetization.dailyViewLimit,
      dailyViewCount: Number.isFinite(Number(monetizationInput.dailyViewCount))
        ? Math.max(0, Math.round(Number(monetizationInput.dailyViewCount)))
        : defaults.monetization.dailyViewCount,
      dailyViewDate:
        monetizationInput.dailyViewDate && String(monetizationInput.dailyViewDate).trim()
          ? String(monetizationInput.dailyViewDate)
          : null
    }
  };
}

function writeSettings(settings, settingsPath = DEFAULT_SETTINGS_PATH) {
  const resolvedPath = resolveSettingsPath(settingsPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, `${JSON.stringify(normalizeSettings(settings), null, 2)}\n`, "utf8");
}

export function loadUserSettings(settingsPath = DEFAULT_SETTINGS_PATH) {
  const resolvedPath = resolveSettingsPath(settingsPath);
  if (!fs.existsSync(resolvedPath)) {
    const defaults = defaultSettings();
    writeSettings(defaults, resolvedPath);
    return {
      path: resolvedPath,
      settings: defaults
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
    const normalized = normalizeSettings(parsed);
    writeSettings(normalized, resolvedPath);
    return {
      path: resolvedPath,
      settings: normalized
    };
  } catch {
    const defaults = defaultSettings();
    writeSettings(defaults, resolvedPath);
    return {
      path: resolvedPath,
      settings: defaults
    };
  }
}

export function saveUserSettings(settings, settingsPath = DEFAULT_SETTINGS_PATH) {
  const normalized = normalizeSettings(settings);
  const resolvedPath = resolveSettingsPath(settingsPath);
  writeSettings(normalized, resolvedPath);
  return {
    path: resolvedPath,
    settings: normalized
  };
}

export function updateUserSettings(updater, settingsPath = DEFAULT_SETTINGS_PATH) {
  const current = loadUserSettings(settingsPath);
  const next = typeof updater === "function" ? updater(current.settings) : current.settings;
  return saveUserSettings(next, settingsPath);
}

export function updateOnboardingChannel(channel, confidence = "self_reported", settingsPath) {
  const normalizedChannel = normalizeChannel(channel);
  return updateUserSettings((settings) => ({
    ...settings,
    onboarding: {
      ...settings.onboarding,
      channel: {
        value: normalizedChannel,
        confidence: String(confidence || "self_reported"),
        updatedAt: nowIso()
      }
    }
  }), settingsPath);
}

export function updateAnalyticsPreference(enabled, settingsPath) {
  const isEnabled = Boolean(enabled);
  return updateUserSettings((settings) => ({
    ...settings,
    analytics: {
      ...settings.analytics,
      enabled: isEnabled,
      updatedAt: nowIso()
    }
  }), settingsPath);
}

export function updateOnboardingSources(sourceIds, settingsPath) {
  const normalizedSourceIds = [...new Set((Array.isArray(sourceIds) ? sourceIds : []).map((value) => String(value || "").trim()).filter(Boolean))];

  return updateUserSettings((settings) => ({
    ...settings,
    onboarding: {
      ...settings.onboarding,
      selectedSourceIds: normalizedSourceIds
    }
  }), settingsPath);
}

export function updateOnboardingSourceCheck(sourceId, result, settingsPath) {
  const normalizedSourceId = String(sourceId || "").trim();
  if (!normalizedSourceId) {
    throw new Error("sourceId is required.");
  }

  return updateUserSettings((settings) => ({
    ...settings,
    onboarding: {
      ...settings.onboarding,
      checks: {
        ...settings.onboarding.checks,
        sources: {
          ...(settings.onboarding?.checks?.sources || {}),
          [normalizedSourceId]: {
            ...(result && typeof result === "object" ? result : {}),
            checkedAt: nowIso()
          }
        }
      }
    }
  }), settingsPath);
}

export function markFirstRunCompleted(settingsPath) {
  return updateUserSettings((settings) => ({
    ...settings,
    onboarding: {
      ...settings.onboarding,
      firstRunAt: nowIso()
    }
  }), settingsPath);
}

export function markOnboardingCompleted(settingsPath) {
  return updateUserSettings((settings) => ({
    ...settings,
    onboarding: {
      ...settings.onboarding,
      completed: true,
      completedAt: nowIso()
    }
  }), settingsPath);
}

export function getEffectiveOnboardingChannel(settings, env = process.env) {
  const current = normalizeSettings(settings);
  if (current.onboarding.channel.value && current.onboarding.channel.value !== "unknown") {
    return current.onboarding.channel;
  }

  return inferChannel(env);
}

