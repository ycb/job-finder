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
import { ToastAction } from "@/components/ui/toast";
import { Toaster } from "@/components/ui/toaster";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { buildConsentPayload } from "@/lib/onboarding";
import {
  buildSearchRows,
  computeSearchTotals,
  formatDurationFromNow,
  formatRelativeTimestamp,
  hasSeenSearchesWelcomeToast,
  markSearchesWelcomeToastSeen,
  normalizeSearchState,
  presentSearchStatus,
  persistSearchRunCadence,
  readSearchRunCadence,
  resolveSearchesWelcomeToastScope,
  shouldShowSearchesWelcomeToast,
  splitSearchRows,
} from "@/features/searches/logic";

const MAIN_TABS = [
  { value: "jobs", label: "Jobs" },
  { value: "searches", label: "Searches" },
  { value: "profile", label: "Profile" },
];

const AUTH_FLOW_HELP_TEXT = "Step 1: Open source. Step 2: Sign in. Step 3: Click I'm logged in.";
const CONSENT_REQUIRED_MESSAGE =
  "Before continuing, review Terms + Privacy and accept the consent checkboxes in Step 1.";

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
  const [consentDraft, setConsentDraft] = useState({
    legalAccepted: false,
    tosRiskAccepted: false,
  });
  const [authFlow, setAuthFlow] = useState({
    sourceId: null,
    message: "",
    error: false,
    busy: false,
  });
  const { toast } = useToast();

  const loadDashboard = useCallback(async (options = {}) => {
    const quiet = options.quiet === true;
    if (!quiet) {
      setLoading(true);
    }

    try {
      const payload = await requestJson("/api/dashboard");
      setDashboard(payload);
    } catch (error) {
      toast({
        title: "Dashboard unavailable",
        description: typeof error?.message === "string" ? error.message : "Unable to load dashboard.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

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
  const rawSources = Array.isArray(dashboard?.sources) ? dashboard.sources : [];
  const sourceById = useMemo(() => {
    const lookup = Object.create(null);
    for (const source of rawSources) {
      if (source && source.id) {
        lookup[source.id] = source;
      }
    }
    return lookup;
  }, [rawSources]);
  const consentGateRequired =
    dashboard?.onboarding?.enabled === true &&
    dashboard?.onboarding?.consentComplete !== true;
  const welcomeToastScope = useMemo(
    () => resolveSearchesWelcomeToastScope(dashboard),
    [dashboard],
  );

  useEffect(() => {
    if (typeof window === "undefined" || !dashboard || consentGateRequired) {
      return;
    }

    const hasSeenToast = hasSeenSearchesWelcomeToast(window.localStorage, welcomeToastScope);
    const shouldShow = shouldShowSearchesWelcomeToast({
      mainTab,
      searchState,
      hasSeenToast,
    });

    if (shouldShow) {
      markSearchesWelcomeToastSeen(window.localStorage, welcomeToastScope);
      toast({
        title: "Welcome to Job Finder",
        duration: 2147483647,
        description: (
          <div className="space-y-3">
            <p>
              The Enabled tab shows websites with public job postings. To enable sources like
              LinkedIn (where login is required), visit Disabled.
            </p>
            <ToastAction
              altText="Switch to disabled sources"
              className="w-fit"
              onClick={() => setSearchState("disabled")}
            >
              Go to Disabled
            </ToastAction>
          </div>
        ),
      });
    }
  }, [consentGateRequired, dashboard, mainTab, searchState, toast, welcomeToastScope]);

  const searchRows = useMemo(
    () => buildSearchRows(rawSources, onboardingChecksBySourceId),
    [rawSources, onboardingChecksBySourceId],
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

  const controlsDisabled = busyAction.length > 0 || authFlow.busy;

  const currentEnabledSourceIds = useCallback(
    () =>
      rawSources
        .filter((source) => source && source.enabled === true && source.id)
        .map((source) => source.id),
    [rawSources],
  );

  const ensureConsentAccepted = useCallback(() => {
    if (consentGateRequired) {
      toast({
        title: "Consent required",
        description: CONSENT_REQUIRED_MESSAGE,
        variant: "destructive",
      });
      return false;
    }
    return true;
  }, [consentGateRequired, toast]);

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
      if (!ensureConsentAccepted()) {
        return;
      }
      setBusyAction(`enable:${sourceId}`);
      try {
        const nextEnabledIds = [...currentEnabledSourceIds(), sourceId];
        await persistEnabledSources(nextEnabledIds);
        toast({ title: "Source enabled", description: `${sourceName} is now enabled.` });
        const source = sourceById[sourceId];
        if (source?.authRequired === true) {
          setAuthFlow({
            sourceId,
            message: AUTH_FLOW_HELP_TEXT,
            error: false,
            busy: false,
          });
        }
      } catch (error) {
        toast({
          title: "Enable failed",
          description: typeof error?.message === "string" ? error.message : "Unable to enable source.",
          variant: "destructive",
        });
      } finally {
        setBusyAction("");
      }
    },
    [currentEnabledSourceIds, ensureConsentAccepted, persistEnabledSources, sourceById, toast],
  );

  const handleDisableSource = useCallback(
    async (sourceId, sourceName) => {
      if (!ensureConsentAccepted()) {
        return;
      }
      setBusyAction(`disable:${sourceId}`);
      try {
        const nextEnabledIds = currentEnabledSourceIds().filter((id) => id !== sourceId);
        await persistEnabledSources(nextEnabledIds);
        toast({ title: "Source disabled", description: `${sourceName} is now disabled.` });
        setAuthFlow((current) =>
          current.sourceId === sourceId
            ? { sourceId: null, message: "", error: false, busy: false }
            : current,
        );
      } catch (error) {
        toast({
          title: "Disable failed",
          description: typeof error?.message === "string" ? error.message : "Unable to disable source.",
          variant: "destructive",
        });
      } finally {
        setBusyAction("");
      }
    },
    [currentEnabledSourceIds, ensureConsentAccepted, persistEnabledSources, toast],
  );

  const handleRunSourceNow = useCallback(
    async (sourceId) => {
      if (!ensureConsentAccepted()) {
        return;
      }
      setBusyAction(`run:${sourceId}`);
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
        toast({ title: "Run complete", description: captureMessage });
      } catch (error) {
        const nextEligibleAt =
          typeof error?.payload?.nextEligibleAt === "string"
            ? error.payload.nextEligibleAt
            : "";
        if (nextEligibleAt) {
          toast({
            title: "Run unavailable",
            description: `Available in ${formatDurationFromNow(nextEligibleAt)}.`,
            variant: "destructive",
          });
        } else {
          toast({
            title: "Run failed",
            description: typeof error?.message === "string" ? error.message : "Unable to run source now.",
            variant: "destructive",
          });
        }
      } finally {
        setBusyAction("");
      }
    },
    [ensureConsentAccepted, loadDashboard, toast],
  );

  const handleCheckAccess = useCallback(
    async (sourceId, sourceName, options = {}) => {
      if (!ensureConsentAccepted()) {
        return false;
      }
      setBusyAction(`check:${sourceId}`);
      try {
        const source = sourceById[sourceId];
        const authRequired = source?.authRequired === true;
        const payload = await requestJson("/api/onboarding/check-source", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceId,
            probeLive: !authRequired,
            authProbe: authRequired,
            closeWindowAfterProbe: authRequired,
          }),
        });
        await loadDashboard({ quiet: true });
        const status =
          payload?.result && typeof payload.result.status === "string"
            ? payload.result.status.toLowerCase()
            : "";
        if (status === "pass") {
          toast({ title: "Access check passed", description: `${sourceName} is ready.` });
          return true;
        } else {
          toast({
            title: "Access check failed",
            description: `${sourceName} is not authorized. Sign in and retry.`,
            variant: "destructive",
          });
          if (options.openSourceOnFail !== false && source?.searchUrl && authRequired) {
            window.open(source.searchUrl, "_blank", "noopener,noreferrer");
          }
          return false;
        }
      } catch (error) {
        toast({
          title: "Access check failed",
          description: typeof error?.message === "string" ? error.message : "Unable to check source access.",
          variant: "destructive",
        });
        return false;
      } finally {
        setBusyAction("");
      }
    },
    [ensureConsentAccepted, loadDashboard, sourceById, toast],
  );

  const handleSaveConsent = useCallback(async () => {
    const payload = buildConsentPayload(consentDraft);
    if (
      !payload.termsAccepted ||
      !payload.privacyAccepted ||
      !payload.rateLimitPolicyAccepted ||
      !payload.tosRiskAccepted
    ) {
      toast({
        title: "Consent required",
        description: "Accept all required acknowledgements before continuing.",
        variant: "destructive",
      });
      return;
    }

    setBusyAction("consent:save");
    try {
      await requestJson("/api/onboarding/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await loadDashboard({ quiet: true });
    } catch (error) {
      toast({
        title: "Consent save failed",
        description: typeof error?.message === "string" ? error.message : "Failed to save legal consent.",
        variant: "destructive",
      });
    } finally {
      setBusyAction("");
    }
  }, [consentDraft, loadDashboard, toast]);

  const authFlowSource =
    authFlow.sourceId && sourceById[authFlow.sourceId] ? sourceById[authFlow.sourceId] : null;

  const handleOpenSourceFromAuthFlow = useCallback(() => {
    if (!authFlowSource?.searchUrl) {
      return;
    }
    window.open(authFlowSource.searchUrl, "_blank", "noopener,noreferrer");
    setAuthFlow((current) => ({
      ...current,
      error: false,
      message: "Source opened in a new tab. Sign in, then click I'm logged in.",
    }));
  }, [authFlowSource]);

  const handleAuthFlowCheck = useCallback(async () => {
    if (!authFlowSource || authFlow.busy) {
      return;
    }

    setAuthFlow((current) => ({
      ...current,
      busy: true,
      error: false,
      message: `Checking access for ${authFlowSource.name}...`,
    }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    const passed = await handleCheckAccess(authFlowSource.id, authFlowSource.name, {
      openSourceOnFail: false,
    });

    setAuthFlow((current) => ({
      ...current,
      busy: false,
      error: !passed,
      message: passed
        ? `Success! ${authFlowSource.name} is now enabled.`
        : `${authFlowSource.name} is not authorized. Sign in and retry.`,
    }));
  }, [authFlow.busy, authFlowSource, handleCheckAccess]);

  if (loading && !dashboard) {
    return (
      <main className="container px-4 py-8 md:py-10">
        <Card>
          <CardContent className="py-10 text-sm text-muted-foreground">Loading dashboard…</CardContent>
        </Card>
      </main>
    );
  }

  if (consentGateRequired) {
    return (
      <main className="container px-4 py-8 md:py-10">
        <Card className="mx-auto w-full max-w-5xl">
          <CardHeader>
            <CardTitle>Job Finder</CardTitle>
            <CardDescription>
              To access JobFinder, review and accept the following:
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-start gap-3 text-sm text-foreground">
              <input
                id="onboarding-consent-legal"
                type="checkbox"
                className="mt-0.5 h-4 w-4"
                checked={consentDraft.legalAccepted}
                onChange={(event) => {
                  setConsentDraft((current) => ({
                    ...current,
                    legalAccepted: event.target.checked,
                  }));
                }}
              />
              <span>
                I have read and accept the{" "}
                <a
                  className="underline"
                  href={dashboard?.onboarding?.legalDocs?.termsUrl || "/policy/terms"}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Terms of Service
                </a>{" "}
                and{" "}
                <a
                  className="underline"
                  href={dashboard?.onboarding?.legalDocs?.privacyUrl || "/policy/privacy"}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Privacy Policy
                </a>.
              </span>
            </label>

            <label className="flex items-start gap-3 text-sm text-foreground">
              <input
                id="onboarding-consent-tos-risk"
                type="checkbox"
                className="mt-0.5 h-4 w-4"
                checked={consentDraft.tosRiskAccepted}
                onChange={(event) => {
                  setConsentDraft((current) => ({
                    ...current,
                    tosRiskAccepted: event.target.checked,
                  }));
                }}
              />
              <span>
                I understand some platforms restrict automated access from logged-in users and accept
                responsibility for my accounts.
              </span>
            </label>

            <div>
              <Button
                id="onboarding-save-consent"
                disabled={controlsDisabled}
                onClick={() => {
                  void handleSaveConsent();
                }}
              >
                Agree and Continue
              </Button>
            </div>
          </CardContent>
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
              <div className="space-y-0">
                <div className="mb-0 flex justify-end">
                  <Tabs
                    value={selectedSearchState}
                    onValueChange={setSearchState}
                    className="-mb-px"
                  >
                    <TabsList className="h-auto gap-0 rounded-t-xl rounded-b-none border border-border/80 border-b-0 bg-transparent p-0">
                      <TabsTrigger
                        value="enabled"
                        className="rounded-none rounded-tl-xl border-r border-border/80 px-6 py-3 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=inactive]:bg-secondary/20"
                      >
                        Enabled ({enabledRows.length})
                      </TabsTrigger>
                      <TabsTrigger
                        value="disabled"
                        className="rounded-none rounded-tr-xl px-6 py-3 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=inactive]:bg-secondary/20"
                      >
                        Disabled ({disabledRows.length})
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
                <Card className="searches-card rounded-tr-none">
                  <CardHeader className="pb-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <CardTitle className="pt-1 text-base">My Job Searches</CardTitle>
                      {selectedSearchState === "enabled" ? (
                        <label className="w-full text-sm font-medium text-foreground sm:ml-auto sm:w-64">
                          Search frequency
                          <Select value={searchRunCadence} onValueChange={setSearchRunCadence}>
                            <SelectTrigger id="search-run-cadence" className="mt-2 w-full">
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
                      ) : null}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
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
                          <TableHead className="w-[116px] pr-1">Action</TableHead>
                          <TableHead className="w-[44px] pl-1 pr-2">
                            <span className="sr-only">More actions</span>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredRows.map((row) => {
                          const statusPresentation = presentSearchStatus(row);
                          const hasStatusDetails =
                            Boolean(statusPresentation.statusDetail) ||
                            Boolean(statusPresentation.formatterDetail);
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
                                <div className="inline-flex items-center gap-2">
                                  <div className="inline-flex items-center gap-2 rounded-full bg-secondary/60 px-2 py-1 text-xs font-semibold">
                                    <span
                                      aria-hidden="true"
                                      className={cn("h-2 w-2 rounded-full", toneClassName(statusPresentation.tone))}
                                    />
                                    <span>{statusPresentation.label}</span>
                                  </div>
                                  {hasStatusDetails ? (
                                    <button
                                      type="button"
                                      className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-border text-[11px] font-semibold text-muted-foreground"
                                      aria-label="Show status details"
                                      onClick={() => {
                                        const details = [
                                          statusPresentation.statusDetail,
                                          statusPresentation.formatterDetail
                                            ? `formatter: ${statusPresentation.formatterDetail}`
                                            : "",
                                        ]
                                          .filter(Boolean)
                                          .join(" ");
                                        toast({
                                          title: `${row.label}: status details`,
                                          description: details,
                                        });
                                      }}
                                    >
                                      i
                                    </button>
                                  ) : null}
                                </div>
                              </TableCell>
                              <TableCell>{statusPresentation.foundLabel}</TableCell>
                              <TableCell>{row.filteredCount}</TableCell>
                              <TableCell>{row.dedupedCount}</TableCell>
                              <TableCell>{row.importedCount}</TableCell>
                              <TableCell>{row.avgScore === null ? "n/a" : row.avgScore}</TableCell>
                              <TableCell className="w-[116px] py-2 pl-1 pr-1">
                                <div className="flex items-center justify-start whitespace-nowrap">
                                  {!row.enabled ? (
                                    <Button
                                      size="sm"
                                      className="h-8 shrink-0 px-3"
                                      data-onboarding-enable-source={row.id}
                                      disabled={controlsDisabled}
                                      onClick={() => {
                                        void handleEnableSource(row.id, row.label);
                                      }}
                                    >
                                      Enable
                                    </Button>
                                  ) : (
                                    <Button
                                      size="sm"
                                      className="h-8 shrink-0 px-3"
                                      variant="secondary"
                                      disabled={runNowDisabled}
                                      title={`Manual refreshes remaining today: ${row.manualRefreshRemaining}`}
                                      onClick={() => {
                                        void handleRunSourceNow(row.id);
                                      }}
                                    >
                                      {runNowLabel}
                                    </Button>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="w-[44px] py-2 pl-1 pr-2 text-right align-middle">
                                {row.enabled ? (
                                  <details className="relative inline-block shrink-0">
                                    <summary
                                      className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-border text-sm [&::-webkit-details-marker]:hidden"
                                      aria-label="Source actions"
                                      title="Source actions"
                                    >
                                      ⋯
                                    </summary>
                                    <div className="absolute right-full top-1/2 z-20 mr-2 min-w-[128px] -translate-y-1/2 rounded-md border border-border bg-card p-1 shadow-panel">
                                      {row.authRequired && row.readiness.tone === "warn" ? (
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="w-full justify-start"
                                          data-onboarding-check-source={row.id}
                                          disabled={controlsDisabled}
                                          onClick={() => {
                                            void handleCheckAccess(row.id, row.label);
                                          }}
                                        >
                                          Check access
                                        </Button>
                                      ) : null}
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="w-full justify-start"
                                        data-onboarding-disable-source={row.id}
                                        disabled={controlsDisabled}
                                        onClick={() => {
                                          void handleDisableSource(row.id, row.label);
                                        }}
                                      >
                                        Disable
                                      </Button>
                                    </div>
                                  </details>
                                ) : null}
                              </TableCell>
                            </TableRow>
                          );
                        })}

                        {filteredRows.length > 0 ? (
                          <TableRow className="search-totals-row border-t-2 border-border bg-primary/10 font-semibold hover:bg-primary/10">
                            <TableCell>{totals.stateLabel}</TableCell>
                            <TableCell>—</TableCell>
                            <TableCell>—</TableCell>
                            <TableCell>{totals.foundLabel}</TableCell>
                            <TableCell>{totals.filtered}</TableCell>
                            <TableCell>{totals.deduped}</TableCell>
                            <TableCell>{totals.imported}</TableCell>
                            <TableCell>{totals.avgScore}</TableCell>
                            <TableCell>—</TableCell>
                            <TableCell />
                          </TableRow>
                        ) : null}
                      </TableBody>
                    </Table>

                    {filteredRows.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No sources in this tab.</p>
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

      {authFlowSource ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/45" />
          <section
            className="relative z-10 w-full max-w-xl rounded-xl border border-border bg-card p-5 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="auth-flow-title"
            data-auth-flow-modal="1"
          >
            <h3 id="auth-flow-title" className="text-lg font-semibold">Connect {authFlowSource.name}</h3>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              <li>Open the source website in a new tab.</li>
              <li>Complete sign-in.</li>
              <li>Return here and click I&apos;m logged in.</li>
            </ol>

            {authFlow.message ? (
              <div
                data-auth-flow-status="1"
                className={cn(
                  "mt-4 text-sm",
                  authFlow.error ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {authFlow.message}
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="outline"
                data-auth-flow-open-source="1"
                disabled={authFlow.busy}
                onClick={handleOpenSourceFromAuthFlow}
              >
                Open source
              </Button>
              <Button
                data-auth-flow-check="1"
                disabled={authFlow.busy}
                onClick={() => {
                  void handleAuthFlowCheck();
                }}
              >
                {authFlow.busy ? "Checking..." : "I'm logged in"}
              </Button>
              <Button
                variant="outline"
                data-auth-flow-close="1"
                disabled={authFlow.busy}
                onClick={() => {
                  setAuthFlow({ sourceId: null, message: "", error: false, busy: false });
                }}
              >
                Close
              </Button>
            </div>
          </section>
        </div>
      ) : null}

      <Toaster />
    </main>
  );
}
