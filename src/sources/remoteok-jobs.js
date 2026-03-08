import {
  getSourceCaptureJobs,
  writeSourceCapturePayload
} from "./cache-policy.js";

function assertRemoteOkSource(source) {
  if (!source || source.type !== "remoteok_search") {
    throw new Error("RemoteOK capture write requires a remoteok_search source.");
  }
}

export function writeRemoteOkCaptureFile(source, jobs, options = {}) {
  assertRemoteOkSource(source);

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

export function collectRemoteOkJobsFromSearch(source) {
  const capturedJobs = getSourceCaptureJobs(source);
  if (Number.isInteger(source.maxJobs) && source.maxJobs > 0) {
    return capturedJobs.slice(0, source.maxJobs);
  }

  return capturedJobs;
}
