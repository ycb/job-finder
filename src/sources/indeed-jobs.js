import {
  getSourceCaptureJobs,
  writeSourceCapturePayload
} from "./cache-policy.js";

function assertIndeedSource(source) {
  if (!source || source.type !== "indeed_search") {
    throw new Error("Indeed capture write requires an indeed_search source.");
  }
}

export function writeIndeedCaptureFile(source, jobs, options = {}) {
  assertIndeedSource(source);

  const capturePath = writeSourceCapturePayload(source, jobs, options);
  return {
    source,
    capturePath,
    jobsImported: Array.isArray(jobs) ? jobs.length : 0,
    capturedAt: options.capturedAt || new Date().toISOString(),
    pageUrl: options.pageUrl || null,
    expectedCount: null
  };
}

export function collectIndeedJobsFromSearch(source) {
  const capturedJobs = getSourceCaptureJobs(source);
  if (Number.isInteger(source.maxJobs) && source.maxJobs > 0) {
    return capturedJobs.slice(0, source.maxJobs);
  }

  return capturedJobs;
}
