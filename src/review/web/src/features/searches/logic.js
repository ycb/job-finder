export const SEARCHES_WELCOME_TOAST_SEEN_KEY = "jobFinder.searchesWelcomeToastSeen.v2";
export const SEARCH_RUN_CADENCE_KEY = "jobFinder.searchRunCadence";

const SEARCH_STATE_VALUES = new Set(["enabled", "disabled"]);
const SEARCH_RUN_CADENCE_VALUES = new Set(["12h", "daily", "weekly", "cached"]);

const SOURCE_KIND_ORDER = ["li", "bi", "id", "zr", "lf", "yc", "ah", "gg", "wf", "ro", "unknown"];

function normalizeExpectedFoundCount(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.max(0, Math.round(numeric)) : null;
}

export function normalizeSearchState(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return SEARCH_STATE_VALUES.has(normalized) ? normalized : "enabled";
}

export function normalizeRunCadence(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return SEARCH_RUN_CADENCE_VALUES.has(normalized) ? normalized : "12h";
}

export function sourceKindFromType(type) {
  if (type === "linkedin_capture_file") {
    return "li";
  }
  if (type === "builtin_search") {
    return "bi";
  }
  if (type === "wellfound_search") {
    return "wf";
  }
  if (type === "ashby_search") {
    return "ah";
  }
  if (type === "google_search") {
    return "gg";
  }
  if (type === "indeed_search") {
    return "id";
  }
  if (type === "ziprecruiter_search") {
    return "zr";
  }
  if (type === "levelsfyi_search") {
    return "lf";
  }
  if (type === "yc_jobs") {
    return "yc";
  }
  if (type === "remoteok_search") {
    return "ro";
  }
  return "unknown";
}

export function sourceKindLabel(kind) {
  if (kind === "bi") {
    return "Built In";
  }
  if (kind === "li") {
    return "LinkedIn";
  }
  if (kind === "wf") {
    return "Wellfound";
  }
  if (kind === "ah") {
    return "Ashby";
  }
  if (kind === "gg") {
    return "Google";
  }
  if (kind === "id") {
    return "Indeed";
  }
  if (kind === "zr") {
    return "ZipRecruiter";
  }
  if (kind === "lf") {
    return "Levels.fyi";
  }
  if (kind === "yc") {
    return "YC Jobs";
  }
  if (kind === "ro") {
    return "RemoteOK";
  }
  return "Unknown";
}

export function onboardingReadinessState(source, checksBySourceId = {}) {
  if (!source || source.enabled !== true) {
    return {
      key: "disabled",
      label: "Disabled",
      tone: "muted",
    };
  }

  if (source.authRequired !== true) {
    return {
      key: "ready",
      label: "Ready",
      tone: "ok",
    };
  }

  const checkResult = checksBySourceId[source.id];
  const status = checkResult && checkResult.status ? String(checkResult.status).toLowerCase() : "";
  if (status === "pass") {
    return {
      key: "ready",
      label: "Ready",
      tone: "ok",
    };
  }

  return {
    key: "not_authorized",
    label: "Issue detected",
    tone: "warn",
  };
}

