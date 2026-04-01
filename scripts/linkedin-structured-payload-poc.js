import fs from "node:fs";

import { extractLinkedInStructuredJobsFromHtml } from "../src/sources/linkedin-structured-payload.js";

const inputPath = process.argv[2];

if (!inputPath) {
  console.error("Usage: node scripts/linkedin-structured-payload-poc.js <saved-linkedin-html>");
  process.exit(1);
}

const html = fs.readFileSync(inputPath, "utf8");
const jobs = extractLinkedInStructuredJobsFromHtml(html);

console.log(JSON.stringify({
  inputPath,
  extractedCount: jobs.length,
  jobs: jobs.slice(0, 5)
}, null, 2));
