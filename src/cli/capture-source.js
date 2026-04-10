import fs from "node:fs";

export function captureSourceFromCli({
  source,
  snapshotPath,
  openUrlInBrowser,
  importLinkedInSnapshot,
  collectRawJobsFromSource
}) {
  if (!source) {
    throw new Error("captureSourceFromCli requires a source.");
  }

  if (source.type === "linkedin_capture_file") {
    if (!snapshotPath || !fs.existsSync(snapshotPath)) {
      if (typeof openUrlInBrowser === "function" && source.searchUrl) {
        openUrlInBrowser(source.searchUrl);
      }
      return {
        status: "missing_snapshot",
        snapshotPath: snapshotPath || null
      };
    }

    const result = importLinkedInSnapshot(source, snapshotPath);
    return {
      status: "captured",
      jobsImported: result.jobsImported ?? 0,
      capturePath: result.capturePath || snapshotPath
    };
  }

  const jobs = collectRawJobsFromSource(source);
  return {
    status: "captured",
    jobsImported: Array.isArray(jobs) ? jobs.length : 0
  };
}
