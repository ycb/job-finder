import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  buildSearchRows,
  computeSearchTotals,
  formatDurationFromNow,
  formatRelativeTimestamp,
  hasSeenSearchesWelcomeToast,
  markSearchesWelcomeToastSeen,
  normalizeSearchState,
  persistSearchRunCadence,
  readSearchRunCadence,
  shouldShowSearchesWelcomeToast,
  splitSearchRows,
} from "@/features/searches/logic";

const MAIN_TABS = [
  { value: "jobs", label: "Jobs" },
  { value: "searches", label: "Searches" },
  { value: "profile", label: "Profile" },
];

function statusPresentationForRow(row) {
  const healthStatus = row.adapterHealthStatus || "unknown";
  const healthTone =
    healthStatus === "failing"
      ? "error"
      : healthStatus === "degraded"
        ? "warn"
        : null;

  const tone = healthTone || (
    row.captureStatus === "capture_error"
      ? "error"
      : row.hasCacheState
        ? "warn"
        : "ok"
  );

  const statusLabelRaw =
    row.captureStatus === "ready"
      ? "ready"
      : row.captureStatus === "capture_error"
        ? "capture error"
        : row.captureStatus === "live_source"
          ? "live source"
          : "never run";

  const label =
    healthStatus === "failing" || healthStatus === "degraded"
      ? "needs attention"
      : tone === "warn"
        ? "cache"
        : tone === "error"
          ? "error"
          : statusLabelRaw;

  const healthScore =
    Number.isFinite(Number(row.adapterHealthScore))
      ? Math.round(Number(row.adapterHealthScore) * 100)
      : null;

  const healthUpdatedAtText =
    typeof row.adapterHealthUpdatedAt === "string" && row.adapterHealthUpdatedAt.trim()
      ? formatRelativeTimestamp(row.adapterHealthUpdatedAt)
      : null;

  const statusDetail =
    healthStatus === "failing" || healthStatus === "degraded"
      ? `${row.adapterHealthReason || "adapter needs attention"}${
          healthUpdatedAtText ? ` · last signal ${healthUpdatedAtText}` : ""
        }`
      : row.captureFunnelError ||
        (healthStatus === "ok" && healthScore !== null
          ? `health score ${healthScore}%`
          : null);

  const refreshStatusReason =
    typeof row.refreshStatusReason === "string" && row.refreshStatusReason.trim()
      ? row.refreshStatusReason.replaceAll("_", " ")
      : "unknown";

  const refreshServedFrom =
    typeof row.refreshServedFrom === "string" && row.refreshServedFrom.trim()
      ? row.refreshServedFrom
      : "unknown";

  const refreshContextDetail = `refresh: ${refreshStatusReason} (${refreshServedFrom})`;
  const runDeltaDetail = row.hasRunDelta
    ? `run delta: new ${row.runNewCount} · updated ${row.runUpdatedCount} · unchanged ${row.runUnchangedCount}`
    : "run delta: unavailable";

  const formatterDetailParts = [];
  if (Array.isArray(row.formatterUnsupported) && row.formatterUnsupported.length > 0) {
    formatterDetailParts.push(`unsupported ${row.formatterUnsupported.join(", ")}`);
  }
  if (Array.isArray(row.formatterNotes) && row.formatterNotes.length > 0) {
    formatterDetailParts.push(...row.formatterNotes);
  }

  return {
    tone,
    label,
    statusDetail,
    refreshContextDetail,
    runDeltaDetail,
    formatterDetail: formatterDetailParts.join(" · "),
    foundLabel:
      row.hasUnknownExpectedCount || !Number.isFinite(Number(row.expectedFoundCount))
        ? `${row.importedCount}/?`
        : `${row.importedCount}/${Math.max(0, Math.round(row.expectedFoundCount))}`,
  };
}

function toneClassName(tone) {
  if (tone === "error") {
    return "bg-destructive";
  }
  if (tone === "warn") {
    return "bg-amber-600";
  }
  if (tone === "muted") {
    return "bg-muted-foreground";
  }
  return "bg-emerald-600";
}

