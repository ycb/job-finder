import {
  getSourceCaptureJobs,
  writeSourceCapturePayload
} from "./cache-policy.js";

function assertZipRecruiterSource(source) {
  if (!source || source.type !== "ziprecruiter_search") {
    throw new Error("ZipRecruiter capture write requires a ziprecruiter_search source.");
  }
}

export function writeZipRecruiterCaptureFile(source, jobs, options = {}) {
  assertZipRecruiterSource(source);

  const capturePath = writeSourceCapturePayload(source, jobs, options);
  return {
    source,
    capturePath,
    jobsImported: Array.isArray(jobs) ? jobs.length : 0,
    capturedAt: options.capturedAt || new Date().toISOString(),
    pageUrl: options.pageUrl || null,
    expectedCount:
      Number.isFinite(Number(options.expectedCount)) && Number(options.expectedCount) > 0
        ? Math.round(Number(options.expectedCount))
        : null
  };
}

export function collectZipRecruiterJobsFromSearch(source) {
  const capturedJobs = getSourceCaptureJobs(source);
  if (Number.isInteger(source.maxJobs) && source.maxJobs > 0) {
    return capturedJobs.slice(0, source.maxJobs);
  }

  return capturedJobs;
}