export function buildSearchRows(sources = [], checksBySourceId = {}) {
  return sources
    .filter(Boolean)
    .map((source) => {
      const kind = sourceKindFromType(source.type);
      const readiness = onboardingReadinessState(source, checksBySourceId);
      return {
        id: String(source.id || "").trim(),
        kind,
        label: source.name || sourceKindLabel(kind),
        searchUrl: source.searchUrl || "",
        enabled: source.enabled === true,
        authRequired: source.authRequired === true,
        readiness,
        capturedAt:
          typeof source.lastAttemptedAt === "string" && source.lastAttemptedAt.trim()
            ? source.lastAttemptedAt
            : source.capturedAt || null,
        foundCount: Number(
          Number.isFinite(Number(source.foundCount))
            ? source.foundCount
            : Number(source.droppedByHardFilterCount || 0) +
              Number(source.droppedByDedupeCount || 0) +
              Number(source.importedCount || 0)
        ),
        capturedCount: Number(source.captureJobCount || 0),
        filteredCount: Number(source.droppedByHardFilterCount || 0),
        dedupedCount: Number(source.droppedByDedupeCount || 0),
        importedCount: Number(source.importedCount || 0),
        hasUnknownExpectedCount: normalizeExpectedFoundCount(source.captureExpectedCount) === null,
        expectedFoundCount: normalizeExpectedFoundCount(source.captureExpectedCount),
        formatterUnsupported: Array.isArray(source?.formatterDiagnostics?.unsupported)
          ? source.formatterDiagnostics.unsupported
          : Array.isArray(source?.criteriaAccountability?.unsupported)
            ? source.criteriaAccountability.unsupported
            : [],
        formatterNotes: Array.isArray(source?.formatterDiagnostics?.notes)
          ? source.formatterDiagnostics.notes
          : [],
        captureStatus: source.captureStatus || "never_run",
        captureFunnelError: source.captureFunnelError || null,
        hasCacheState:
          source.servedFrom === "cache" ||
          source.statusReason === "cache_fresh" ||
          source.statusReason === "cooldown" ||
          source.statusReason === "min_interval" ||
          source.statusReason === "daily_cap" ||
          source.statusReason === "mock_profile",
        adapterHealthStatus:
          typeof source.adapterHealthStatus === "string" ? source.adapterHealthStatus : "unknown",
        adapterHealthScore:
          Number.isFinite(Number(source.adapterHealthScore))
            ? Number(source.adapterHealthScore)
            : null,
        adapterHealthReason:
          Array.isArray(source.adapterHealthReasons) && source.adapterHealthReasons.length > 0
            ? String(source.adapterHealthReasons[0] || "")
            : null,
        adapterHealthUpdatedAt:
          typeof source.adapterHealthUpdatedAt === "string" && source.adapterHealthUpdatedAt.trim()
            ? source.adapterHealthUpdatedAt
            : null,
        lastAttemptedAt:
          typeof source.lastAttemptedAt === "string" && source.lastAttemptedAt.trim()
            ? source.lastAttemptedAt
            : null,
        lastAttemptOutcome:
          typeof source.lastAttemptOutcome === "string" && source.lastAttemptOutcome.trim()
            ? source.lastAttemptOutcome
            : null,
        lastAttemptError:
          typeof source.lastAttemptError === "string" && source.lastAttemptError.trim()
            ? source.lastAttemptError
            : null,
        lastSuccessfulAt:
          typeof source.capturedAt === "string" && source.capturedAt.trim()
            ? source.capturedAt
            : null,
        refreshStatusReason:
          typeof source.statusReason === "string" && source.statusReason.trim()
            ? source.statusReason
            : null,
        refreshServedFrom:
          typeof source.servedFrom === "string" && source.servedFrom.trim()
            ? source.servedFrom
            : null,
        runNewCount: Number.isFinite(Number(source.runNewCount))
          ? Math.max(0, Math.round(Number(source.runNewCount)))
          : null,
        runUpdatedCount: Number.isFinite(Number(source.runUpdatedCount))
          ? Math.max(0, Math.round(Number(source.runUpdatedCount)))
          : null,
        runUnchangedCount: Number.isFinite(Number(source.runUnchangedCount))
          ? Math.max(0, Math.round(Number(source.runUnchangedCount)))
          : null,
        hasRunDelta:
          Number.isFinite(Number(source.runNewCount)) ||
          Number.isFinite(Number(source.runUpdatedCount)) ||
          Number.isFinite(Number(source.runUnchangedCount)),
        avgScore:
          source.avgScore === null || source.avgScore === undefined
            ? null
            : Number.isFinite(Number(source.avgScore))
              ? Math.round(Number(source.avgScore))
              : null,
        manualRefreshAllowed: source.manualRefreshAllowed === true,
        manualRefreshNextEligibleAt:
          typeof source.manualRefreshNextEligibleAt === "string"
            ? source.manualRefreshNextEligibleAt
            : null,
        manualRefreshRemaining: Number(source.manualRefreshRemaining || 0),
      };
    })
    .sort((left, right) => {
      const leftIndex = SOURCE_KIND_ORDER.indexOf(left.kind);
      const rightIndex = SOURCE_KIND_ORDER.indexOf(right.kind);
      const normalizedLeft = leftIndex >= 0 ? leftIndex : SOURCE_KIND_ORDER.length;
      const normalizedRight = rightIndex >= 0 ? rightIndex : SOURCE_KIND_ORDER.length;
      if (normalizedLeft !== normalizedRight) {
        return normalizedLeft - normalizedRight;
      }
      return left.label.localeCompare(right.label);
    });
}