async function requestJson(pathname, options = {}) {
  const response = await fetch(pathname, options);
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const isJson = contentType.includes("application/json");

  let payload = null;
  if (isJson) {
    payload = await response.json();
  } else {
    const text = await response.text();
    payload = text ? { error: text } : null;
  }

  if (!response.ok) {
    const error = new Error(
      payload && typeof payload.error === "string"
        ? payload.error
        : `Request failed (${response.status})`,
    );
    error.payload = payload;
    throw error;
  }

  return payload;
}

export default function App() {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState("");
  const [mainTab, setMainTab] = useState("searches");
  const [searchState, setSearchState] = useState("enabled");
  const [searchRunCadence, setSearchRunCadence] = useState(() => {
    if (typeof window === "undefined") {
      return "12h";
    }
    return readSearchRunCadence(window.localStorage);
  });
  const [welcomeToastVisible, setWelcomeToastVisible] = useState(false);
  const [feedback, setFeedback] = useState({ message: "", error: false });

  const loadDashboard = useCallback(async (options = {}) => {
    const quiet = options.quiet === true;
    if (!quiet) {
      setLoading(true);
    }

    try {
      const payload = await requestJson("/api/dashboard");
      setDashboard(payload);
      if (!quiet) {
        setFeedback({ message: "", error: false });
      }
    } catch (error) {
      setFeedback({
        message: typeof error?.message === "string" ? error.message : "Unable to load dashboard.",
        error: true,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const hasSeenToast = hasSeenSearchesWelcomeToast(window.localStorage);
    const shouldShow = shouldShowSearchesWelcomeToast({
      mainTab,
      searchState,
      hasSeenToast,
    });

    if (shouldShow) {
      markSearchesWelcomeToastSeen(window.localStorage);
      setWelcomeToastVisible(true);
    }
  }, [mainTab, searchState]);

  useEffect(() => {
    if (mainTab !== "searches" || normalizeSearchState(searchState) !== "enabled") {
      setWelcomeToastVisible(false);
    }
  }, [mainTab, searchState]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    persistSearchRunCadence(window.localStorage, searchRunCadence);
  }, [searchRunCadence]);

  const onboardingChecksBySourceId =
    dashboard?.onboarding?.checks && typeof dashboard.onboarding.checks === "object"
      ? dashboard.onboarding.checks.sources || {}
      : {};

  const searchRows = useMemo(
    () => buildSearchRows(Array.isArray(dashboard?.sources) ? dashboard.sources : [], onboardingChecksBySourceId),
    [dashboard?.sources, onboardingChecksBySourceId],
  );

  const { enabledRows, disabledRows } = useMemo(
    () => splitSearchRows(searchRows),
    [searchRows],
  );

  const selectedSearchState = normalizeSearchState(searchState);
  const filteredRows = selectedSearchState === "enabled" ? enabledRows : disabledRows;
  const totals = useMemo(
    () => computeSearchTotals(filteredRows, selectedSearchState),
    [filteredRows, selectedSearchState],
  );

  const controlsDisabled = busyAction.length > 0;

  const persistEnabledSources = useCallback(
    async (enabledSourceIds) => {
      const deduped = [...new Set(enabledSourceIds.map((value) => String(value || "").trim()).filter(Boolean))];
      await requestJson("/api/onboarding/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceIds: deduped,
          enabledSourceIds: deduped,
        }),
      });
      await loadDashboard({ quiet: true });
    },
    [loadDashboard],
  );

  const handleEnableSource = useCallback(
    async (sourceId, sourceName) => {
      setBusyAction(`enable:${sourceId}`);
      setFeedback({ message: `Enabling ${sourceName}...`, error: false });
      try {
        const nextEnabledIds = [...enabledRows.map((row) => row.id), sourceId];
        await persistEnabledSources(nextEnabledIds);
        setFeedback({ message: `${sourceName} enabled.`, error: false });
      } catch (error) {
        setFeedback({
          message: typeof error?.message === "string" ? error.message : "Unable to enable source.",
          error: true,
        });
      } finally {
        setBusyAction("");
      }
    },
    [enabledRows, persistEnabledSources],
  );

  const handleDisableSource = useCallback(
    async (sourceId, sourceName) => {
      setBusyAction(`disable:${sourceId}`);
      setFeedback({ message: `Disabling ${sourceName}...`, error: false });
      try {
        const nextEnabledIds = enabledRows.map((row) => row.id).filter((id) => id !== sourceId);
        await persistEnabledSources(nextEnabledIds);
        setFeedback({ message: `${sourceName} disabled.`, error: false });
      } catch (error) {
        setFeedback({
          message: typeof error?.message === "string" ? error.message : "Unable to disable source.",
          error: true,
        });
      } finally {
        setBusyAction("");
      }
    },
    [enabledRows, persistEnabledSources],
  );

  const handleRunSourceNow = useCallback(
    async (sourceId) => {
      setBusyAction(`run:${sourceId}`);
      setFeedback({ message: "Running source now...", error: false });
      try {
        const payload = await requestJson(`/api/sources/${encodeURIComponent(sourceId)}/manual-refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        await loadDashboard({ quiet: true });
        const captureMessage =
          payload?.capture && typeof payload.capture.message === "string"
            ? payload.capture.message
            : "Manual refresh completed.";
        setFeedback({ message: captureMessage, error: false });
      } catch (error) {
        const nextEligibleAt =
          typeof error?.payload?.nextEligibleAt === "string"
            ? error.payload.nextEligibleAt
            : "";
        if (nextEligibleAt) {
          setFeedback(
            {
              message: `Manual refresh unavailable. Available in ${formatDurationFromNow(nextEligibleAt)}.`,
              error: true,
            },
          );
        } else {
          setFeedback({
            message: typeof error?.message === "string" ? error.message : "Unable to run source now.",
            error: true,
          });
        }
      } finally {
        setBusyAction("");
      }
    },
    [loadDashboard],
  );

  const handleCheckAccess = useCallback(
    async (sourceId, sourceName) => {
      setBusyAction(`check:${sourceId}`);
      setFeedback({ message: `Checking access for ${sourceName}...`, error: false });
      try {
        const payload = await requestJson("/api/onboarding/check-source", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceId,
            probeLive: false,
            authProbe: true,
            closeWindowAfterProbe: true,
          }),
        });
        await loadDashboard({ quiet: true });
        const status =
          payload?.result && typeof payload.result.status === "string"
            ? payload.result.status.toLowerCase()
            : "";
        if (status === "pass") {
          setFeedback({ message: `${sourceName} is ready.`, error: false });
        } else {
          setFeedback({ message: `${sourceName} is not authorized. Sign in and retry.`, error: true });
        }
      } catch (error) {
        setFeedback({
          message: typeof error?.message === "string" ? error.message : "Unable to check source access.",
          error: true,
        });
      } finally {
        setBusyAction("");
      }
    },
    [loadDashboard],
  );

  const dismissWelcomeToast = useCallback(() => {
    if (typeof window !== "undefined") {
      markSearchesWelcomeToastSeen(window.localStorage);
    }
    setWelcomeToastVisible(false);
  }, []);

  const goToDisabledFromToast = useCallback(() => {
    if (typeof window !== "undefined") {
      markSearchesWelcomeToastSeen(window.localStorage);
    }
    setWelcomeToastVisible(false);
    setSearchState("disabled");
  }, []);

  if (loading && !dashboard) {
    return (
      <main className="container px-4 py-8 md:py-10">
        <Card>
          <CardContent className="py-10 text-sm text-muted-foreground">Loading dashboard…</CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="container px-4 py-8 md:py-10">
      <Card className="animate-fade-in">
        <CardHeader className="space-y-4">
          <CardTitle>Job Finder</CardTitle>
          <CardDescription>
            Manage saved searches, run intake, and review ranked jobs in one place.
          </CardDescription>

          <Tabs value={mainTab} onValueChange={setMainTab} className="w-full">
            <TabsList className="w-full justify-start">
              {MAIN_TABS.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="searches">
              <div className="space-y-4">
                <div className="searches-tabs-row">
                  <Tabs value={selectedSearchState} onValueChange={setSearchState}>
                    <TabsList>
                      <TabsTrigger value="enabled">Enabled ({enabledRows.length})</TabsTrigger>
                      <TabsTrigger value="disabled">Disabled ({disabledRows.length})</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>

                <Card className="searches-card">
                  <CardHeader className="pb-4">
                    <CardTitle className="text-base">My Job Searches</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {selectedSearchState === "enabled" ? (
                      <div className="search-controls-row">
                        <label className="text-sm font-medium text-foreground">
                          Search frequency
                          <Select value={searchRunCadence} onValueChange={setSearchRunCadence}>
                            <SelectTrigger id="search-run-cadence" className="mt-2 w-full sm:w-64">
                              <SelectValue placeholder="Select search frequency" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                <SelectLabel>Run cadence</SelectLabel>
                                <SelectItem value="12h">12h (recommended)</SelectItem>
                                <SelectItem value="daily">Daily</SelectItem>
                                <SelectItem value="weekly">Weekly</SelectItem>
                                <SelectItem value="cached">Use cached results (dev)</SelectItem>
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </label>
                      </div>
                    ) : null}

                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Source</TableHead>
                          <TableHead>Last Run</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Found</TableHead>
                          <TableHead>Filtered</TableHead>
                          <TableHead>Dupes</TableHead>
                          <TableHead>Imported</TableHead>
                          <TableHead>Avg Score</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredRows.map((row) => {
                          const statusPresentation = statusPresentationForRow(row);
                          const runNowDisabled = controlsDisabled || !row.manualRefreshAllowed;
                          const runNowLabel = runNowDisabled
                            ? row.manualRefreshNextEligibleAt
                              ? `Available in ${formatDurationFromNow(row.manualRefreshNextEligibleAt)}`
                              : "Run now"
                            : "Run now";

                          return (
                            <TableRow key={row.id} className={cn(!row.enabled && "bg-secondary/20") }>
                              <TableCell>
                                {row.searchUrl ? (
                                  <a
                                    href={row.searchUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-medium text-primary hover:underline"
                                  >
                                    {row.label} <span aria-hidden="true">↗</span>
                                  </a>
                                ) : (
                                  <span className="font-medium">{row.label}</span>
                                )}
                              </TableCell>
                              <TableCell>{formatRelativeTimestamp(row.capturedAt)}</TableCell>
                              <TableCell className="max-w-[260px]">
                                <div className="inline-flex items-center gap-2 rounded-full bg-secondary/60 px-2 py-1 text-xs font-semibold">
                                  <span
                                    aria-hidden="true"
                                    className={cn("h-2 w-2 rounded-full", toneClassName(statusPresentation.tone))}
                                  />
                                  <span>{statusPresentation.label}</span>
                                </div>
                                <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                                  <p>{statusPresentation.refreshContextDetail}</p>
                                  <p>{statusPresentation.runDeltaDetail}</p>
                                  {statusPresentation.statusDetail ? <p>{statusPresentation.statusDetail}</p> : null}
                                  {statusPresentation.formatterDetail ? (
                                    <p>formatter: {statusPresentation.formatterDetail}</p>
                                  ) : null}
                                </div>
                              </TableCell>
                              <TableCell>{statusPresentation.foundLabel}</TableCell>
                              <TableCell>{row.filteredCount}</TableCell>
                              <TableCell>{row.dedupedCount}</TableCell>
                              <TableCell>{row.importedCount}</TableCell>
                              <TableCell>{row.avgScore === null ? "n/a" : row.avgScore}</TableCell>
                              <TableCell>
                                <div className="flex flex-wrap items-center gap-2">
                                  {!row.enabled ? (
                                    <Button
                                      size="sm"
                                      disabled={controlsDisabled}
                                      onClick={() => {
                                        void handleEnableSource(row.id, row.label);
                                      }}
                                    >
                                      Enable
                                    </Button>
                                  ) : (
                                    <>
                                      <Button
                                        size="sm"
                                        variant="secondary"
                                        disabled={runNowDisabled}
                                        title={`Manual refreshes remaining today: ${row.manualRefreshRemaining}`}
                                        onClick={() => {
                                          void handleRunSourceNow(row.id);
                                        }}
                                      >
                                        {runNowLabel}
                                      </Button>
                                      {row.authRequired && row.readiness.tone === "warn" ? (
                                        <Button
                                          size="sm"
                                          variant="secondary"
                                          disabled={controlsDisabled}
                                          onClick={() => {
                                            void handleCheckAccess(row.id, row.label);
                                          }}
                                        >
                                          Check access
                                        </Button>
                                      ) : null}
                                      <details className="relative">
                                        <summary
                                          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-border text-sm"
                                          aria-label="Source actions"
                                          title="Source actions"
                                        >
                                          ⋯
                                        </summary>
                                        <div className="absolute right-0 z-20 mt-1 min-w-[130px] rounded-md border border-border bg-card p-1 shadow-panel">
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            className="w-full justify-start"
                                            disabled={controlsDisabled}
                                            onClick={() => {
                                              void handleDisableSource(row.id, row.label);
                                            }}
                                          >
                                            Disable
                                          </Button>
                                        </div>
                                      </details>
                                    </>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}

                        {filteredRows.length > 0 ? (
                          <TableRow className="search-totals-row bg-secondary/50 font-semibold">
                            <TableCell>{totals.stateLabel}</TableCell>
                            <TableCell>—</TableCell>
                            <TableCell>—</TableCell>
                            <TableCell>{totals.foundLabel}</TableCell>
                            <TableCell>{totals.filtered}</TableCell>
                            <TableCell>{totals.deduped}</TableCell>
                            <TableCell>{totals.imported}</TableCell>
                            <TableCell>{totals.avgScore}</TableCell>
                            <TableCell>—</TableCell>
                          </TableRow>
                        ) : null}
                      </TableBody>
                    </Table>

                    {filteredRows.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No sources in this tab.</p>
                    ) : null}

                    {feedback.message ? (
                      <p
                        className={cn(
                          "text-sm",
                          feedback.error ? "text-destructive" : "text-muted-foreground",
                        )}
                      >
                        {feedback.message}
                      </p>
                    ) : null}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="jobs">
              <Card>
                <CardContent className="pt-6 text-sm text-muted-foreground">
                  Jobs React slice is pending lane completion. Use Searches actions from this view for now.
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="profile">
              <Card>
                <CardContent className="pt-6 text-sm text-muted-foreground">
                  Profile React slice is pending lane completion.
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </CardHeader>
      </Card>

      {welcomeToastVisible && mainTab === "searches" && selectedSearchState === "enabled" ? (
        <aside className="fixed right-4 top-4 z-50 w-[min(420px,calc(100vw-2rem))] rounded-lg border border-border bg-card p-4 shadow-panel animate-fade-in">
          <button
            type="button"
            aria-label="Close welcome message"
            className="absolute right-2 top-2 rounded-md p-1 text-sm text-muted-foreground hover:text-foreground"
            onClick={dismissWelcomeToast}
          >
            ×
          </button>
          <p className="pr-6 text-sm text-foreground">
            Welcome to Job Finder! The Enabled tab shows websites with public job postings. To
            enable sources like LinkedIn (where login is required) visit the Disabled tab.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={goToDisabledFromToast}>
              Go to Disabled
            </Button>
          </div>
        </aside>
      ) : null}
    </main>
  );
}
