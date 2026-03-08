import fs from "node:fs";
import path from "node:path";

function normalizeOutputPath(options = {}) {
  if (typeof options === "string" && options.trim()) {
    return options.trim();
  }

  if (
    options &&
    typeof options === "object" &&
    typeof options.outputPath === "string" &&
    options.outputPath.trim()
  ) {
    return options.outputPath.trim();
  }

  return "output/shortlist.json";
}

export function renderShortlistPayload(jobs) {
  const rows = Array.isArray(jobs)
    ? jobs.filter((job) => job && typeof job === "object")
    : [];

  return {
    generatedAt: new Date().toISOString(),
    total: rows.length,
    jobs: rows
  };
}

export function writeShortlistFile(jobs, options = {}) {
  const resolvedPath = path.resolve(normalizeOutputPath(options));
  const payload = renderShortlistPayload(jobs);

  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  return resolvedPath;
}
