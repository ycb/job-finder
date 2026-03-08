import { readSourceCaptureSummary } from "../sources/cache-policy.js";
import { collectJobsFromSource } from "../sources/linkedin-saved-search.js";

function normalizeStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "pass" || normalized === "warn" || normalized === "fail") {
    return normalized;
  }
  return "warn";
}

function sourceTypeNeedsBrowserAuth(sourceType) {
  return (
    sourceType === "linkedin_capture_file" ||
    sourceType === "wellfound_search" ||
    sourceType === "ashby_search" ||
    sourceType === "indeed_search" ||
    sourceType === "ziprecruiter_search" ||
    sourceType === "remoteok_search"
  );
}

function validUrl(searchUrl) {
  try {
    new URL(String(searchUrl || "").trim());
    return true;
  } catch {
    return false;
  }
}

export function checkEnvironmentReadiness(options = {}) {
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const provider = String(env.JOB_FINDER_BRIDGE_PROVIDER || "chrome_applescript")
    .trim()
    .toLowerCase();
  const nodeMajor = Number(String(process.versions.node || "").split(".")[0] || 0);
  const nodeOk = Number.isFinite(nodeMajor) && nodeMajor >= 20;

  const checks = [
    {
      id: "node",
      label: "Node.js 20+",
      status: nodeOk ? "pass" : "fail",
      userMessage: nodeOk
        ? `Node ${process.versions.node}`
        : `Node ${process.versions.node || "unknown"} is below 20.x.`
    },
    {
      id: "platform",
      label: "Platform support",
      status: platform === "darwin" ? "pass" : "warn",
      userMessage:
        platform === "darwin"
          ? "macOS detected (first-class onboarding path)."
          : "Non-macOS detected. Guided fallback is supported, but capture reliability may vary."
    }
  ];

  if (provider === "chrome_applescript") {
    checks.push({
      id: "chrome-apple-events",
      label: "Chrome Apple Events permission",
      status: platform === "darwin" ? "warn" : "warn",
      userMessage:
        platform === "darwin"
          ? "Verify once: Chrome -> View -> Developer -> Allow JavaScript from Apple Events."
          : "chrome_applescript is macOS-only; choose playwright_cli for non-macOS."
    });
  }

  return checks;
}

export function checkSourceAccess(source, options = {}) {
  const candidate = source && typeof source === "object" ? source : null;
  if (!candidate) {
    return {
      status: "fail",
      reasonCode: "source_missing",
      userMessage: "Source definition is missing.",
      technicalDetails: {}
    };
  }

  if (!candidate.enabled) {
    return {
      status: "warn",
      reasonCode: "source_disabled",
      userMessage: "Source is disabled.",
      technicalDetails: {
        sourceId: candidate.id
      }
    };
  }

  if (!validUrl(candidate.searchUrl)) {
    return {
      status: "fail",
      reasonCode: "invalid_search_url",
      userMessage: "Search URL is invalid.",
      technicalDetails: {
        searchUrl: candidate.searchUrl
      }
    };
  }

  const captureSummary = readSourceCaptureSummary(candidate);
  const captureStatus = String(captureSummary.status || "").trim().toLowerCase();
  const captureCount = Number(captureSummary.jobCount || 0);
  const capturedAt = captureSummary.capturedAt || null;
  const hasCapture = Boolean(candidate.capturePath);
  const isBrowserSource = sourceTypeNeedsBrowserAuth(candidate.type);

  if (captureStatus === "capture_error") {
    return {
      status: "fail",
      reasonCode: "capture_error",
      userMessage: "Latest capture file is unreadable or invalid.",
      technicalDetails: {
        sourceId: candidate.id,
        capturePath: candidate.capturePath || null
      }
    };
  }

  if (hasCapture && captureCount > 0) {
    return {
      status: "pass",
      reasonCode: "capture_ok",
      userMessage: `Captured ${captureCount} jobs.`,
      technicalDetails: {
        sourceId: candidate.id,
        capturedAt,
        captureCount
      }
    };
  }

  if (isBrowserSource) {
    return {
      status: "warn",
      reasonCode: "capture_required",
      userMessage:
        "No recent captured jobs yet. You may need to authenticate in browser and run capture.",
      technicalDetails: {
        sourceId: candidate.id,
        capturePath: candidate.capturePath || null,
        captureCount,
        capturedAt
      }
    };
  }

  if (options.probeLive === true) {
    try {
      const jobs = collectJobsFromSource(candidate);
      return {
        status: jobs.length > 0 ? "pass" : "warn",
        reasonCode: jobs.length > 0 ? "live_probe_ok" : "live_probe_empty",
        userMessage:
          jobs.length > 0
            ? `Live probe returned ${jobs.length} jobs.`
            : "Live probe returned 0 jobs. Check source URL/filters.",
        technicalDetails: {
          sourceId: candidate.id,
          jobCount: jobs.length
        }
      };
    } catch (error) {
      return {
        status: "fail",
        reasonCode: "live_probe_failed",
        userMessage: "Live probe failed. Check source URL and access.",
        technicalDetails: {
          sourceId: candidate.id,
          error: String(error?.message || error)
        }
      };
    }
  }

  return {
    status: "warn",
    reasonCode: "probe_skipped",
    userMessage: "Source check is not complete until first run.",
    technicalDetails: {
      sourceId: candidate.id
    }
  };
}

export function normalizeSourceCheckResult(result) {
  const output = result && typeof result === "object" ? result : {};
  return {
    status: normalizeStatus(output.status),
    reasonCode: String(output.reasonCode || "unknown"),
    userMessage: String(output.userMessage || ""),
    technicalDetails:
      output.technicalDetails &&
      typeof output.technicalDetails === "object" &&
      !Array.isArray(output.technicalDetails)
        ? output.technicalDetails
        : {}
  };
}

