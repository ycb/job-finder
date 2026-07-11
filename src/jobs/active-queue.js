function normalizeStatus(status) {
  return String(status || "").trim().toLowerCase();
}

function normalizeBucket(bucket) {
  return String(bucket || "").trim().toLowerCase();
}

export function isActiveQueueJob(job) {
  const status = normalizeStatus(job?.status);
  if (status !== "new" && status !== "viewed") {
    return false;
  }

  if (job?.hardFiltered) {
    return false;
  }

  return true;
}

export function filterActiveQueueJobs(jobs = []) {
  return (Array.isArray(jobs) ? jobs : []).filter((job) => isActiveQueueJob(job));
}

// One reconciled account of every stored job, in mutually exclusive buckets
// that always sum to `stored`. Priority order (first match wins):
// user actions (applied / skipped / rejected) outrank scoring gates
// (hard-filtered, low-signal), and whatever remains is the active queue.
// Powers the dashboard's explanatory empty state and count vocabulary.
export function buildQueueBreakdown(jobs = [], activeJobs = null) {
  const list = Array.isArray(jobs) ? jobs : [];
  const breakdown = {
    stored: list.length,
    applied: 0,
    skipped: 0,
    rejectedByUser: 0,
    hardFiltered: 0,
    lowSignal: 0,
    active: 0
  };

  for (const job of list) {
    const status = normalizeStatus(job?.status);
    if (status === "applied") {
      breakdown.applied += 1;
    } else if (status === "skip_for_now") {
      breakdown.skipped += 1;
    } else if (status === "rejected") {
      breakdown.rejectedByUser += 1;
    } else if (job?.hardFiltered) {
      breakdown.hardFiltered += 1;
    } else if (normalizeBucket(job?.bucket) === "reject") {
      breakdown.lowSignal += 1;
    } else {
      breakdown.active += 1;
    }
  }

  // Sanity alignment: the active-queue filter is the product's real gate; if
  // it disagrees with the residual count (e.g. a future gate is added there
  // but not here), trust the filter and absorb the difference into lowSignal
  // so the buckets keep summing to `stored`.
  const realActive = Array.isArray(activeJobs)
    ? activeJobs.length
    : filterActiveQueueJobs(list).length;
  if (realActive !== breakdown.active) {
    breakdown.lowSignal += breakdown.active - realActive;
    breakdown.active = realActive;
  }

  return breakdown;
}
