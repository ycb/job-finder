import fs from "node:fs";
import path from "node:path";

function formatRowValue(value) {
  if (value === null || value === undefined || value === "") {
    return "n/a";
  }

  return String(value);
}

export function writeShortlistFile(rows, outputPath = "output/shortlist.md") {
  const resolvedPath = path.resolve(String(outputPath || "output/shortlist.md"));
  const normalizedRows = Array.isArray(rows) ? rows : [];

  const lines = [
    "# Job Finder Shortlist",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "| Job ID | Title | Company | Location | Score | Bucket | Status |",
    "| --- | --- | --- | --- | --- | --- | --- |"
  ];

  if (normalizedRows.length === 0) {
    lines.push("| n/a | No jobs found | n/a | n/a | n/a | n/a | n/a |");
  } else {
    for (const row of normalizedRows) {
      lines.push(
        [
          "|",
          formatRowValue(row?.id),
          "|",
          formatRowValue(row?.title),
          "|",
          formatRowValue(row?.company),
          "|",
          formatRowValue(row?.location),
          "|",
          formatRowValue(row?.score),
          "|",
          formatRowValue(row?.bucket),
          "|",
          formatRowValue(row?.status || "new"),
          "|"
        ].join(" ")
      );
    }
  }

  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, `${lines.join("\n")}\n`, "utf8");
  return resolvedPath;
}
