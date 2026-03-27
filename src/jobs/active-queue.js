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

  return normalizeBucket(job?.bucket) !== "reject";
}

export function filterActiveQueueJobs(jobs = []) {
  return (Array.isArray(jobs) ? jobs : []).filter((job) => isActiveQueueJob(job));
}
