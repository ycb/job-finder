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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { ToastAction } from "@/components/ui/toast";
import { Toaster } from "@/components/ui/toaster";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { ChevronDown, X } from "lucide-react";
import { buildConsentPayload } from "@/lib/onboarding";
import {
  applyJobStatusToDashboard,
  buildSearchCriteriaPayload,
  buildRunAllPayload,
  normalizeSearchCriteriaDraft,
  persistJobStatus,
  runAllSourcesAndSync,
} from "@/features/jobs/api";
import {
  buildJobsActiveFilterChips,
  buildJobsSalaryHistogram,
} from "@/features/jobs/logic";
import {
  buildSearchOverflowActions,
  buildSearchRows,
  computeSearchTotals,
  formatDurationFromNow,
  formatRelativeTimestamp,
  hasSeenSearchesWelcomeToast,
  markSearchesWelcomeToastSeen,
  normalizeSearchState,
  presentSearchPrimaryAction,
  presentSearchStatus,
  persistSearchRunCadence,
  readSearchRunCadence,
  resolveSearchesWelcomeToastScope,
  shouldShowSearchesWelcomeToast,
  splitSearchRows,
} from "@/features/searches/logic";

const AUTH_FLOW_HELP_TEXT = "Step 1: Open source. Step 2: Sign in. Step 3: Click I'm logged in.";
const CONSENT_REQUIRED_MESSAGE =
  "Before continuing, review Terms + Privacy and accept the consent checkboxes in Step 1.";
const JOBS_PAGE_SIZE = 10;
const JOBS_VIEW_OPTIONS = ["all", "new", "best_match", "applied", "skipped", "rejected"];

const FIELD_CLASSNAME =
  "mt-2 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring";

function sourceKindFromType(value) {
  if (value === "linkedin_capture_file") {
    return "li";
  }
  if (value === "builtin_search") {
    return "bi";
  }
  if (value === "wellfound_search") {
    return "wf";
  }
  if (value === "ashby_search") {
    return "ah";
  }
  if (value === "google_search") {
    return "gg";
  }
  if (value === "indeed_search") {
    return "id";
  }
  if (value === "ziprecruiter_search") {
    return "zr";
  }
  if (value === "remoteok_search") {
    return "ro";
  }
  return "unknown";
}

function sourceKindLabel(kind) {
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
  if (kind === "ro") {
    return "RemoteOK";
  }
  if (kind === "mixed") {
    return "Multiple";
  }
  return "Unknown";
}

function formatSearchMetricValue(value) {
  return Number.isFinite(Number(value)) ? Math.max(0, Math.round(Number(value))) : "—";
}

function formatJobStatus(status) {
  if (status === "skip_for_now") {
    return "skip for now";
  }
  if (status === "viewed" || status === "applied" || status === "rejected") {
    return status;
  }
  return "new";
}

function formatJobFreshness(job) {
  if (typeof job?.postedAt === "string" && job.postedAt.trim()) {
    return formatRelativeTimestamp(job.postedAt);
  }
  return "Unknown";
}

function formatSalaryMaskInput(value) {
  const digits = String(value || "")
    .replace(/[^0-9]/g, "")
    .slice(0, 9);
  if (!digits) {
    return "";
  }
  return `$${Number(digits).toLocaleString("en-US")}`;
}

function rankJobs(items, jobsSort) {
  const jobs = Array.isArray(items) ? [...items] : [];

  const dateValue = (job) => {
    const posted = Date.parse(typeof job?.postedAt === "string" ? job.postedAt : "");
    if (Number.isFinite(posted)) {
      return posted;
    }
    const updated = Date.parse(typeof job?.updatedAt === "string" ? job.updatedAt : "");
    return Number.isFinite(updated) ? updated : 0;
  };

  const scoreValue = (job) => {
    const parsed = Number(job?.score);
    return Number.isFinite(parsed) ? parsed : -1;
  };
  const salaryValue = (job) => parseSalaryValue(job?.salaryText);

  jobs.sort((left, right) => {
    if (jobsSort === "salary") {
      const salaryDiff = salaryValue(right) - salaryValue(left);
      if (salaryDiff !== 0) {
        return salaryDiff;
      }
      const scoreDiff = scoreValue(right) - scoreValue(left);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }
      const freshnessDiff = dateValue(right) - dateValue(left);
      if (freshnessDiff !== 0) {
        return freshnessDiff;
      }
    } else if (jobsSort === "date") {
      const freshnessDiff = dateValue(right) - dateValue(left);
      if (freshnessDiff !== 0) {
        return freshnessDiff;
      }
      const scoreDiff = scoreValue(right) - scoreValue(left);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }
    } else {
      const scoreDiff = scoreValue(right) - scoreValue(left);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }
      const freshnessDiff = dateValue(right) - dateValue(left);
      if (freshnessDiff !== 0) {
        return freshnessDiff;
      }
    }

    return String(left?.title || "").localeCompare(String(right?.title || ""));
  });

  return jobs;
}

function parseTerms(value) {
  const seen = new Set();
  const terms = [];
  for (const part of String(value || "").split(",")) {
    const normalized = part.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    terms.push(normalized);
  }
  return terms;
}

function parseSalaryValue(value) {
  const text = String(value || "").toLowerCase();
  if (!text) {
    return 0;
  }
  const matches = [...text.matchAll(/([0-9]+(?:[.,][0-9]{3})*(?:\.[0-9]+)?)(\s*k)?/g)];
  if (matches.length === 0) {
    return 0;
  }
  const numbers = matches
    .map((match) => {
      const amount = Number(String(match[1] || "").replace(/,/g, ""));
      if (!Number.isFinite(amount)) {
        return 0;
      }
      return match[2] ? amount * 1000 : amount;
    })
    .filter((amount) => amount > 0);
  if (numbers.length === 0) {
    return 0;
  }
  return Math.max(...numbers);
}

function formatCurrency(value) {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) {
    return "—";
  }
  return `$${Math.round(Number(value)).toLocaleString("en-US")}`;
}