export function splitSearchRows(searchRows = []) {
  const enabledRows = searchRows.filter((row) => row.enabled);
  const disabledRows = searchRows.filter((row) => !row.enabled);
  return { enabledRows, disabledRows };
}

export function computeSearchTotals(searchRows = [], searchState = "enabled") {
  const totals = searchRows.reduce(
    (accumulator, source) => {
      accumulator.captured += Number(source.capturedCount || 0);
      accumulator.filtered += Number(source.filteredCount || 0);
      accumulator.deduped += Number(source.dedupedCount || 0);
      accumulator.imported += Number(source.importedCount || 0);
      accumulator.found += Number.isFinite(Number(source.foundCount))
        ? Number(source.foundCount)
        : Number(source.filteredCount || 0) +
          Number(source.dedupedCount || 0) +
          Number(source.importedCount || 0);
      if (Number.isFinite(Number(source.avgScore)) && Number(source.importedCount || 0) > 0) {
        accumulator.avgScoreTotal += Number(source.avgScore) * Number(source.importedCount || 0);
        accumulator.avgScoreCount += Number(source.importedCount || 0);
      }
      return accumulator;
    },
    {
      captured: 0,
      filtered: 0,
      deduped: 0,
      imported: 0,
      found: 0,
      avgScoreTotal: 0,
      avgScoreCount: 0,
    },
  );

  return {
    stateLabel: normalizeSearchState(searchState) === "enabled" ? "Enabled Total" : "Disabled Total",
    foundLabel: String(Math.max(0, Math.round(totals.found))),
    filtered: totals.filtered,
    deduped: totals.deduped,
    imported: totals.imported,
    avgScore:
      totals.avgScoreCount > 0
        ? Math.round(totals.avgScoreTotal / totals.avgScoreCount)
        : "n/a",
  };
}

