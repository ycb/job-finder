import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  collectWellfoundJobsFromSearch,
  parseWellfoundSearchHtml
} from "../src/sources/wellfound-jobs.js";

test("parseWellfoundSearchHtml extracts JobPosting records from JSON-LD", () => {
  const html = `
    <html>
      <head>
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "JobPosting",
            "title": "Senior Product Manager, AI",
            "hiringOrganization": { "name": "Example AI" },
            "datePosted": "2026-03-01",
            "employmentType": "FULL_TIME",
            "url": "https://wellfound.com/jobs/123456-senior-product-manager-ai",
            "description": "<p>Lead AI roadmap.</p>"
          }
        </script>
      </head>
      <body></body>
    </html>
  `;

  const jobs = parseWellfoundSearchHtml(html, "https://wellfound.com/jobs");
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, "Senior Product Manager, AI");
  assert.equal(jobs[0].company, "Example AI");
  assert.equal(jobs[0].externalId, "123456");
});

test("collectWellfoundJobsFromSearch returns empty when no browser capture exists", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-wellfound-"));

  try {
    const source = {
      id: "wf-missing-capture",
      name: "Wellfound Missing Capture",
      type: "wellfound_search",
      enabled: true,
      searchUrl: "https://example.invalid/jobs",
      capturePath: path.join(tempDir, "missing-capture.json")
    };

    const jobs = collectWellfoundJobsFromSearch(source);
    assert.deepEqual(jobs, []);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
