import test from "node:test";
import assert from "node:assert/strict";

import { parseWellfoundSearchHtml } from "../src/sources/wellfound-jobs.js";

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
