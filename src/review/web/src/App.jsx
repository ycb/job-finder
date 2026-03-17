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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToastAction } from "@/components/ui/toast";
import { Toaster } from "@/components/ui/toaster";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
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

function countKeywordHits(jobs, term) {
  if (!term) {
    return 0;
  }
  const normalized = term.toLowerCase();
  return (Array.isArray(jobs) ? jobs : []).reduce((count, job) => {
    const haystack = [
      job?.title,
      job?.summary,
      Array.isArray(job?.reasons) ? job.reasons.join(" ") : "",
      job?.location,
      job?.company,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
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
      aboveAvgCount: 0,
      withSalaryCount: 0,
    };
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  const avg = total / values.length;
  return {
    min: values[0],
    avg,
    max: values[values.length - 1],
    aboveAvgCount: values.filter((value) => value > avg).length,
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
  const [jobsSort, setJobsSort] = useState("score");
  const [jobsSourceFilter, setJobsSourceFilter] = useState("all");
  const [jobsEmploymentFilter, setJobsEmploymentFilter] = useState("all");
  const [jobsPostedFilter, setJobsPostedFilter] = useState("all");
  const [jobsSalaryFloorFilter, setJobsSalaryFloorFilter] = useState("");
  const [jobsSalaryCeilingFilter, setJobsSalaryCeilingFilter] = useState("");
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
  const [searchesDialogOpen, setSearchesDialogOpen] = useState(false);
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
      mainTab: searchesDialogOpen ? "searches" : "jobs",
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
  }, [consentGateRequired, dashboard, searchesDialogOpen, searchState, toast, welcomeToastScope]);

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
      { value: "applied", label: "Applied", count: jobsViewCounts.applied },
      { value: "skipped", label: "Skipped", count: jobsViewCounts.skipped },
      { value: "rejected", label: "Rejected", count: jobsViewCounts.rejected },
    ],
    [jobsViewCounts],
  );
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
  const jobEmploymentFilters = useMemo(() => {
    const counts = new Map();
    for (const job of jobsAllInSelectedView) {
      const key = String(job?.employmentType || "unknown")
        .trim()
        .toLowerCase() || "unknown";
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const normalized = [...counts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([value, count]) => ({
        value,
        count,
        label: value === "unknown" ? "Unknown" : value.replaceAll("_", " "),
      }));
    return [{ value: "all", count: jobsAllInSelectedView.length, label: "All" }, ...normalized];
  }, [jobsAllInSelectedView]);
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
  const filteredJobs = useMemo(() => {
    const salaryFloor = Number(String(jobsSalaryFloorFilter || "").replace(/[^0-9]/g, ""));
    const salaryCeiling = Number(String(jobsSalaryCeilingFilter || "").replace(/[^0-9]/g, ""));
    const hasSalaryFloor = Number.isFinite(salaryFloor) && salaryFloor > 0;
    const hasSalaryCeiling = Number.isFinite(salaryCeiling) && salaryCeiling > 0;

    return jobsAllInSelectedView.filter((job) => {
      if (
        jobsSourceFilter !== "all" &&
        !(Array.isArray(job?.sourceIds) ? job.sourceIds : []).some(
          (sourceId) => sourceKindBySourceId.get(sourceId) === jobsSourceFilter,
        )
      ) {
        return false;
      }

      if (jobsEmploymentFilter !== "all") {
        const employment = String(job?.employmentType || "unknown")
          .trim()
          .toLowerCase();
        if (employment !== jobsEmploymentFilter) {
          return false;
        }
      }

      if (!matchesPostedWindow(job, jobsPostedFilter)) {
        return false;
      }

      const salaryValue = parseSalaryValue(job?.salaryText);
      if (hasSalaryFloor && salaryValue > 0 && salaryValue < salaryFloor) {
        return false;
      }
      if (hasSalaryCeiling && salaryValue > 0 && salaryValue > salaryCeiling) {
        return false;
      }

      return true;
    });
  }, [
    jobsAllInSelectedView,
    jobsSourceFilter,
    sourceKindBySourceId,
    jobsEmploymentFilter,
    jobsPostedFilter,
    jobsSalaryFloorFilter,
    jobsSalaryCeilingFilter,
  ]);
  const sortedJobs = useMemo(() => rankJobs(filteredJobs, jobsSort), [filteredJobs, jobsSort]);
  const jobsKeywordWidgets = useMemo(() => {
    const terms = parseTerms(criteriaDraft.additionalKeywords).slice(0, 3);
    while (terms.length < 3) {
      terms.push("");
    }
    return terms.map((term, index) => ({
      key: term || `kw-${index + 1}`,
      label: term ? term.toUpperCase() : `KW#${index + 1}`,
      value: term ? countKeywordHits(filteredJobs, term) : 0,
    }));
  }, [criteriaDraft.additionalKeywords, filteredJobs]);
  const jobsTitleBreakdown = useMemo(() => computeTitleBreakdown(filteredJobs, 5), [filteredJobs]);
  const jobsSalarySummary = useMemo(() => computeSalarySummary(filteredJobs), [filteredJobs]);
  const jobsAverageScore = useMemo(() => {
    const scores = filteredJobs
      .map((job) => Number(job?.score))
      .filter((score) => Number.isFinite(score) && score >= 0);
    if (scores.length === 0) {
      return null;
    }
    return scores.reduce((sum, score) => sum + score, 0) / scores.length;
  }, [filteredJobs]);
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
    setJobsPage(1);
    setSelectedJobId(sortedJobs[0]?.id || null);
  }, [
    jobsSourceFilter,
    jobsSort,
    jobsView,
    jobsEmploymentFilter,
    jobsPostedFilter,
    jobsSalaryFloorFilter,
    jobsSalaryCeilingFilter,
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
            <div className="w-full lg:w-auto">
              <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                <h3 className="text-sm font-semibold text-foreground">Job sources</h3>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-auto w-full justify-start px-3 py-2 sm:w-auto"
                  data-jobs-open-searches="1"
                  onClick={() => setSearchesDialogOpen(true)}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-1 text-xs font-semibold text-secondary-foreground">
                      <span className="h-2 w-2 rounded-full bg-emerald-600" aria-hidden="true" />
                      Ready ({sourceReadinessRollup.ready})
                    </span>
                    {sourceReadinessRollup.actionNeeded > 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-1 text-xs font-semibold text-secondary-foreground">
                        <span className="h-2 w-2 rounded-full bg-amber-600" aria-hidden="true" />
                        Action needed ({sourceReadinessRollup.actionNeeded})
                      </span>
                    ) : null}
                    {sourceReadinessRollup.disabled > 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted px-2 py-1 text-xs font-semibold text-muted-foreground">
                        <span className="h-2 w-2 rounded-full bg-muted-foreground/80" aria-hidden="true" />
                        Disabled ({sourceReadinessRollup.disabled})
                      </span>
                    ) : null}
                  </span>
                </Button>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Card>
            <CardContent className="pt-6">
              <div className="grid gap-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_220px_220px_auto]">
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
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-border/70 bg-secondary/20 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                <span>Hard filter</span>
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border text-[11px] font-semibold text-muted-foreground"
                        aria-label="Hard filter info"
                        onClick={() =>
                          toast({
                            title: "Hard filter",
                            description: "Only jobs with these words will be imported.",
                          })
                        }
                      >
                        i
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Only jobs with these words will be imported.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
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
              </div>
              <div className="mt-3">
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
            </div>

            <div className="rounded-lg border border-border/70 bg-secondary/10 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                <span>Additional keywords</span>
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border text-[11px] font-semibold text-muted-foreground"
                        aria-label="Additional keywords info"
                        onClick={() =>
                          toast({
                            title: "Additional keywords",
                            description: "Jobs with these keywords will receive higher scores.",
                          })
                        }
                      >
                        i
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Jobs with these keywords will receive higher scores.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
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
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {jobsViewTabs.map((tab) => (
              <Button
                key={tab.value}
                size="sm"
                variant={jobsView === tab.value ? "default" : "outline"}
                data-jobs-view={tab.value}
                disabled={jobsControlsDisabled}
                onClick={() => setJobsView(tab.value)}
              >
                {tab.label} ({tab.count})
              </Button>
            ))}
          </div>

          <Card>
            <CardContent className="pt-5">
              <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_220px_220px_220px_220px]">
                <label className="block text-sm font-medium text-foreground">
                  Source
                  <select
                    className={FIELD_CLASSNAME}
                    value={jobsSourceFilter}
                    onChange={(event) => setJobsSourceFilter(event.target.value)}
                  >
                    <option value="all">All ({jobsAllInSelectedView.length})</option>
                    {jobSourceFilters.map((filter) => (
                      <option key={filter.kind} value={filter.kind}>
                        {filter.label} ({filter.count})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm font-medium text-foreground">
                  Employment type
                  <select
                    className={FIELD_CLASSNAME}
                    value={jobsEmploymentFilter}
                    onChange={(event) => setJobsEmploymentFilter(event.target.value)}
                  >
                    {jobEmploymentFilters.map((filter) => (
                      <option key={filter.value} value={filter.value}>
                        {filter.label} ({filter.count})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm font-medium text-foreground">
                  Posted
                  <select
                    className={FIELD_CLASSNAME}
                    value={jobsPostedFilter}
                    onChange={(event) => setJobsPostedFilter(event.target.value)}
                  >
                    {jobPostedFilters.map((filter) => (
                      <option key={filter.value} value={filter.value}>
                        {filter.label} ({filter.count})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm font-medium text-foreground">
                  Sort
                  <select
                    className={FIELD_CLASSNAME}
                    value={jobsSort}
                    onChange={(event) => setJobsSort(event.target.value)}
                  >
                    <option value="score">Score</option>
                    <option value="date">Date posted</option>
                    <option value="salary">Salary</option>
                  </select>
                </label>
                <label className="block text-sm font-medium text-foreground">
                  Min salary
                  <input
                    className={FIELD_CLASSNAME}
                    inputMode="numeric"
                    placeholder="$120,000"
                    value={formatSalaryMaskInput(jobsSalaryFloorFilter)}
                    onChange={(event) => setJobsSalaryFloorFilter(formatSalaryMaskInput(event.target.value))}
                  />
                </label>
                <label className="block text-sm font-medium text-foreground">
                  Max salary
                  <input
                    className={FIELD_CLASSNAME}
                    inputMode="numeric"
                    placeholder="$350,000"
                    value={formatSalaryMaskInput(jobsSalaryCeilingFilter)}
                    onChange={(event) => setJobsSalaryCeilingFilter(formatSalaryMaskInput(event.target.value))}
                  />
                </label>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-3 xl:grid-cols-[180px_180px_repeat(3,minmax(0,1fr))_minmax(0,1.3fr)_minmax(0,1.1fr)]">
            <Card>
              <CardContent className="space-y-1 pt-6">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Total jobs</div>
                <div className="text-3xl font-semibold text-foreground">{sortedJobs.length}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-1 pt-6">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Avg score</div>
                <div className="text-3xl font-semibold text-foreground">
                  {jobsAverageScore === null ? "—" : Math.round(jobsAverageScore)}
                </div>
              </CardContent>
            </Card>
            {jobsKeywordWidgets.map((widget) => (
              <Card key={widget.key}>
                <CardContent className="space-y-1 pt-6">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {widget.label}
                  </div>
                  <div className="text-3xl font-semibold text-foreground">{widget.value}</div>
                </CardContent>
              </Card>
            ))}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Titles</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                {jobsTitleBreakdown.length > 0 ? (
                  jobsTitleBreakdown.map((item) => (
                    <div key={item.label} className="flex items-center justify-between gap-2">
                      <span className="truncate text-muted-foreground">{item.label}</span>
                      <span className="font-semibold text-foreground">{item.count}</span>
                    </div>
                  ))
                ) : (
                  <div className="text-muted-foreground">No title data</div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Salaries</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Min</span>
                  <span className="font-semibold text-foreground">{formatCurrency(jobsSalarySummary.min)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Avg</span>
                  <span className="font-semibold text-foreground">{formatCurrency(jobsSalarySummary.avg)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Above avg</span>
                  <span className="font-semibold text-foreground">{jobsSalarySummary.aboveAvgCount}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Highest</span>
                  <span className="font-semibold text-foreground">{formatCurrency(jobsSalarySummary.max)}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base">Results</CardTitle>
                  <div className="text-sm text-muted-foreground">
                    {sortedJobs.length === 0 ? "0" : (currentPage - 1) * JOBS_PAGE_SIZE + 1}-
                    {Math.min(currentPage * JOBS_PAGE_SIZE, sortedJobs.length)} / {sortedJobs.length}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {pagedJobs.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border bg-secondary/20 p-4 text-sm text-muted-foreground">
                    No jobs match the current filters.
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-border/70">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Title</TableHead>
                          <TableHead>Salary</TableHead>
                          <TableHead>Date posted</TableHead>
                          <TableHead>Score</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pagedJobs.map((job) => {
                          const isSelected = currentJob?.id === job.id;
                          return (
                            <TableRow
                              key={job.id}
                              data-job-row={job.id}
                              className={cn(
                                "cursor-pointer",
                                isSelected ? "bg-secondary/40" : "hover:bg-secondary/20",
                              )}
                              onClick={() => setSelectedJobId(job.id)}
                            >
                              <TableCell>
                                <div className="font-medium text-foreground">{job.title}</div>
                                <div className="text-xs text-muted-foreground">
                                  {job.company || "Unknown company"} · {job.location || "Unknown location"}
                                </div>
                                <div className="mt-1 flex flex-wrap gap-1">
                                  <span className="rounded bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground">
                                    {formatJobStatus(job.status)}
                                  </span>
                                  {job.bucket === "high_signal" ? (
                                    <span className="rounded bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground">
                                      best match
                                    </span>
                                  ) : null}
                                </div>
                              </TableCell>
                              <TableCell>{job.salaryText || "—"}</TableCell>
                              <TableCell>{formatJobFreshness(job)}</TableCell>
                              <TableCell>
                                {Number.isFinite(Number(job.score)) ? Math.round(Number(job.score)) : "n/a"}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
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
                    <CardDescription>
                      Job {currentJobPosition.index >= 0 ? currentJobPosition.index + 1 : 0} of{" "}
                      {currentJobPosition.total}
                    </CardDescription>
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
                    <div className="space-y-1">
                      <div className="text-xl font-semibold text-foreground">{currentJob.title}</div>
                      <div className="text-sm text-muted-foreground">
                        {currentJob.company || "Unknown company"} · {currentJob.location || "Unknown location"}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span className="rounded-full bg-secondary px-2 py-1">
                        Date posted: {formatJobFreshness(currentJob)}
                      </span>
                      <span className="rounded-full bg-secondary px-2 py-1">
                        Salary: {currentJob.salaryText || "Unknown"}
                      </span>
                      <span className="rounded-full bg-secondary px-2 py-1">
                        Score: {Number.isFinite(Number(currentJob.score)) ? Math.round(Number(currentJob.score)) : "n/a"}
                      </span>
                      <span className="rounded-full bg-secondary px-2 py-1">
                        Status: {formatJobStatus(currentJob.status)}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        data-job-open="1"
                        disabled={jobsControlsDisabled || !currentJob.reviewTarget?.url}
                        onClick={() => {
                          void handleOpenCurrentJob();
                        }}
                      >
                        {currentJob.reviewTarget?.mode === "search" ? "Open Search" : "View Job"}
                      </Button>
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
                        <div className="text-sm font-semibold text-foreground">Source</div>
                        <ul className="mt-3 space-y-1 text-sm">
                          {currentJobSourceAttributions.length > 0 ? (
                            currentJobSourceAttributions.map((source) => (
                              <li key={source.id} className="text-foreground">
                                {source.name}
                              </li>
                            ))
                          ) : (
                            <li className="text-muted-foreground">Unknown source</li>
                          )}
                        </ul>
                      </div>
                    </div>

                    <div className="rounded-lg border border-border/70 bg-card p-4">
                      <div className="text-sm font-semibold text-foreground">Optional fields</div>
                      <dl className="mt-3 grid gap-2 text-sm md:grid-cols-2">
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
      <Dialog open={searchesDialogOpen} onOpenChange={setSearchesDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-[1220px] overflow-y-auto" data-searches-modal="1">
          <DialogHeader>
            <DialogTitle>My Job Searches</DialogTitle>
            <DialogDescription>
              Manage enabled sources, authentication checks, and per-source refresh actions.
            </DialogDescription>
          </DialogHeader>

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
                  <CardTitle className="pt-1 text-base">Sources</CardTitle>
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
                        <TableRow key={row.id} className={cn(!row.enabled && "bg-secondary/20")}>
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
        </DialogContent>
      </Dialog>

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