function jobSearchHaystack(job) {
  return [
    job?.title,
    job?.summary,
    Array.isArray(job?.reasons) ? job.reasons.join(" ") : "",
    job?.location,
    job?.company,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function countKeywordHits(jobs, term) {
  if (!term) {
    return 0;
  }
  const normalized = term.toLowerCase();
  return (Array.isArray(jobs) ? jobs : []).reduce((count, job) => {
    const haystack = jobSearchHaystack(job);
    return haystack.includes(normalized) ? count + 1 : count;
  }, 0);
}

function normalizeTitleKey(value) {
  const title = String(value || "").trim();
  if (!title) {
    return "Unknown";
  }
  return title;
}

function computeTitleBreakdown(jobs, limit = 5) {
  const counts = new Map();
  for (const job of Array.isArray(jobs) ? jobs : []) {
    const key = normalizeTitleKey(job?.title);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function computeSalarySummary(jobs) {
  const values = (Array.isArray(jobs) ? jobs : [])
    .map((job) => parseSalaryValue(job?.salaryText))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);

  if (values.length === 0) {
    return {
      min: null,
      avg: null,
      max: null,
      p75: null,
      aboveAvgCount: 0,
      topBandCount: 0,
      withSalaryCount: 0,
    };
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  const avg = total / values.length;
  const p75Index = Math.floor((values.length - 1) * 0.75);
  const p75 = values[p75Index] || values[values.length - 1];
  return {
    min: values[0],
    avg,
    max: values[values.length - 1],
    p75,
    aboveAvgCount: values.filter((value) => value > avg).length,
    topBandCount: values.filter((value) => value >= p75).length,
    withSalaryCount: values.length,
  };
}

function ageInDays(timestamp) {
  const parsed = Date.parse(String(timestamp || ""));
  if (!Number.isFinite(parsed)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.floor((Date.now() - parsed) / (1000 * 60 * 60 * 24));
}

function matchesPostedWindow(job, windowKey) {
  if (windowKey === "all") {
    return true;
  }
  const days = ageInDays(job?.postedAt);
  if (!Number.isFinite(days)) {
    return false;
  }
  if (windowKey === "24h") {
    return days <= 1;
  }
  if (windowKey === "3d") {
    return days <= 3;
  }
  if (windowKey === "1w") {
    return days <= 7;
  }
  if (windowKey === "2w") {
    return days <= 14;
  }
  if (windowKey === "1m") {
    return days <= 30;
  }
  return true;
}

function buildRunAllDescription(runAllPayload, dashboard) {
  const captures = Array.isArray(runAllPayload?.captures) ? runAllPayload.captures : [];
  const completedCaptures = captures.filter((capture) => capture?.status === "completed").length;
  const activeRankedCount = Number(
    dashboard?.profile?.activeCount ??
      (Array.isArray(dashboard?.queue) ? dashboard.queue.length : 0),
  );
  return `Ran ${completedCaptures}/${captures.length} sources. ${activeRankedCount} active ranked jobs.`;
}

function jobStatusSuccessCopy(status) {
  if (status === "rejected") {
    return { title: "Job rejected", description: "The job was moved to Rejected." };
  }
  if (status === "applied") {
    return { title: "Marked applied", description: "The job was moved to Applied." };
  }
  if (status === "skip_for_now") {
    return { title: "Marked skip for now", description: "The job was moved to Skipped." };
  }
  if (status === "viewed") {
    return { title: "Marked viewed", description: "The job remains in the active queue." };
  }
  return { title: "Status updated", description: "The job status was updated." };
}

function formatHistogramRangeLabel(range, formatter = (value) => value) {
  if (!range || !Number.isFinite(Number(range.min)) || !Number.isFinite(Number(range.max))) {
    return "Not set";
  }

  const min = formatter(Number(range.min));
  const max = formatter(Number(range.max));
  return `${min} - ${max}`;
}

function clampRangeToBounds(range, bounds) {
  if (
    !range ||
    !bounds ||
    !Number.isFinite(Number(bounds.min)) ||
    !Number.isFinite(Number(bounds.max))
  ) {
    return null;
  }

  const minBound = Number(bounds.min);
  const maxBound = Number(bounds.max);
  const nextMin = Math.min(Math.max(Number(range.min), minBound), maxBound);
  const nextMax = Math.max(Math.min(Number(range.max), maxBound), nextMin);

  return {
    min: nextMin,
    max: nextMax,
  };
}

function bucketCountMax(histogram) {
  return Math.max(
    1,
    ...(Array.isArray(histogram?.buckets)
      ? histogram.buckets.map((bucket) => Number(bucket?.count) || 0)
      : [0]),
  );
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
  const [jobsView, setJobsView] = useState("all");
  const [jobsTopTab, setJobsTopTab] = useState("search");
  const [jobsSort, setJobsSort] = useState("score");
  const [jobsSourceFilter, setJobsSourceFilter] = useState("all");
  const [jobsPostedFilter, setJobsPostedFilter] = useState("all");
  const [jobsSalaryPresenceFilter, setJobsSalaryPresenceFilter] = useState("all");
  const [jobsSalaryRangeFilter, setJobsSalaryRangeFilter] = useState(null);
  const [jobsHardFilterExpanded, setJobsHardFilterExpanded] = useState(false);
  const [jobsKeywordExpanded, setJobsKeywordExpanded] = useState(false);
  const [jobsFiltersExpanded, setJobsFiltersExpanded] = useState(false);
  const [jobsWidgetKeywordFilter, setJobsWidgetKeywordFilter] = useState("");
  const [jobsWidgetTitleFilter, setJobsWidgetTitleFilter] = useState("");
  const [jobsPage, setJobsPage] = useState(1);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [criteriaDraft, setCriteriaDraft] = useState(() => normalizeSearchCriteriaDraft({}));
  const [criteriaBusy, setCriteriaBusy] = useState(false);
  const [rejectDialog, setRejectDialog] = useState({
    open: false,
    jobId: null,
    reason: "",
    saving: false,
  });
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
  const [openSourceActionsMenuId, setOpenSourceActionsMenuId] = useState("");
  const { toast } = useToast();

  const loadDashboard = useCallback(async (options = {}) => {
    const quiet = options.quiet === true;
    if (!quiet) {
      setLoading(true);
    }

    try {
      const payload = await requestJson("/api/dashboard");
      setDashboard(payload);
      return payload;
    } catch (error) {
      toast({
        title: "Dashboard unavailable",
        description: typeof error?.message === "string" ? error.message : "Unable to load dashboard.",
        variant: "destructive",
      });
      return null;
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

  useEffect(() => {
    setCriteriaDraft(normalizeSearchCriteriaDraft(dashboard?.searchCriteria || {}));
  }, [dashboard]);

  useEffect(() => {
    if (!dashboard) {
      return;
    }
    const criteria = normalizeSearchCriteriaDraft(dashboard?.searchCriteria || {});
    const hasComposerCriteria = [
      criteria.title,
      criteria.location,
      criteria.minSalary,
      criteria.datePosted,
      criteria.hardIncludeTerms,
      criteria.hardExcludeTerms,
      criteria.additionalKeywords,
    ].some((value) => String(value || "").trim().length > 0);
    const activeCount = Number(
      dashboard?.profile?.activeCount ??
      (Array.isArray(dashboard?.queue) ? dashboard.queue.length : 0),
    );
    if (hasComposerCriteria && activeCount > 0) {
      setJobsHardFilterExpanded(false);
      setJobsKeywordExpanded(false);
    }
  }, [dashboard]);

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
      mainTab: jobsTopTab === "search" ? "searches" : "jobs",
      searchState: "enabled",
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
              onClick={() => {
                setSearchState("disabled");
                setJobsTopTab("disabled");
              }}
            >
              Go to Disabled
            </ToastAction>
          </div>
        ),
      });
    }
  }, [consentGateRequired, dashboard, jobsTopTab, toast, welcomeToastScope]);


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
  const sourceReadinessRollup = useMemo(() => {
    const actionNeeded = enabledRows.filter(
      (row) => row.authRequired === true && row.readiness?.key === "not_authorized",
    ).length;
    return {
      ready: Math.max(0, enabledRows.length - actionNeeded),
      actionNeeded,
      disabled: disabledRows.length,
    };
  }, [disabledRows.length, enabledRows]);

  const controlsDisabled = busyAction.length > 0 || authFlow.busy;
  const jobsControlsDisabled = controlsDisabled || criteriaBusy || rejectDialog.saving;

  const filterJobsForVisibleSources = useCallback(
    (items) =>
      (Array.isArray(items) ? items : []).filter((job) => {
        if (!Array.isArray(job?.sourceIds) || job.sourceIds.length === 0) {
          return true;
        }
        return job.sourceIds.some((sourceId) => sourceById[sourceId]?.enabled !== false);
      }),
    [sourceById],
  );

  const visibleJobSources = useMemo(
    () => rawSources.filter((source) => source && source.enabled !== false),
    [rawSources],
  );
  const sourceKindBySourceId = useMemo(
    () => new Map(visibleJobSources.map((source) => [source.id, sourceKindFromType(source.type)])),
    [visibleJobSources],
  );
  const activeJobs = useMemo(
    () => filterJobsForVisibleSources(dashboard?.queue),
    [dashboard, filterJobsForVisibleSources],
  );
  const appliedJobs = useMemo(
    () => filterJobsForVisibleSources(dashboard?.appliedQueue),
    [dashboard, filterJobsForVisibleSources],
  );
  const skippedJobs = useMemo(
    () => filterJobsForVisibleSources(dashboard?.skippedQueue),
    [dashboard, filterJobsForVisibleSources],
  );
  const rejectedJobs = useMemo(
    () => filterJobsForVisibleSources(dashboard?.rejectedQueue),
    [dashboard, filterJobsForVisibleSources],
  );
  const jobsViewCounts = useMemo(
    () => ({
      all: activeJobs.length,
      new: activeJobs.filter((job) => job?.status === "new").length,
      best_match: activeJobs.filter((job) => job?.bucket === "high_signal").length,
      applied: appliedJobs.length,
      skipped: skippedJobs.length,
      rejected: rejectedJobs.length,
    }),
    [activeJobs, appliedJobs, rejectedJobs, skippedJobs],
  );
  const jobsViewTabs = useMemo(
    () => [
      { value: "all", label: "All", count: jobsViewCounts.all },
      { value: "new", label: "New", count: jobsViewCounts.new },
      { value: "best_match", label: "Best match", count: jobsViewCounts.best_match },
    ],
    [jobsViewCounts],
  );
  const jobsDatasetOptions = useMemo(
    () => [
      { value: "all", label: "All", count: jobsViewCounts.all },
      { value: "applied", label: "Applied", count: jobsViewCounts.applied },
      { value: "skipped", label: "Skipped", count: jobsViewCounts.skipped },
      { value: "rejected", label: "Rejected", count: jobsViewCounts.rejected },
    ],
    [jobsViewCounts],
  );
  const jobsDatasetValue = useMemo(
    () =>
      jobsView === "applied" || jobsView === "skipped" || jobsView === "rejected"
        ? jobsView
        : "all",
    [jobsView],
  );
  const jobsDatasetLabel = useMemo(() => {
    const option = jobsDatasetOptions.find((item) => item.value === jobsDatasetValue);
    return option ? `${option.label} (${option.count})` : "All (0)";
  }, [jobsDatasetOptions, jobsDatasetValue]);
  const jobsAlternateDatasetActive =
    jobsView === "applied" || jobsView === "skipped" || jobsView === "rejected";
  const jobsAllInSelectedView = useMemo(() => {
    if (jobsView === "applied") {
      return appliedJobs;
    }
    if (jobsView === "skipped") {
      return skippedJobs;
    }
    if (jobsView === "rejected") {
      return rejectedJobs;
    }
    if (jobsView === "new") {
      return activeJobs.filter((job) => job?.status === "new");
    }
    if (jobsView === "best_match") {
      return activeJobs.filter((job) => job?.bucket === "high_signal");
    }
    return activeJobs;
  }, [activeJobs, appliedJobs, jobsView, rejectedJobs, skippedJobs]);
  const jobSourceFilters = useMemo(() => {
    const totalsByKind = new Map();

    for (const source of visibleJobSources) {
      const kind = sourceKindBySourceId.get(source.id);
      if (!kind || totalsByKind.has(kind)) {
        continue;
      }
      totalsByKind.set(kind, { kind, label: sourceKindLabel(kind), count: 0 });
    }

    for (const job of jobsAllInSelectedView) {
      const seenKinds = new Set();
      for (const sourceId of Array.isArray(job?.sourceIds) ? job.sourceIds : []) {
        const kind = sourceKindBySourceId.get(sourceId);
        if (kind) {
          seenKinds.add(kind);
        }
      }
      for (const kind of seenKinds) {
        const current = totalsByKind.get(kind);
        if (current) {
          current.count += 1;
        }
      }
    }

    return [...totalsByKind.values()].sort((left, right) => left.label.localeCompare(right.label));
  }, [jobsAllInSelectedView, sourceKindBySourceId, visibleJobSources]);
  const jobPostedFilters = useMemo(() => {
    const options = [
      { value: "all", label: "Any time" },
      { value: "24h", label: "24h" },
      { value: "3d", label: "3 days" },
      { value: "1w", label: "1 week" },
      { value: "2w", label: "2 weeks" },
      { value: "1m", label: "1 month" },
    ];
    return options.map((option) => ({
      ...option,
      count:
        option.value === "all"
          ? jobsAllInSelectedView.length
          : jobsAllInSelectedView.filter((job) => matchesPostedWindow(job, option.value)).length,
    }));
  }, [jobsAllInSelectedView]);
  const filteredJobsBase = useMemo(() => {
    return jobsAllInSelectedView.filter((job) => {
      if (
        jobsSourceFilter !== "all" &&
        !(Array.isArray(job?.sourceIds) ? job.sourceIds : []).some(
          (sourceId) => sourceKindBySourceId.get(sourceId) === jobsSourceFilter,
        )
      ) {
        return false;
      }

      if (!matchesPostedWindow(job, jobsPostedFilter)) {
        return false;
      }

      const salaryValue = parseSalaryValue(job?.salaryText);
      if (jobsSalaryPresenceFilter === "has_salary" && salaryValue <= 0) {
        return false;
      }
      if (jobsSalaryPresenceFilter === "missing_salary" && salaryValue > 0) {
        return false;
      }

      return true;
    });
  }, [jobsAllInSelectedView, jobsPostedFilter, jobsSalaryPresenceFilter, jobsSourceFilter, sourceKindBySourceId]);
  const jobsWidgetFilteredBase = useMemo(
    () =>
      filteredJobsBase.filter((job) => {
        if (jobsWidgetTitleFilter && normalizeTitleKey(job?.title) !== jobsWidgetTitleFilter) {
          return false;
        }

        if (jobsWidgetKeywordFilter) {
          const normalizedKeyword = jobsWidgetKeywordFilter.toLowerCase();
          if (!jobSearchHaystack(job).includes(normalizedKeyword)) {
            return false;
          }
        }

        return true;
      }),
    [filteredJobsBase, jobsWidgetKeywordFilter, jobsWidgetTitleFilter],
  );
  const salaryHistogramJobs = useMemo(
    () => jobsWidgetFilteredBase,
    [jobsWidgetFilteredBase],
  );
  const jobsSalaryHistogram = useMemo(
    () => buildJobsSalaryHistogram(salaryHistogramJobs, { bucketCount: 10 }),
    [salaryHistogramJobs],
  );
  const jobsWithSalaryCount = useMemo(
    () =>
      salaryHistogramJobs.reduce(
        (count, job) => count + (parseSalaryValue(job?.salaryText) > 0 ? 1 : 0),
        0,
      ),
    [salaryHistogramJobs],
  );
  const jobsMissingSalaryCount = useMemo(
    () => Math.max(0, jobsWidgetFilteredBase.length - jobsWithSalaryCount),
    [jobsWidgetFilteredBase.length, jobsWithSalaryCount],
  );
  const filteredJobs = useMemo(
    () =>
      jobsWidgetFilteredBase.filter((job) => {
        const salaryValue = parseSalaryValue(job?.salaryText);
        if (
          jobsSalaryRangeFilter &&
          Number.isFinite(Number(jobsSalaryRangeFilter.min)) &&
          Number.isFinite(Number(jobsSalaryRangeFilter.max))
        ) {
          if (
            salaryValue <= 0 ||
            salaryValue < Number(jobsSalaryRangeFilter.min) ||
            salaryValue > Number(jobsSalaryRangeFilter.max)
          ) {
            return false;
          }
        }

        return true;
      }),
    [jobsSalaryRangeFilter, jobsWidgetFilteredBase],
  );
  const sortedJobs = useMemo(() => rankJobs(filteredJobs, jobsSort), [filteredJobs, jobsSort]);
  const jobsKeywordWidgets = useMemo(() => {
    const terms = parseTerms(criteriaDraft.additionalKeywords);
    return terms.map((term, index) => ({
      key: term || `kw-${index + 1}`,
      term,
      label: term ? term.toUpperCase() : `KW#${index + 1}`,
      value: term ? countKeywordHits(filteredJobsBase, term) : 0,
    }));
  }, [criteriaDraft.additionalKeywords, filteredJobsBase]);
  const jobsTitleBreakdown = useMemo(
    () => computeTitleBreakdown(filteredJobsBase, 5),
    [filteredJobsBase],
  );
  const jobsAverageScore = useMemo(() => {
    const scores = filteredJobs
      .map((job) => Number(job?.score))
      .filter((score) => Number.isFinite(score) && score >= 0);
    if (scores.length === 0) {
      return null;
    }
    return scores.reduce((sum, score) => sum + score, 0) / scores.length;
  }, [filteredJobs]);
  const activeFilterChips = useMemo(
    () =>
      buildJobsActiveFilterChips({
        sourceFilter: jobsSourceFilter,
        sourceOptions: jobSourceFilters,
        postedFilter: jobsPostedFilter,
        postedOptions: jobPostedFilters,
        salaryRangeFilter: jobsSalaryRangeFilter,
        salaryPresenceFilter: jobsSalaryPresenceFilter,
        widgetKeywordFilter: jobsWidgetKeywordFilter,
        widgetTitleFilter: jobsWidgetTitleFilter,
      }),
    [
      jobPostedFilters,
      jobSourceFilters,
      jobsPostedFilter,
      jobsSalaryPresenceFilter,
      jobsSalaryRangeFilter,
      jobsSourceFilter,
      jobsWidgetKeywordFilter,
      jobsWidgetTitleFilter,
    ],
  );
  const jobsById = useMemo(() => {
    const lookup = Object.create(null);
    for (const group of [activeJobs, appliedJobs, skippedJobs, rejectedJobs]) {
      for (const job of group) {
        lookup[job.id] = job;
      }
    }
    return lookup;
  }, [activeJobs, appliedJobs, rejectedJobs, skippedJobs]);
  const totalJobsPages = Math.max(1, Math.ceil(sortedJobs.length / JOBS_PAGE_SIZE));
  const currentJob = useMemo(
    () => sortedJobs.find((job) => job.id === selectedJobId) || sortedJobs[0] || null,
    [selectedJobId, sortedJobs],
  );
  const currentJobPosition = useMemo(() => {
    if (!currentJob) {
      return { index: -1, total: sortedJobs.length };
    }
    return {
      index: sortedJobs.findIndex((job) => job.id === currentJob.id),
      total: sortedJobs.length,
    };
  }, [currentJob, sortedJobs]);
  const currentPage = Math.min(jobsPage, totalJobsPages);
  const pagedJobs = useMemo(() => {
    const pageStartIndex = (currentPage - 1) * JOBS_PAGE_SIZE;
    return sortedJobs.slice(pageStartIndex, pageStartIndex + JOBS_PAGE_SIZE);
  }, [currentPage, sortedJobs]);
  const currentJobSourceAttributions = useMemo(
    () =>
      currentJob
        ? (Array.isArray(currentJob.sourceIds) ? currentJob.sourceIds : [])
            .map((sourceId) => sourceById[sourceId])
            .filter(Boolean)
        : [],
    [currentJob, sourceById],
  );
  const currentJobSourceKinds = useMemo(() => {
    const kinds = new Set(
      currentJobSourceAttributions.map((source) => sourceKindFromType(source.type)),
    );
    if (kinds.size === 0) {
      return "Unknown";
    }
    if (kinds.size > 1) {
      return sourceKindLabel("mixed");
    }
    return sourceKindLabel([...kinds][0]);
  }, [currentJobSourceAttributions]);
  const monetizationMetrics = useMemo(() => {
    const monetization =
      dashboard?.monetization && typeof dashboard.monetization === "object"
        ? dashboard.monetization
        : {};
    return {
      searchesUsed: Number.isFinite(Number(monetization.searchesUsedThisMonth))
        ? Math.max(0, Math.round(Number(monetization.searchesUsedThisMonth)))
        : 0,
      searchLimit: Number.isFinite(Number(monetization.monthlySearchLimit))
        ? Math.max(0, Math.round(Number(monetization.monthlySearchLimit)))
        : 10,
      jobsStored: Number.isFinite(Number(monetization.jobsStored))
        ? Math.max(0, Math.round(Number(monetization.jobsStored)))
        : 0,
      jobsLimit: Number.isFinite(Number(monetization.jobsInDbLimit))
        ? Math.max(0, Math.round(Number(monetization.jobsInDbLimit)))
        : 500,
    };
  }, [dashboard]);

  useEffect(() => {
    if (jobsSourceFilter === "all") {
      return;
    }
    const filterStillAvailable = jobSourceFilters.some(
      (filter) => filter.kind === jobsSourceFilter && filter.count > 0,
    );
    if (!filterStillAvailable) {
      setJobsSourceFilter("all");
    }
  }, [jobSourceFilters, jobsSourceFilter]);

  useEffect(() => {
    setJobsSalaryRangeFilter((current) => {
      const next = clampRangeToBounds(current, jobsSalaryHistogram);
      if (!current && !next) {
        return current;
      }
      if (!next) {
        return null;
      }
      if (current && current.min === next.min && current.max === next.max) {
        return current;
      }
      return next;
    });
  }, [jobsSalaryHistogram]);

  useEffect(() => {
    setJobsPage(1);
    setSelectedJobId(sortedJobs[0]?.id || null);
  }, [
    jobsSourceFilter,
    jobsSort,
    jobsView,
    jobsPostedFilter,
    jobsSalaryPresenceFilter,
    jobsSalaryRangeFilter,
    jobsWidgetKeywordFilter,
    jobsWidgetTitleFilter,
  ]);

  useEffect(() => {
    const nextSelectedJobId = sortedJobs.find((job) => job.id === selectedJobId)
      ? selectedJobId
      : sortedJobs[0]?.id || null;
    if (nextSelectedJobId !== selectedJobId) {
      setSelectedJobId(nextSelectedJobId);
    }
  }, [selectedJobId, sortedJobs]);

  useEffect(() => {
    if (jobsPage > totalJobsPages) {
      setJobsPage(totalJobsPages);
    }
  }, [jobsPage, totalJobsPages]);

  useEffect(() => {
    if (!selectedJobId) {
      return;
    }
    const currentIndex = sortedJobs.findIndex((job) => job.id === selectedJobId);
    if (currentIndex < 0) {
      return;
    }
    const nextPage = Math.floor(currentIndex / JOBS_PAGE_SIZE) + 1;
    if (nextPage !== jobsPage) {
      setJobsPage(nextPage);
    }
  }, [jobsPage, selectedJobId, sortedJobs]);

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

  const handleStartAuthFlow = useCallback((sourceId) => {
    if (!ensureConsentAccepted()) {
      return;
    }

    const source = sourceById[sourceId];
    if (!source) {
      return;
    }

    setOpenSourceActionsMenuId("");
    setAuthFlow({
      sourceId,
      message: AUTH_FLOW_HELP_TEXT,
      error: false,
      busy: false,
    });
  }, [ensureConsentAccepted, sourceById]);

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
          if (options.suppressFailureToast !== true) {
            toast({
              title: "Access check failed",
              description: `${sourceName} is not authorized. Sign in and retry.`,
              variant: "destructive",
            });
          }
          if (options.openSourceOnFail !== false && source?.searchUrl && authRequired) {
            window.open(source.searchUrl, "_blank", "noopener,noreferrer");
          }
          return false;
        }
      } catch (error) {
        if (options.suppressFailureToast !== true) {
          toast({
            title: "Access check failed",
            description: typeof error?.message === "string" ? error.message : "Unable to check source access.",
            variant: "destructive",
          });
        }
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

  useEffect(() => {
    if (!openSourceActionsMenuId) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (event.target instanceof Element && event.target.closest("[data-source-actions-menu-root='1']")) {
        return;
      }
      setOpenSourceActionsMenuId("");
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setOpenSourceActionsMenuId("");
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openSourceActionsMenuId]);

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

    const sourceName = authFlowSource.name;
    const sourceId = authFlowSource.id;

    setAuthFlow((current) => ({
      ...current,
      busy: true,
      error: false,
      message: `Checking access for ${sourceName}...`,
    }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    const passed = await handleCheckAccess(sourceId, sourceName, {
      openSourceOnFail: false,
      suppressFailureToast: true,
    });

    if (passed) {
      setAuthFlow({ sourceId: null, message: "", error: false, busy: false });
      return;
    }

    setAuthFlow((current) => ({
      ...current,
      busy: false,
      error: true,
      message: `${sourceName} is not authorized. Sign in and retry.`,
    }));
  }, [authFlow.busy, authFlowSource, handleCheckAccess]);

  const executeJobStatusUpdate = useCallback(
    async (job, status, reason = "") => {
      if (!job) {
        return false;
      }

      const trimmedReason = String(reason || "").trim();

      setBusyAction(`job:${job.id}:${status}`);
      setDashboard((current) => applyJobStatusToDashboard(current, job.id, status, trimmedReason));

      try {
        await persistJobStatus(requestJson, job.id, status, trimmedReason);
        await loadDashboard({ quiet: true });
        const successCopy = jobStatusSuccessCopy(status);
        toast({
          title: successCopy.title,
          description: successCopy.description,
        });
        return true;
      } catch (error) {
        await loadDashboard({ quiet: true });
        toast({
          title: "Status update failed",
          description:
            typeof error?.message === "string" ? error.message : "Unable to update job status.",
          variant: "destructive",
        });
        return false;
      } finally {
        setBusyAction("");
      }
    },
    [loadDashboard, toast],
  );

  const handleOpenCurrentJob = useCallback(async () => {
    if (!currentJob?.reviewTarget?.url) {
      return;
    }

    window.open(currentJob.reviewTarget.url, "job-review-target", "noopener,noreferrer");

    if (currentJob.status !== "new") {
      return;
    }

    setBusyAction(`job:${currentJob.id}:viewed`);
    setDashboard((current) => applyJobStatusToDashboard(current, currentJob.id, "viewed"));

    try {
      await persistJobStatus(requestJson, currentJob.id, "viewed");
    } catch (error) {
      await loadDashboard({ quiet: true });
      toast({
        title: "Viewed status failed",
        description:
          typeof error?.message === "string" ? error.message : "Unable to mark job as viewed.",
        variant: "destructive",
      });
    } finally {
      setBusyAction("");
    }
  }, [currentJob, loadDashboard, toast]);

  const handleFindJobs = useCallback(async () => {
    if (!ensureConsentAccepted()) {
      return;
    }

    setBusyAction("jobs:run-all");
    setCriteriaBusy(true);

    try {
      await requestJson("/api/search-criteria", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildSearchCriteriaPayload(criteriaDraft)),
      });

      const runAllPayload = await runAllSourcesAndSync(
        requestJson,
        buildRunAllPayload(searchRunCadence),
      );
      const refreshedDashboard = await loadDashboard({ quiet: true });

      toast({
        title: "Jobs refreshed",
        description: buildRunAllDescription(runAllPayload, refreshedDashboard),
      });
      setJobsHardFilterExpanded(false);
      setJobsKeywordExpanded(false);
      setJobsFiltersExpanded(false);
      setJobsWidgetKeywordFilter("");
      setJobsWidgetTitleFilter("");
      setJobsSalaryRangeFilter(null);
    } catch (error) {
      const authSources = Array.isArray(error?.payload?.authSources) ? error.payload.authSources : [];
      const authSourceLabels = authSources
        .map((source) => {
          if (typeof source === "string") {
            return sourceById[source]?.name || source;
          }
          const sourceId =
            typeof source?.sourceId === "string"
              ? source.sourceId
              : typeof source?.id === "string"
                ? source.id
                : "";
          return sourceById[sourceId]?.name || source?.name || sourceId;
        })
        .filter(Boolean);

      toast({
        title: error?.payload?.requiresAuthCheck ? "Sign-in required" : "Search failed",
        description: error?.payload?.requiresAuthCheck
          ? `Complete access checks for ${authSourceLabels.join(", ")} before running searches.`
          : typeof error?.message === "string"
            ? error.message
            : "Unable to save search criteria and run searches.",
        variant: "destructive",
      });
    } finally {
      setCriteriaBusy(false);
      setBusyAction("");
    }
  }, [criteriaDraft, ensureConsentAccepted, loadDashboard, searchRunCadence, sourceById, toast]);

  const handleRejectSubmit = useCallback(async () => {
    const job = rejectDialog.jobId ? jobsById[rejectDialog.jobId] || null : null;
    const trimmedReason = String(rejectDialog.reason || "").trim();

    if (!job) {
      setRejectDialog({ open: false, jobId: null, reason: "", saving: false });
      return;
    }

    if (!trimmedReason) {
      toast({
        title: "Reject reason required",
        description: "Add a short reason before rejecting this job.",
        variant: "destructive",
      });
      return;
    }

    setRejectDialog((current) => ({ ...current, saving: true }));
    const updated = await executeJobStatusUpdate(job, "rejected", trimmedReason);
    setRejectDialog({
      open: updated ? false : true,
      jobId: updated ? null : job.id,
      reason: updated ? "" : trimmedReason,
      saving: false,
    });
  }, [executeJobStatusUpdate, jobsById, rejectDialog, toast]);

  const moveSelection = useCallback(
    (direction) => {
      if (!Array.isArray(sortedJobs) || sortedJobs.length === 0) {
        return;
      }
      const currentIndex = sortedJobs.findIndex((job) => job.id === selectedJobId);
      const baseIndex = currentIndex >= 0 ? currentIndex : 0;
      const nextIndex = Math.min(
        sortedJobs.length - 1,
        Math.max(0, baseIndex + (direction < 0 ? -1 : 1)),
      );
      const nextJob = sortedJobs[nextIndex];
      if (!nextJob) {
        return;
      }
      setSelectedJobId(nextJob.id);
      setJobsPage(Math.floor(nextIndex / JOBS_PAGE_SIZE) + 1);
    },
    [selectedJobId, sortedJobs],
  );

  const renderRangeHistogramFilter = useCallback(
    ({
      title,
      histogram,
      selectedRange,
      onSelectRange,
      formatter,
      sliderStep,
      headerAccessory = null,
    }) => {
      const buckets = Array.isArray(histogram?.buckets) ? histogram.buckets : [];
      const maxCount = bucketCountMax(histogram);
      const hasBounds =
        Number.isFinite(Number(histogram?.min)) && Number.isFinite(Number(histogram?.max));
      const effectiveRange = selectedRange || (hasBounds ? { min: histogram.min, max: histogram.max } : null);
      const sliderValue = effectiveRange ? [Number(effectiveRange.min), Number(effectiveRange.max)] : [0, 0];
      const showHeader = Boolean(title) || Boolean(headerAccessory);

      return (
        <div className="space-y-4 rounded-xl border border-border/70 bg-card p-4">
          {showHeader ? (
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                {title ? <div className="text-sm font-semibold text-foreground">{title}</div> : null}
                {headerAccessory}
              </div>
            </div>
          ) : null}

          {buckets.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-secondary/10 px-3 py-6 text-sm text-muted-foreground">
              No salary data is available for the current result set.
            </div>
          ) : (
            <>
              <div className="space-y-4">
                <div className="flex h-40 items-end gap-2 rounded-lg border border-border/60 bg-secondary/10 px-3 py-3">
                  {buckets.map((bucket) => {
                    const bucketMin = Number(bucket.min);
                    const bucketMax = Number(bucket.max);
                    const inSelectedRange =
                      !selectedRange ||
                      (bucketMax >= Number(selectedRange.min) && bucketMin <= Number(selectedRange.max));
                    const heightPct = maxCount > 0 ? (Number(bucket.count || 0) / maxCount) * 100 : 0;
                    return (
                      <TooltipProvider key={bucket.key} delayDuration={120}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className="group flex h-full min-w-0 flex-1 flex-col justify-end gap-2"
                              onClick={() =>
                                onSelectRange(
                                  selectedRange &&
                                    Number(selectedRange.min) === bucketMin &&
                                    Number(selectedRange.max) === bucketMax
                                    ? null
                                    : { min: bucketMin, max: bucketMax },
                                )
                              }
                            >
                              <span className="text-[10px] font-medium text-muted-foreground">
                                {bucket.count}
                              </span>
                              <div className="flex flex-1 items-end">
                                <div
                                  className={cn(
                                    "w-full rounded-t-md border border-border/60 transition",
                                    inSelectedRange
                                      ? "bg-foreground/85"
                                      : "bg-secondary/30 group-hover:bg-secondary/50",
                                  )}
                                  style={{
                                    height: `${Math.max(heightPct, Number(bucket.count || 0) > 0 ? 18 : 6)}%`,
                                  }}
                                />
                              </div>
                            </button>
                          </TooltipTrigger>
                          <TooltipContent className="bg-card">
                            <div className="space-y-1 text-xs">
                              <div>{formatHistogramRangeLabel(bucket, formatter)}</div>
                              <div>{bucket.count} jobs</div>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    );
                  })}
                </div>

                <Slider
                  className="px-1"
                  min={Number(histogram.min)}
                  max={Number(histogram.max)}
                  step={sliderStep}
                  value={sliderValue}
                  onValueChange={(values) => {
                    if (!Array.isArray(values) || values.length !== 2) {
                      return;
                    }
                    onSelectRange(
                      clampRangeToBounds(
                        { min: Math.min(...values), max: Math.max(...values) },
                        histogram,
                      ),
                    );
                  }}
                />

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-border/60 bg-secondary/10 px-3 py-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Minimum
                    </div>
                    <div className="mt-1 text-sm font-semibold text-foreground">
                      {formatter(Number(effectiveRange?.min ?? histogram.min))}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-secondary/10 px-3 py-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Maximum
                    </div>
                    <div className="mt-1 text-sm font-semibold text-foreground">
                      {formatter(Number(effectiveRange?.max ?? histogram.max))}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      );
    },
    [],
  );

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
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-1">
              <CardTitle>Job Finder</CardTitle>
              <CardDescription>Search across sites to find your best matches</CardDescription>
            </div>
            <div className="flex w-full flex-col gap-3 lg:w-auto lg:min-w-[420px] lg:items-end">
              <div className="grid w-full gap-2 sm:grid-cols-2 lg:w-auto">
                <div className="rounded-xl border border-border/80 bg-card px-4 py-3 text-left">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Searches used
                  </div>
                  <div className="mt-1 text-2xl font-semibold text-foreground">
                    {monetizationMetrics.searchesUsed}
                    <span className="ml-2 text-sm font-medium text-muted-foreground">
                      / {monetizationMetrics.searchLimit}
                    </span>
                  </div>
                </div>
                <div className="rounded-xl border border-border/80 bg-card px-4 py-3 text-left">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Jobs stored
                  </div>
                  <div className="mt-1 text-2xl font-semibold text-foreground">
                    {monetizationMetrics.jobsStored}
                    <span className="ml-2 text-sm font-medium text-muted-foreground">
                      / {monetizationMetrics.jobsLimit}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-0">
            <div className="mb-0 flex justify-end">
              <Tabs
                value={jobsTopTab}
                onValueChange={(value) => {
                  setJobsTopTab(value);
                  if (value === "enabled" || value === "disabled") {
                    setSearchState(value);
                  }
                }}
                className="-mb-px"
              >
                <TabsList className="h-auto gap-0 rounded-t-xl rounded-b-none border border-border/80 border-b-0 bg-transparent p-0">
                  <TabsTrigger
                    value="search"
                    className="rounded-none rounded-tl-xl border-r border-border/80 px-6 py-3 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=inactive]:bg-secondary/20"
                  >
                    Search
                  </TabsTrigger>
                  <TabsTrigger
                    value="enabled"
                    className="rounded-none border-r border-border/80 px-6 py-3 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=inactive]:bg-secondary/20"
                  >
                    <span className="inline-flex items-center gap-2">
                      <span className={cn("h-2.5 w-2.5 rounded-full", toneClassName("ok"))} />
                      Ready ({sourceReadinessRollup.ready})
                    </span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="disabled"
                    className="rounded-none rounded-tr-xl px-6 py-3 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=inactive]:bg-secondary/20"
                  >
                    <span className="inline-flex items-center gap-2">
                      <span className={cn("h-2.5 w-2.5 rounded-full", toneClassName("muted"))} />
                      Disabled ({sourceReadinessRollup.disabled})
                    </span>
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <Card className="rounded-tr-none">
            <CardContent className="space-y-4 pt-6">
              {jobsTopTab === "search" ? (
                <>
              <div className="grid gap-2 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_220px_220px_auto]">
                <label className="block text-sm font-medium text-foreground">
                  Job title
                  <input
                    className={FIELD_CLASSNAME}
                    data-jobs-criteria-title="1"
                    placeholder="Product manager"
                    value={criteriaDraft.title}
                    onChange={(event) =>
                      setCriteriaDraft((current) => ({ ...current, title: event.target.value }))
                    }
                  />
                </label>
                <label className="block text-sm font-medium text-foreground">
                  Location
                  <input
                    className={FIELD_CLASSNAME}
                    data-jobs-criteria-location="1"
                    value={criteriaDraft.location}
                    onChange={(event) =>
                      setCriteriaDraft((current) => ({ ...current, location: event.target.value }))
                    }
                  />
                </label>
                <label className="block text-sm font-medium text-foreground">
                  Minimum salary
                  <input
                    className={FIELD_CLASSNAME}
                    data-jobs-criteria-min-salary="1"
                    inputMode="numeric"
                    placeholder="$XXX,XXX"
                    value={formatSalaryMaskInput(criteriaDraft.minSalary)}
                    onChange={(event) =>
                      setCriteriaDraft((current) => ({
                        ...current,
                        minSalary: formatSalaryMaskInput(event.target.value),
                      }))
                    }
                  />
                </label>
                <label className="block text-sm font-medium text-foreground">
                  Date posted
                  <select
                    className={FIELD_CLASSNAME}
                    data-jobs-criteria-date-posted="1"
                    value={criteriaDraft.datePosted}
                    onChange={(event) =>
                      setCriteriaDraft((current) => ({
                        ...current,
                        datePosted: event.target.value,
                      }))
                    }
                  >
                    <option value="">Not set</option>
                    <option value="any">Any time</option>
                    <option value="1d">Past 24 hours</option>
                    <option value="3d">Past 3 days</option>
                    <option value="1w">Past week</option>
                    <option value="2w">Past 2 weeks</option>
                    <option value="1m">Past month</option>
                  </select>
                </label>
                <div className="flex items-end">
                  <Button
                    className="h-10 w-full"
                    data-jobs-find="1"
                    disabled={jobsControlsDisabled}
                    onClick={() => {
                      void handleFindJobs();
                    }}
                  >
                    {criteriaBusy ? "Running search..." : "Run search"}
                  </Button>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                <div className="rounded-lg border border-border/70 bg-secondary/20 p-4 lg:col-span-2">
                  <Accordion
                    type="single"
                    collapsible
                    value={jobsHardFilterExpanded ? "hard-filter" : ""}
                    onValueChange={(value) => setJobsHardFilterExpanded(value === "hard-filter")}
                  >
                    <AccordionItem value="hard-filter" className="border-none">
                      <div className="flex items-center justify-between gap-3">
                        <TooltipProvider delayDuration={150}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="text-sm font-semibold text-foreground">Hard filter</div>
                            </TooltipTrigger>
                            <TooltipContent className="bg-card">
                              <p>Only jobs with these words will be imported.</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        <AccordionTrigger className="w-auto flex-none py-0 hover:no-underline">
                          <span className="sr-only">Toggle hard filter</span>
                        </AccordionTrigger>
                      </div>
                      {!jobsHardFilterExpanded ? (
                        <div className="mt-3 space-y-2 text-sm">
                          <div>
                            <span className="font-medium text-foreground">Must include: </span>
                            <span className="text-muted-foreground">
                              {criteriaDraft.hardIncludeTerms || "Not set"}
                            </span>
                          </div>
                          <div>
                            <span className="font-medium text-foreground">Must not include: </span>
                            <span className="text-muted-foreground">
                              {criteriaDraft.hardExcludeTerms || "Not set"}
                            </span>
                          </div>
                        </div>
                      ) : null}
                      <AccordionContent className="space-y-4">
                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="block text-sm font-medium text-foreground">
                            Must include
                            <input
                              className={FIELD_CLASSNAME}
                              data-jobs-criteria-hard-include-terms="1"
                              placeholder="ml platform, healthcare"
                              value={criteriaDraft.hardIncludeTerms}
                              onChange={(event) =>
                                setCriteriaDraft((current) => ({
                                  ...current,
                                  hardIncludeTerms: event.target.value,
                                }))
                              }
                            />
                          </label>
                          <label className="block text-sm font-medium text-foreground">
                            Must not include
                            <input
                              className={FIELD_CLASSNAME}
                              data-jobs-criteria-hard-exclude-terms="1"
                              placeholder="intern, contract"
                              value={criteriaDraft.hardExcludeTerms}
                              onChange={(event) =>
                                setCriteriaDraft((current) => ({
                                  ...current,
                                  hardExcludeTerms: event.target.value,
                                }))
                              }
                            />
                          </label>
                        </div>
                        <fieldset
                          className="block text-sm font-medium text-foreground"
                          data-jobs-criteria-hard-include-mode="1"
                        >
                          <legend>Match mode</legend>
                          <div className="mt-2 inline-flex rounded-md border border-input bg-card p-1">
                            <label className="inline-flex cursor-pointer items-center gap-2 rounded-sm px-3 py-1.5 text-sm font-medium text-foreground has-[:checked]:bg-secondary has-[:checked]:text-secondary-foreground">
                              <input
                                type="radio"
                                name="hard-include-mode"
                                value="and"
                                checked={criteriaDraft.hardIncludeMode === "and"}
                                onChange={(event) =>
                                  setCriteriaDraft((current) => ({
                                    ...current,
                                    hardIncludeMode: event.target.value,
                                  }))
                                }
                              />
                              All
                            </label>
                            <label className="inline-flex cursor-pointer items-center gap-2 rounded-sm px-3 py-1.5 text-sm font-medium text-foreground has-[:checked]:bg-secondary has-[:checked]:text-secondary-foreground">
                              <input
                                type="radio"
                                name="hard-include-mode"
                                value="or"
                                checked={criteriaDraft.hardIncludeMode === "or"}
                                onChange={(event) =>
                                  setCriteriaDraft((current) => ({
                                    ...current,
                                    hardIncludeMode: event.target.value,
                                  }))
                                }
                              />
                              Any
                            </label>
                          </div>
                        </fieldset>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </div>

                <div className="rounded-lg border border-border/70 bg-secondary/10 p-4">
                  <Accordion
                    type="single"
                    collapsible
                    value={jobsKeywordExpanded ? "keywords" : ""}
                    onValueChange={(value) => setJobsKeywordExpanded(value === "keywords")}
                  >
                    <AccordionItem value="keywords" className="border-none">
                      <div className="flex items-center justify-between gap-3">
                        <TooltipProvider delayDuration={150}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="text-sm font-semibold text-foreground">Additional keywords</div>
                            </TooltipTrigger>
                            <TooltipContent className="bg-card">
                              <p>Jobs with these keywords will receive higher scores.</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        <AccordionTrigger className="w-auto flex-none py-0 hover:no-underline">
                          <span className="sr-only">Toggle additional keywords</span>
                        </AccordionTrigger>
                      </div>
                      {!jobsKeywordExpanded ? (
                        <div className="mt-3 space-y-2 text-sm">
                          <div>
                            <span className="font-medium text-foreground">Keywords: </span>
                            <span className="text-muted-foreground">
                              {criteriaDraft.additionalKeywords || "Not set"}
                            </span>
                          </div>
                        </div>
                      ) : null}
                      <AccordionContent className="space-y-4">
                        <label className="block text-sm font-medium text-foreground">
                          Keywords
                          <input
                            className={FIELD_CLASSNAME}
                            data-jobs-criteria-additional-keywords="1"
                            placeholder="ai tooling, growth, marketplace"
                            value={criteriaDraft.additionalKeywords}
                            onChange={(event) =>
                              setCriteriaDraft((current) => ({
                                ...current,
                                additionalKeywords: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <fieldset
                          className="block text-sm font-medium text-foreground"
                          data-jobs-criteria-additional-keyword-mode="1"
                        >
                          <legend>Match mode</legend>
                          <div className="mt-2 inline-flex rounded-md border border-input bg-card p-1">
                            <label className="inline-flex cursor-pointer items-center gap-2 rounded-sm px-3 py-1.5 text-sm font-medium text-foreground has-[:checked]:bg-secondary has-[:checked]:text-secondary-foreground">
                              <input
                                type="radio"
                                name="additional-keyword-mode"
                                value="and"
                                checked={criteriaDraft.additionalKeywordMode === "and"}
                                onChange={(event) =>
                                  setCriteriaDraft((current) => ({
                                    ...current,
                                    additionalKeywordMode: event.target.value,
                                  }))
                                }
                              />
                              All
                            </label>
                            <label className="inline-flex cursor-pointer items-center gap-2 rounded-sm px-3 py-1.5 text-sm font-medium text-foreground has-[:checked]:bg-secondary has-[:checked]:text-secondary-foreground">
                              <input
                                type="radio"
                                name="additional-keyword-mode"
                                value="or"
                                checked={criteriaDraft.additionalKeywordMode === "or"}
                                onChange={(event) =>
                                  setCriteriaDraft((current) => ({
                                    ...current,
                                    additionalKeywordMode: event.target.value,
                                  }))
                                }
                              />
                              Any
                            </label>
                          </div>
                        </fieldset>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </div>
              </div>
                </>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1">
                      <div className="text-base font-semibold text-foreground">Sources</div>
                      <div className="text-sm text-muted-foreground">
                        Manage enabled sources, authentication checks, and per-source refresh actions.
                      </div>
                    </div>
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
                        const primaryAction = presentSearchPrimaryAction(row, { controlsDisabled });
                        const overflowActions = buildSearchOverflowActions(row);
                        const actionsMenuOpen = openSourceActionsMenuId === row.id;

                        return (
                          <TableRow key={row.id} className={cn(!row.enabled && "bg-secondary/20")}>
                            <TableCell>
                              <div className="space-y-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-semibold text-foreground">{row.label}</span>
                                  {row.searchUrl ? (
                                    <a
                                      href={row.searchUrl}
                                      target="_blank"
                                      rel="noreferrer noopener"
                                      className="text-sm text-muted-foreground hover:text-foreground"
                                    >
                                      ↗
                                    </a>
                                  ) : null}
                                </div>
                                <div className="text-xs text-muted-foreground">{row.id}</div>
                              </div>
                            </TableCell>
                            <TableCell>{formatRelativeTimestamp(row.capturedAt) || "Never"}</TableCell>
                            <TableCell>
                              <div className="flex items-start gap-2">
                                <span className="inline-flex items-center gap-2 rounded-full bg-secondary/40 px-3 py-1 text-sm font-semibold text-foreground">
                                  <span className={cn("h-2.5 w-2.5 rounded-full", toneClassName(row.readiness?.tone))} />
                                  {statusPresentation.label}
                                </span>
                                {hasStatusDetails ? (
                                  <TooltipProvider delayDuration={150}>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <button
                                          type="button"
                                          className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border text-sm font-semibold text-muted-foreground hover:text-foreground"
                                          aria-label="Show status details"
                                        >
                                          i
                                        </button>
                                      </TooltipTrigger>
                                      <TooltipContent className="max-w-sm bg-card text-left">
                                        <div className="space-y-1">
                                          {statusPresentation.statusDetail ? (
                                            <div>{statusPresentation.statusDetail}</div>
                                          ) : null}
                                          {statusPresentation.formatterDetail ? (
                                            <div>{statusPresentation.formatterDetail}</div>
                                          ) : null}
                                        </div>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                ) : null}
                              </div>
                            </TableCell>
                            <TableCell>{statusPresentation.foundLabel}</TableCell>
                            <TableCell>{formatSearchMetricValue(row.filteredCount)}</TableCell>
                            <TableCell>{formatSearchMetricValue(row.dedupedCount)}</TableCell>
                            <TableCell>{row.importedCount}</TableCell>
                            <TableCell>{row.avgScore === null ? "n/a" : row.avgScore}</TableCell>
                            <TableCell className="align-middle pr-1">
                              <Button
                                size="sm"
                                variant={
                                  primaryAction.kind === "run_now" && primaryAction.disabled
                                    ? "secondary"
                                    : "default"
                                }
                                className="min-w-[140px] justify-center"
                                disabled={primaryAction.disabled}
                                onClick={() => {
                                  if (primaryAction.kind === "enable") {
                                    void handleEnableSource(row.id, row.label);
                                    return;
                                  }
                                  if (primaryAction.kind === "sign_in") {
                                    handleStartAuthFlow(row.id);
                                    return;
                                  }
                                  void handleRunSourceNow(row.id);
                                }}
                              >
                                {primaryAction.label}
                              </Button>
                            </TableCell>
                            <TableCell className="align-middle pl-1 pr-2">
                              {overflowActions.length > 0 ? (
                                <div
                                  className="relative flex justify-end"
                                  data-source-actions-menu-root="1"
                                >
                                  <Button
                                    variant="outline"
                                    size="icon"
                                    className="h-11 w-11"
                                    disabled={controlsDisabled}
                                    aria-haspopup="menu"
                                    aria-expanded={actionsMenuOpen}
                                    onClick={() => {
                                      setOpenSourceActionsMenuId((current) =>
                                        current === row.id ? "" : row.id,
                                      );
                                    }}
                                  >
                                    …
                                  </Button>
                                  {actionsMenuOpen ? (
                                    <div
                                      className="absolute right-0 top-full z-20 mt-2 min-w-[9rem] rounded-md border border-border bg-card p-1 shadow-panel"
                                      role="menu"
                                    >
                                      {overflowActions.map((action) => (
                                        <button
                                          key={action.kind}
                                          type="button"
                                          role="menuitem"
                                          className="flex w-full items-center rounded-sm px-3 py-2 text-sm text-foreground hover:bg-secondary/60"
                                          onClick={() => {
                                            setOpenSourceActionsMenuId("");
                                            if (action.kind === "disable") {
                                              void handleDisableSource(row.id, row.label);
                                            }
                                          }}
                                        >
                                          {action.label}
                                        </button>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      <TableRow className="bg-secondary/20">
                        <TableCell className="font-semibold">{totals.stateLabel}</TableCell>
                        <TableCell>—</TableCell>
                        <TableCell>—</TableCell>
                        <TableCell>{totals.foundLabel}</TableCell>
                        <TableCell>{formatSearchMetricValue(totals.filtered)}</TableCell>
                        <TableCell>{formatSearchMetricValue(totals.deduped)}</TableCell>
                        <TableCell>{totals.imported}</TableCell>
                        <TableCell>{totals.avgScore}</TableCell>
                        <TableCell>—</TableCell>
                        <TableCell>—</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
            </Card>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:flex-nowrap lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2 lg:min-w-0 lg:flex-nowrap lg:items-center">
              <Select value={jobsDatasetValue} onValueChange={setJobsView}>
                <SelectTrigger
                  className={cn(
                    "h-9 w-auto min-w-0 max-w-fit rounded-md px-4 text-sm font-medium shadow-none",
                    !jobsAlternateDatasetActive && jobsView === "all"
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input bg-card text-foreground",
                  )}
                  aria-label="Jobs dataset view"
                >
                  <SelectValue>{jobsDatasetLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {jobsDatasetOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label} ({option.count})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!jobsAlternateDatasetActive ? (
                <>
                  <Button
                    size="sm"
                    variant={jobsView === "new" ? "default" : "outline"}
                    data-jobs-view="new"
                    disabled={jobsControlsDisabled}
                    onClick={() => setJobsView("new")}
                  >
                    New ({jobsViewCounts.new})
                  </Button>
                  <Button
                    size="sm"
                    variant={jobsView === "best_match" ? "default" : "outline"}
                    data-jobs-view="best_match"
                    disabled={jobsControlsDisabled}
                    onClick={() => setJobsView("best_match")}
                    >
                      Best match ({jobsViewCounts.best_match})
                    </Button>
                  </>
                ) : null}
            </div>
            <div className="min-w-0 lg:flex-1">
              <div className="flex flex-wrap items-center justify-end gap-2 lg:flex-nowrap">
                {jobsFiltersExpanded ? (
                  <>
                    <select
                      className="h-9 min-w-[140px] rounded-md border border-input bg-card px-3 text-sm font-medium text-foreground shadow-none outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
                      value={jobsSourceFilter}
                      onChange={(event) => setJobsSourceFilter(event.target.value)}
                    >
                      <option value="all">Source</option>
                      {jobSourceFilters.map((filter) => (
                        <option key={filter.kind} value={filter.kind}>
                          {filter.label} ({filter.count})
                        </option>
                      ))}
                    </select>
                    <select
                      className="h-9 min-w-[150px] rounded-md border border-input bg-card px-3 text-sm font-medium text-foreground shadow-none outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
                      value={jobsPostedFilter}
                      onChange={(event) => setJobsPostedFilter(event.target.value)}
                    >
                      <option value="all">Posted</option>
                      {jobPostedFilters
                        .filter((filter) => filter.value !== "all")
                        .map((filter) => (
                          <option key={filter.value} value={filter.value}>
                            {filter.label} ({filter.count})
                          </option>
                        ))}
                    </select>
                    <select
                      className="h-9 min-w-[150px] rounded-md border border-input bg-card px-3 text-sm font-medium text-foreground shadow-none outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
                      value={jobsSalaryPresenceFilter}
                      onChange={(event) => setJobsSalaryPresenceFilter(event.target.value)}
                    >
                      <option value="all">Salary</option>
                      <option value="has_salary">Has salary ({jobsWithSalaryCount})</option>
                      <option value="missing_salary">Missing salary ({jobsMissingSalaryCount})</option>
                    </select>
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-9 w-9 shrink-0 rounded-full"
                      aria-label="Close filters"
                      onClick={() => setJobsFiltersExpanded(false)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 gap-2 font-semibold"
                    onClick={() => setJobsFiltersExpanded(true)}
                  >
                    Filters
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>

          {activeFilterChips.length > 0 ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="shrink-0 text-sm font-medium text-muted-foreground">Filters applied</span>
              {activeFilterChips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  className="shrink-0 rounded-full border border-border/80 bg-secondary/30 px-3 py-1 text-xs font-medium text-foreground hover:bg-secondary/40"
                  onClick={() => {
                    if (chip.key === "source") {
                      setJobsSourceFilter("all");
                    } else if (chip.key === "posted") {
                      setJobsPostedFilter("all");
                    } else if (chip.key === "salary-range") {
                      setJobsSalaryRangeFilter(null);
                    } else if (chip.key === "salary-presence") {
                      setJobsSalaryPresenceFilter("all");
                    } else if (chip.key === "widget-keyword") {
                      setJobsWidgetKeywordFilter("");
                    } else if (chip.key === "widget-title") {
                      setJobsWidgetTitleFilter("");
                    }
                  }}
                >
                  {chip.label} ×
                </button>
              ))}
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                onClick={() => {
                  setJobsSourceFilter("all");
                  setJobsPostedFilter("all");
                  setJobsSalaryPresenceFilter("all");
                  setJobsSalaryRangeFilter(null);
                  setJobsWidgetKeywordFilter("");
                  setJobsWidgetTitleFilter("");
                }}
              >
                Clear all
              </Button>
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,1.15fr)_minmax(0,1.15fr)]">
            <div className="space-y-4">
              <Card className="min-h-[172px]">
                <CardContent className="flex h-full flex-col justify-between pt-6">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Total jobs</div>
                  <div className="text-5xl font-semibold text-foreground">{sortedJobs.length}</div>
                </CardContent>
              </Card>
              <Card className="min-h-[172px]">
                <CardContent className="flex h-full flex-col justify-between pt-6">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Avg score</div>
                  <div className="text-5xl font-semibold text-foreground">
                    {jobsAverageScore === null ? "—" : Math.round(jobsAverageScore)}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="min-h-[360px]">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Keywords</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="max-h-[280px] space-y-3 overflow-y-auto pr-1">
                  {(jobsKeywordWidgets.length > 0 ? jobsKeywordWidgets : [
                    { key: "kw-1", term: "", label: "KW#1", value: 0 },
                    { key: "kw-2", term: "", label: "KW#2", value: 0 },
                    { key: "kw-3", term: "", label: "KW#3", value: 0 },
                  ]).map((widget) => (
                    <button
                      key={widget.key}
                      type="button"
                      className={cn(
                        "block w-full rounded-lg border border-border/70 px-3 py-3 text-left",
                        widget.term && jobsWidgetKeywordFilter === widget.term
                          ? "bg-secondary/40"
                          : "hover:bg-secondary/20",
                      )}
                      disabled={!widget.term}
                      onClick={() =>
                        setJobsWidgetKeywordFilter((current) => (current === widget.term ? "" : widget.term))
                      }
                    >
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {widget.label}
                      </div>
                      <div className="mt-1 text-2xl font-semibold text-foreground">{widget.value}</div>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="min-h-[360px]">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Titles</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {jobsTitleBreakdown.length > 0 ? (
                  jobsTitleBreakdown.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      className={cn(
                        "flex w-full items-center justify-between gap-3 rounded-lg border border-transparent px-3 py-2 text-left hover:bg-secondary/20",
                        jobsWidgetTitleFilter === item.label ? "bg-secondary/40" : "",
                      )}
                      onClick={() =>
                        setJobsWidgetTitleFilter((current) => (current === item.label ? "" : item.label))
                      }
                    >
                      <span className="truncate text-foreground">{item.label}</span>
                      <span className="font-semibold text-muted-foreground">{item.count}</span>
                    </button>
                  ))
                ) : (
                  <div className="text-muted-foreground">No title data</div>
                )}
              </CardContent>
            </Card>

            <Card className="min-h-[360px]">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Salary ({jobsWithSalaryCount})</CardTitle>
              </CardHeader>
              <CardContent>
                {renderRangeHistogramFilter({
                  title: null,
                  histogram: jobsSalaryHistogram,
                  selectedRange: jobsSalaryRangeFilter,
                  onSelectRange: setJobsSalaryRangeFilter,
                  formatter: formatCurrency,
                  sliderStep: 1000,
                })}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-base">Results</CardTitle>
                    <div className="text-sm text-muted-foreground">
                      {sortedJobs.length === 0 ? "0" : (currentPage - 1) * JOBS_PAGE_SIZE + 1}-
                      {Math.min(currentPage * JOBS_PAGE_SIZE, sortedJobs.length)} / {sortedJobs.length}
                    </div>
                  </div>
                  <div className="flex min-w-[220px] items-center justify-end gap-2">
                    <span className="text-sm font-medium text-muted-foreground">Sort by</span>
                    <select
                      className="h-10 min-w-[180px] rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
                      value={jobsSort}
                      onChange={(event) => setJobsSort(event.target.value)}
                    >
                      <option value="score">Score</option>
                      <option value="date">Date posted</option>
                      <option value="salary">Salary</option>
                    </select>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {pagedJobs.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border bg-secondary/20 p-4 text-sm text-muted-foreground">
                    No jobs match the current filters.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {pagedJobs.map((job) => {
                      const isSelected = currentJob?.id === job.id;
                      return (
                        <button
                          key={job.id}
                          type="button"
                          data-job-row={job.id}
                          className={cn(
                            "w-full rounded-xl border border-border/70 px-4 py-4 text-left transition",
                            isSelected ? "bg-secondary/35" : "hover:bg-secondary/15",
                          )}
                          onClick={() => setSelectedJobId(job.id)}
                        >
                          <div className="space-y-3">
                            <div className="space-y-2">
                              <div className="text-lg font-semibold text-foreground">{job.title}</div>
                              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                                <span>{job.company || "Unknown company"}</span>
                                <span>•</span>
                                <span>{job.location || "Unknown location"}</span>
                                <span className="rounded-full bg-secondary px-2 py-1 text-[11px] font-semibold text-secondary-foreground">
                                  {formatJobStatus(job.status)}
                                </span>
                              </div>
                            </div>
                            <div className="grid gap-3 text-sm sm:grid-cols-3">
                              <div>
                                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Salary</div>
                                <div className="mt-1 font-medium text-foreground">{job.salaryText || "—"}</div>
                              </div>
                              <div>
                                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Date posted</div>
                                <div className="mt-1 font-medium text-foreground">{formatJobFreshness(job)}</div>
                              </div>
                              <div>
                                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Score</div>
                                <div className="mt-1 font-medium text-foreground">
                                  {Number.isFinite(Number(job.score)) ? Math.round(Number(job.score)) : "n/a"}
                                </div>
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="flex items-center justify-between gap-2">
                  <Button
                    variant="outline"
                    data-jobs-page="prev"
                    disabled={jobsControlsDisabled || currentPage <= 1}
                    onClick={() => setJobsPage((current) => Math.max(1, current - 1))}
                  >
                    Prev
                  </Button>
                  <div className="text-sm text-muted-foreground">
                    Page {currentPage} / {totalJobsPages}
                  </div>
                  <Button
                    variant="outline"
                    data-jobs-page="next"
                    disabled={jobsControlsDisabled || currentPage >= totalJobsPages}
                    onClick={() => setJobsPage((current) => Math.min(totalJobsPages, current + 1))}
                  >
                    Next
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">Job detail</CardTitle>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={jobsControlsDisabled || currentJobPosition.index <= 0}
                      onClick={() => moveSelection(-1)}
                    >
                      ←
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={
                        jobsControlsDisabled ||
                        currentJobPosition.index < 0 ||
                        currentJobPosition.index >= currentJobPosition.total - 1
                      }
                      onClick={() => moveSelection(1)}
                    >
                      →
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {currentJob ? (
                  <>
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <div className="text-2xl font-semibold text-foreground">{currentJob.title}</div>
                          <div className="text-sm text-muted-foreground">
                            {currentJob.company || "Unknown company"} · {currentJob.location || "Unknown location"}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <span className="rounded-full bg-secondary px-2 py-1">
                            Status: {formatJobStatus(currentJob.status)}
                          </span>
                          {currentJob.bucket === "high_signal" ? (
                            <span className="rounded-full bg-secondary px-2 py-1">best match</span>
                          ) : null}
                          {currentJobSourceAttributions.length > 0
                            ? currentJobSourceAttributions.map((source) => (
                                <span key={source.id} className="rounded-full border border-border/70 px-2 py-1">
                                  {source.name}
                                </span>
                              ))
                            : (
                              <span className="rounded-full border border-border/70 px-2 py-1">Unknown source</span>
                            )}
                        </div>
                      </div>
                      <Button
                        data-job-open="1"
                        className="min-w-[152px] self-start"
                        disabled={jobsControlsDisabled || !currentJob.reviewTarget?.url}
                        onClick={() => {
                          void handleOpenCurrentJob();
                        }}
                      >
                        {currentJob.reviewTarget?.mode === "search" ? "Open Search" : "View Job"}
                      </Button>
                    </div>

                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="rounded-lg border border-border/70 bg-card px-4 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Date posted</div>
                        <div className="mt-1 text-base font-semibold text-foreground">{formatJobFreshness(currentJob)}</div>
                      </div>
                      <div className="rounded-lg border border-border/70 bg-card px-4 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Salary</div>
                        <div className="mt-1 text-base font-semibold text-foreground">{currentJob.salaryText || "Unknown"}</div>
                      </div>
                      <div className="rounded-lg border border-border/70 bg-card px-4 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Score</div>
                        <div className="mt-1 text-base font-semibold text-foreground">
                          {Number.isFinite(Number(currentJob.score)) ? Math.round(Number(currentJob.score)) : "n/a"}
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-3">
                      <Button
                        variant="outline"
                        data-job-status="rejected"
                        disabled={jobsControlsDisabled}
                        onClick={() =>
                          setRejectDialog({
                            open: true,
                            jobId: currentJob.id,
                            reason: currentJob.status === "rejected" ? currentJob.notes || "" : "",
                            saving: false,
                          })
                        }
                      >
                        Reject
                      </Button>
                      <Button
                        variant="outline"
                        data-job-status="skip_for_now"
                        disabled={jobsControlsDisabled}
                        onClick={() => {
                          void executeJobStatusUpdate(currentJob, "skip_for_now");
                        }}
                      >
                        Skip
                      </Button>
                      <Button
                        variant="outline"
                        data-job-status="applied"
                        disabled={jobsControlsDisabled}
                        onClick={() => {
                          void executeJobStatusUpdate(currentJob, "applied");
                        }}
                      >
                        I Applied
                      </Button>
                    </div>

                    {currentJob.status === "rejected" && currentJob.notes ? (
                      <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-4">
                        <div className="text-sm font-semibold text-destructive">Rejected notes</div>
                        <div className="mt-2 text-sm text-foreground">{currentJob.notes}</div>
                      </div>
                    ) : null}

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="rounded-lg border border-border/70 bg-card p-4">
                        <div className="text-sm font-semibold text-foreground">Keyword match</div>
                        <dl className="mt-3 space-y-2 text-sm">
                          <div className="flex items-center justify-between gap-4">
                            <dt className="text-muted-foreground">Hard filter</dt>
                            <dd className="text-right text-foreground">
                              {criteriaDraft.hardIncludeTerms || "Not set"}
                            </dd>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <dt className="text-muted-foreground">Exclude</dt>
                            <dd className="text-right text-foreground">
                              {criteriaDraft.hardExcludeTerms || "Not set"}
                            </dd>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <dt className="text-muted-foreground">Keywords</dt>
                            <dd className="text-right text-foreground">
                              {criteriaDraft.additionalKeywords || "Not set"}
                            </dd>
                          </div>
                        </dl>
                      </div>
                      <div className="rounded-lg border border-border/70 bg-card p-4">
                        <div className="text-sm font-semibold text-foreground">Optional fields</div>
                        <dl className="mt-3 grid gap-2 text-sm">
                          <div className="flex items-center justify-between gap-4">
                            <dt className="text-muted-foreground">Employment type</dt>
                            <dd className="text-right text-foreground">
                              {currentJob.employmentType || "Unknown"}
                            </dd>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <dt className="text-muted-foreground">Confidence</dt>
                            <dd className="text-right text-foreground">
                              {Number.isFinite(Number(currentJob.confidence))
                                ? Math.round(Number(currentJob.confidence))
                                : "n/a"}
                            </dd>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <dt className="text-muted-foreground">Duplicate sources</dt>
                            <dd className="text-right text-foreground">{currentJob.duplicateCount || 1}</dd>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <dt className="text-muted-foreground">Source type</dt>
                            <dd className="text-right text-foreground">{currentJobSourceKinds}</dd>
                          </div>
                        </dl>
                      </div>
                    </div>

                    <div className="rounded-lg border border-border/70 bg-secondary/20 p-4">
                      <div className="text-sm font-semibold text-foreground">Job description</div>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {currentJob.summary || "No summary available."}
                      </p>
                      <ul className="mt-3 space-y-1 text-sm text-foreground">
                        {(Array.isArray(currentJob.reasons) ? currentJob.reasons : []).length > 0 ? (
                          currentJob.reasons.map((reason) => <li key={reason}>• {reason}</li>)
                        ) : (
                          <li>• No extracted description notes yet.</li>
                        )}
                      </ul>
                    </div>
                  </>
                ) : (
                  <div className="rounded-lg border border-dashed border-border bg-secondary/20 p-6 text-sm text-muted-foreground">
                    No jobs are available for the current filter.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </CardContent>
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

      <Dialog
        open={rejectDialog.open}
        onOpenChange={(open) => {
          if (rejectDialog.saving) {
            return;
          }
          setRejectDialog((current) =>
            open
              ? current
              : {
                  open: false,
                  jobId: null,
                  reason: "",
                  saving: false,
                },
          );
        }}
      >
        <DialogContent data-jobs-reject-dialog="1">
          <DialogHeader>
            <DialogTitle>Reject this job</DialogTitle>
            <DialogDescription>
              Add a short reason so the rejection is recorded with context.
            </DialogDescription>
          </DialogHeader>
          <label className="mt-4 block text-sm font-medium text-foreground">
            Reason
            <textarea
              className={cn(FIELD_CLASSNAME, "min-h-28 resize-y")}
              data-jobs-reject-reason="1"
              placeholder="Example: compensation below target, location mismatch, or role scope is off."
              value={rejectDialog.reason}
              onChange={(event) =>
                setRejectDialog((current) => ({
                  ...current,
                  reason: event.target.value,
                }))
              }
            />
          </label>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={rejectDialog.saving}
              onClick={() =>
                setRejectDialog({
                  open: false,
                  jobId: null,
                  reason: "",
                  saving: false,
                })
              }
            >
              Cancel
            </Button>
            <Button
              data-jobs-reject-submit="1"
              disabled={rejectDialog.saving}
              onClick={() => {
                void handleRejectSubmit();
              }}
            >
              {rejectDialog.saving ? "Saving..." : "Reject job"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Toaster />
    </main>
  );
}