export function presentSearchStatus(row) {
  const isDisabled = row?.enabled !== true;
  const authActionRequired =
    row?.enabled === true &&
    row?.authRequired === true &&
    row?.readiness?.key === "not_authorized";
  const latestAttemptAt = row?.lastAttemptedAt || row?.capturedAt || null;
  const latestSuccessfulAt = row?.lastSuccessfulAt || null;
  const latestAttemptOutcome =
    typeof row?.lastAttemptOutcome === "string" && row.lastAttemptOutcome.trim()
      ? row.lastAttemptOutcome.trim().toLowerCase()
      : "";
  const latestAttemptMs = Date.parse(String(latestAttemptAt || ""));
  const latestSuccessfulMs = Date.parse(String(latestSuccessfulAt || ""));
  const latestAttemptFailed =
    latestAttemptOutcome &&
    latestAttemptOutcome !== "success" &&
    Number.isFinite(latestAttemptMs) &&
    (!Number.isFinite(latestSuccessfulMs) || latestAttemptMs >= latestSuccessfulMs);

  const tone = isDisabled
    ? "muted"
    : authActionRequired
      ? "warn"
      : latestAttemptFailed
        ? latestAttemptOutcome === "challenge"
          ? "warn"
          : "error"
        : row?.captureStatus === "capture_error"
          ? "error"
          : "ok";

  const statusLabelRaw =
    row?.captureStatus === "ready"
      ? "ready"
      : row?.captureStatus === "capture_error"
        ? "capture error"
        : row?.captureStatus === "live_source"
          ? "ready"
        : "never run";

  const label = isDisabled
    ? "disabled"
    : authActionRequired
      ? "not authorized"
      : latestAttemptFailed
        ? latestAttemptOutcome === "challenge"
          ? "challenge"
          : "attempt failed"
        : tone === "error"
          ? "error"
          : statusLabelRaw;

  const statusDetail = authActionRequired
    ? "Sign in to this source to continue."
    : latestAttemptFailed
      ? [
          latestAttemptOutcome === "challenge"
            ? "Additional verification needed"
            : "Last attempt failed",
          row?.lastAttemptError ? String(row.lastAttemptError) : null,
          Number.isFinite(latestAttemptMs) ? formatRelativeTimestamp(latestAttemptAt) : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : null;

  return {
    tone,
    label,
    statusDetail,
    formatterDetail: "",
    foundLabel: String(Math.max(0, Math.round(Number(row?.foundCount || 0)))),
  };
}

export function presentSearchPrimaryAction(row, options = {}) {
  const controlsDisabled = options?.controlsDisabled === true;

  if (row?.enabled !== true) {
    return {
      kind: "enable",
      label: "Enable",
      disabled: controlsDisabled,
    };
  }

  if (row?.authRequired === true && row?.readiness?.key === "not_authorized") {
    return {
      kind: "sign_in",
      label: "Sign in",
      disabled: controlsDisabled,
    };
  }

  const runNowDisabled = controlsDisabled || row?.manualRefreshAllowed !== true;
  return {
    kind: "run_now",
    label:
      runNowDisabled && row?.manualRefreshNextEligibleAt
        ? `Available in ${formatDurationFromNow(row.manualRefreshNextEligibleAt)}`
        : "Run now",
    disabled: runNowDisabled,
  };
}

export function buildSearchOverflowActions(row) {
  if (row?.enabled !== true) {
    return [];
  }

  return [
    {
      kind: "disable",
      label: "Disable",
    },
  ];
}

export function shouldShowSearchesWelcomeToast({
  mainTab,
  searchState,
  hasSeenToast,
}) {
  return (
    String(mainTab || "").toLowerCase() === "searches" &&
    normalizeSearchState(searchState) === "enabled" &&
    hasSeenToast !== true
  );
}

export function resolveSearchesWelcomeToastScope(dashboard) {
  const sourcesConfiguredAt =
    typeof dashboard?.onboarding?.sourcesConfiguredAt === "string"
      ? dashboard.onboarding.sourcesConfiguredAt.trim()
      : "";
  const startedAt =
    typeof dashboard?.onboarding?.startedAt === "string"
      ? dashboard.onboarding.startedAt.trim()
      : "";
  return sourcesConfiguredAt || startedAt || "global";
}

export function hasSeenSearchesWelcomeToast(storage, scope = "global") {
  try {
    return storage?.getItem(SEARCHES_WELCOME_TOAST_SEEN_KEY) === String(scope);
  } catch {
    return false;
  }
}

export function markSearchesWelcomeToastSeen(storage, scope = "global") {
  try {
    storage?.setItem(SEARCHES_WELCOME_TOAST_SEEN_KEY, String(scope));
  } catch {
    // no-op
  }
}

export function readSearchRunCadence(storage) {
  try {
    return normalizeRunCadence(storage?.getItem(SEARCH_RUN_CADENCE_KEY));
  } catch {
    return "12h";
  }
}

export function persistSearchRunCadence(storage, cadence) {
  const normalized = normalizeRunCadence(cadence);
  try {
    storage?.setItem(SEARCH_RUN_CADENCE_KEY, normalized);
  } catch {
    // no-op
  }
  return normalized;
}

export function formatDurationFromNow(nextEligibleAt, nowMs = Date.now()) {
  const nextMs = Date.parse(nextEligibleAt);
  if (!Number.isFinite(nextMs)) {
    return "soon";
  }

  const remainingMs = Math.max(0, nextMs - nowMs);
  const totalMinutes = Math.round(remainingMs / 60_000);
  if (totalMinutes <= 0) {
    return "now";
  }

  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${minutes}m`;
}

export function formatRelativeTimestamp(isoText, nowMs = Date.now()) {
  if (typeof isoText !== "string" || !isoText.trim()) {
    return "never";
  }

  const timestampMs = Date.parse(isoText);
  if (!Number.isFinite(timestampMs)) {
    return "never";
  }

  const elapsedMs = Math.max(0, nowMs - timestampMs);
  const elapsedMinutes = Math.floor(elapsedMs / 60_000);
  if (elapsedMinutes < 1) {
    return "just now";
  }
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m ago`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `${elapsedHours}h ago`;
  }

  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays}d ago`;
}
