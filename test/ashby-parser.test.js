import test from "node:test";
import assert from "node:assert/strict";

import {
  extractAshbyBoardUrlsFromGoogleHtml,
  parseAshbySearchHtml,
  parseGoogleSearchQuery
} from "../src/sources/ashby-jobs.js";

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

test("extractAshbyBoardUrlsFromGoogleHtml extracts canonical board urls", () => {
  const html = `
    <a href="/url?q=https%3A%2F%2Fjobs.ashbyhq.com%2Fopenai%2Fjob%2Fabc123&sa=U">Result</a>
    <a href="https://jobs.ashbyhq.com/anthropic/job/def456?gh_jid=def456">Result 2</a>
  `;

  const urls = extractAshbyBoardUrlsFromGoogleHtml(html);
  assert.deepEqual(urls.sort(), [
    "https://jobs.ashbyhq.com/anthropic",
    "https://jobs.ashbyhq.com/openai"
  ]);
});

test("parseGoogleSearchQuery reads q from google search URL", () => {
  const query = parseGoogleSearchQuery(
    "https://www.google.com/search?q=site%3Aashbyhq.com+%22product+manager%22+%22San+Francisco%22+%22AI%22"
  );
  assert.equal(query, 'site:ashbyhq.com "product manager" "San Francisco" "AI"');
});
