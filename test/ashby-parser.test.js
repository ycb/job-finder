import test from "node:test";
import assert from "node:assert/strict";

import { parseAshbySearchHtml } from "../src/sources/ashby-jobs.js";

test("parseAshbySearchHtml extracts job entries from __NEXT_DATA__", () => {
  const html = `
    <html>
      <head>
        <title>Open Roles at Example Labs</title>
        <script id="__NEXT_DATA__" type="application/json">
          {
            "props": {
              "pageProps": {
                "jobPostings": [
                  {
                    "jobPostingId": "abc123xyz789",
                    "title": "Staff Product Manager",
                    "locationName": "San Francisco, CA",
                    "employmentType": "Full-time",
                    "publishedAt": "2026-03-02T00:00:00.000Z",
                    "jobUrl": "https://jobs.ashbyhq.com/example/abc123xyz789"
                  }
                ]
              }
            }
          }
        </script>
      </head>
      <body></body>
    </html>
  `;

  const jobs = parseAshbySearchHtml(html, "https://jobs.ashbyhq.com/example");
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, "Staff Product Manager");
  assert.equal(jobs[0].company, "Example Labs");
  assert.equal(jobs[0].externalId, "abc123xyz789");
});
