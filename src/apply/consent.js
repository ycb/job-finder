import fs from "node:fs";
import path from "node:path";

const DEFAULT_SETTINGS_PATH = "data/user-settings.json";

function resolveSettingsPath(settingsPath = DEFAULT_SETTINGS_PATH) {
  return path.resolve(String(settingsPath || DEFAULT_SETTINGS_PATH));
}

function readSettings(settingsPath) {
  const resolvedPath = resolveSettingsPath(settingsPath);
  if (!fs.existsSync(resolvedPath)) {
    return {};
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

// Apply automation (draft-and-confirm form filling) is gated on one explicit
// user consent, stored in data/user-settings.json:
//
//   { "applyAutomationConsent": { "acceptedAt": "<ISO timestamp>" } }
//
// The consent copy shown to the user must state that Job Finder fills forms
// but never submits them, and that automating third-party sites may violate
// those sites' terms of service. See
// docs/plans/2026-07-10-apply-engine-mvp-execplan.md (Milestone 0).
export function hasApplyAutomationConsent(settingsPath) {
  const settings = readSettings(settingsPath);
  const consent = settings?.applyAutomationConsent;
  if (!consent || typeof consent !== "object") {
    return false;
  }

  const acceptedAt = String(consent.acceptedAt || "").trim();
  if (!acceptedAt) {
    return false;
  }

  return !Number.isNaN(new Date(acceptedAt).getTime());
}

export function recordApplyAutomationConsent({
  settingsPath,
  acceptedAt = new Date().toISOString()
} = {}) {
  const resolvedPath = resolveSettingsPath(settingsPath);
  const settings = readSettings(settingsPath);

  const normalizedAcceptedAt = String(acceptedAt || "").trim();
  if (
    !normalizedAcceptedAt ||
    Number.isNaN(new Date(normalizedAcceptedAt).getTime())
  ) {
    throw new Error(
      `Invalid apply-automation consent timestamp: "${acceptedAt}".`
    );
  }

  const nextSettings = {
    ...settings,
    applyAutomationConsent: {
      ...(settings.applyAutomationConsent || {}),
      acceptedAt: normalizedAcceptedAt
    }
  };

  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(
    resolvedPath,
    `${JSON.stringify(nextSettings, null, 2)}\n`,
    "utf8"
  );

  return nextSettings.applyAutomationConsent;
}
